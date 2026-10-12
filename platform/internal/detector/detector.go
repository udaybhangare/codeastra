package detector

import (
	"context"
	"math"
	"sort"
	"time"

	"github.com/bulkhead/platform/internal/metrics"
)

// Resource indexes the contended resources attribution looks at.
type Resource int

const (
	CPU Resource = iota
	DB
	Queue
	Bytes
	numRes
)

var resNames = [numRes]string{"cpu", "db", "queue", "bytes"}

func (r Resource) String() string { return resNames[r] }

// ResourceEvidence explains one resource's contribution to a score.
type ResourceEvidence struct {
	Resource     string  `json:"resource"`
	Share        float64 `json:"share"`       // culprit's recent share of host capacity
	Entitlement  float64 `json:"entitlement"` // its guaranteed share
	Excess       float64 `json:"excess"`      // max(0, share − entitlement)
	Corr         float64 `json:"corr"`        // best lagged Pearson r vs victim p99
	LagWindows   int     `json:"lag_windows"`
	Weight       float64 `json:"weight"`
	Contribution float64 `json:"contribution"` // weight × excess × max(0, corr)
}

// VictimEvidence is one victim's state when the finding was made.
type VictimEvidence struct {
	Tenant       string  `json:"tenant"`
	P99Ms        float64 `json:"p99_ms"`
	BaselineMs   float64 `json:"baseline_p99_ms"`
	Inflation    float64 `json:"p99_inflation"`
	QueueWaitMs  float64 `json:"queue_wait_p95_ms"`
	DegradedWins int     `json:"degraded_windows"`
	PairScore    float64 `json:"score"` // culprit's score against this victim
}

// Evidence is everything needed to explain a finding in plain English.
type Evidence struct {
	At        time.Time          `json:"at"`
	Resources []ResourceEvidence `json:"resources"` // against the worst-hit victim
	Victims   []VictimEvidence   `json:"victims"`
	Tau       float64            `json:"tau"`
	// Predicted is the predictor's p_overload for the culprit when the finding
	// was made: extra evidence only, never part of the score (docs/07).
	Predicted *float64 `json:"predictor_score,omitempty"`
}

// Finding names a culprit, how sure we are, whom it hurts and why.
type Finding struct {
	Culprit  string   `json:"culprit"`
	Score    float64  `json:"score"`
	Victims  []string `json:"victims"`
	Evidence Evidence `json:"evidence"`
}

type sample struct {
	p99 float64
	use [numRes]float64
}

type tenantState struct {
	baseP99, baseQW float64
	baseN           int
	streak          int
	hist            []sample
}

// Detector is the stateful core. Feed it one Snapshot per tick via Observe;
// it never reads the clock, so synthetic traces replay deterministically.
type Detector struct {
	cfg Config
	st  map[string]*tenantState
}

func New(cfg Config) *Detector {
	cfg.fill()
	return &Detector{cfg: cfg, st: map[string]*tenantState{}}
}

// usage converts a window into per-resource shares of host capacity.
func (c *Config) usage(w *metrics.Window) [numRes]float64 {
	secs := c.Window.Seconds()
	return [numRes]float64{
		CPU:   w.CPUShare,
		DB:    w.DBms / (secs * c.Capacity.DBMsPerSec),
		Queue: float64(w.QueueDepth+w.InFlight) / c.Capacity.QueueSlots,
		Bytes: w.Bytes / (secs * c.Capacity.BytesPerSec),
	}
}

func (c *Config) weight(r Resource) float64 {
	switch r {
	case CPU:
		return c.Weights.CPU
	case DB:
		return c.Weights.DB
	case Queue:
		return c.Weights.Queue
	}
	return c.Weights.Bytes
}

type victim struct {
	tenant string
	ev     VictimEvidence
}

// Observe ingests one snapshot and returns findings ranked by score
// (descending); empty when nobody is hurt or nobody explains the harm.
func (d *Detector) Observe(snap metrics.Snapshot) []Finding {
	c := &d.cfg
	n := len(snap.Windows)
	if n == 0 {
		return nil
	}
	var victims []victim
	ent := make(map[string]float64, n)
	for i := range snap.Windows {
		w := &snap.Windows[i]
		s := d.st[w.Tenant]
		if s == nil {
			s = &tenantState{}
			d.st[w.Tenant] = s
		}
		e := w.Entitlement
		if e <= 0 {
			e = c.FallbackEnt
		}
		if e <= 0 {
			e = 1 / float64(n)
		}
		ent[w.Tenant] = e

		use := c.usage(w)
		s.hist = append(s.hist, sample{p99: w.P99, use: use})
		if len(s.hist) > c.History {
			s.hist = s.hist[len(s.hist)-c.History:]
		}

		if v, ok := d.updateVictim(s, w, use, e); ok {
			victims = append(victims, victim{w.Tenant, v})
		}
	}
	if len(victims) == 0 {
		return nil
	}
	return d.attribute(snap, victims, ent)
}

// updateVictim runs step 1 for one tenant window.
func (d *Detector) updateVictim(s *tenantState, w *metrics.Window, use [numRes]float64, ent float64) (VictimEvidence, bool) {
	c := &d.cfg
	if w.OK+w.Errors < c.MinCompletions {
		s.streak = 0 // too little traffic to judge
		return VictimEvidence{}, false
	}
	if s.baseN < c.BaselineMinWindow {
		// Still learning: take every window as calm and seed the EWMA.
		if s.baseN == 0 {
			s.baseP99, s.baseQW = w.P99, w.QueueWaitP95
		} else {
			s.baseP99 += c.BaselineAlpha * (w.P99 - s.baseP99)
			s.baseQW += c.BaselineAlpha * (w.QueueWaitP95 - s.baseQW)
		}
		s.baseN++
		return VictimEvidence{}, false
	}
	slow := w.P99 > c.K*s.baseP99
	waiting := w.QueueWaitP95 > math.Max(c.QueueWaitMinMs, c.K*s.baseQW)
	if !(slow || waiting) {
		s.streak = 0
		// Calm window: fold into the baseline. Degraded windows never do.
		s.baseP99 += c.BaselineAlpha * (w.P99 - s.baseP99)
		s.baseQW += c.BaselineAlpha * (w.QueueWaitP95 - s.baseQW)
		return VictimEvidence{}, false
	}
	s.streak++
	if s.streak < c.N {
		return VictimEvidence{}, false
	}
	// Self-inflicted overload (over its own entitlement on a consumed
	// resource) is not victimhood.
	for _, r := range []Resource{CPU, DB, Bytes} {
		if use[r] > c.QuotaSlack*ent {
			return VictimEvidence{}, false
		}
	}
	infl := 0.0
	if s.baseP99 > 0 {
		infl = w.P99 / s.baseP99
	}
	return VictimEvidence{
		Tenant: w.Tenant, P99Ms: w.P99, BaselineMs: s.baseP99, Inflation: infl,
		QueueWaitMs: w.QueueWaitP95, DegradedWins: s.streak,
	}, true
}

// attribute runs step 2: score every non-victim-self candidate per victim.
func (d *Detector) attribute(snap metrics.Snapshot, victims []victim, ent map[string]float64) []Finding {
	c := &d.cfg
	type best struct {
		score float64
		res   []ResourceEvidence
		vict  []VictimEvidence
		names []string
	}
	cands := map[string]*best{}
	for _, w := range snap.Windows {
		cs := d.st[w.Tenant]
		for _, v := range victims {
			if v.tenant == w.Tenant {
				continue
			}
			vs := d.st[v.tenant]
			res, score := d.score(cs, vs, ent[w.Tenant])
			if score < c.Tau {
				continue
			}
			b := cands[w.Tenant]
			if b == nil {
				b = &best{}
				cands[w.Tenant] = b
			}
			ve := v.ev
			ve.PairScore = score
			b.vict = append(b.vict, ve)
			b.names = append(b.names, v.tenant)
			if score > b.score {
				b.score, b.res = score, res
			}
		}
	}
	out := make([]Finding, 0, len(cands))
	for name, b := range cands {
		sort.Slice(b.vict, func(i, j int) bool { return b.vict[i].PairScore > b.vict[j].PairScore })
		sort.Strings(b.names)
		out = append(out, Finding{
			Culprit: name, Score: b.score, Victims: b.names,
			Evidence: Evidence{At: snap.Start, Resources: b.res, Victims: b.vict, Tau: c.Tau},
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].Culprit < out[j].Culprit
	})
	return out
}

// score = Σ_r w_r · excess_r · max(0, corr_r) for culprit cs vs victim vs.
func (d *Detector) score(cs, vs *tenantState, ent float64) ([]ResourceEvidence, float64) {
	c := &d.cfg
	lat := make([]float64, len(vs.hist))
	for i, h := range vs.hist {
		lat[i] = h.p99
	}
	k := c.ExcessAvgN
	if k > len(cs.hist) {
		k = len(cs.hist)
	}
	var total float64
	res := make([]ResourceEvidence, 0, numRes)
	for r := Resource(0); r < numRes; r++ {
		var share float64
		for _, h := range cs.hist[len(cs.hist)-k:] {
			share += h.use[r]
		}
		share /= float64(k)
		excess := math.Max(0, share-ent)
		ev := ResourceEvidence{Resource: r.String(), Share: share, Entitlement: ent, Excess: excess, Weight: c.weight(r)}
		if excess > 0 {
			u := make([]float64, len(cs.hist))
			for i, h := range cs.hist {
				u[i] = h.use[r]
			}
			ev.Corr, ev.LagWindows = laggedCorr(u, lat, c.MaxLagWin, c.MinCorrPts, c.DiffCorr)
			ev.Contribution = ev.Weight * excess * math.Max(0, ev.Corr)
			total += ev.Contribution
		}
		res = append(res, ev)
	}
	return res, total
}

// laggedCorr returns the max Pearson r between use[i-lag] and lat[i] for
// lag ∈ [0,maxLag] (usage leads latency), aligned on the newest samples.
func laggedCorr(use, lat []float64, maxLag, minPts int, diff bool) (float64, int) {
	n := len(use)
	if len(lat) < n {
		n = len(lat)
	}
	use, lat = use[len(use)-n:], lat[len(lat)-n:]
	if diff {
		use, lat = firstDiff(use), firstDiff(lat)
		n--
	}
	bestR, bestL := math.Inf(-1), 0
	for lag := 0; lag <= maxLag; lag++ {
		if n-lag < minPts {
			break
		}
		if r := pearson(use[:n-lag], lat[lag:]); r > bestR {
			bestR, bestL = r, lag
		}
	}
	if math.IsInf(bestR, -1) {
		return 0, 0
	}
	return bestR, bestL
}

// firstDiff returns x[i+1]-x[i]. Correlating changes instead of levels keeps a
// tenant that merely got busy earlier from correlating with a later latency
// step; only usage movements that line up with latency movements score.
func firstDiff(x []float64) []float64 {
	out := make([]float64, 0, len(x))
	for i := 1; i < len(x); i++ {
		out = append(out, x[i]-x[i-1])
	}
	return out
}

// pearson returns the correlation of a and b; 0 when either is constant.
func pearson(a, b []float64) float64 {
	n := float64(len(a))
	if n < 2 {
		return 0
	}
	var ma, mb float64
	for i := range a {
		ma += a[i]
		mb += b[i]
	}
	ma /= n
	mb /= n
	var sab, saa, sbb float64
	for i := range a {
		da, db := a[i]-ma, b[i]-mb
		sab += da * db
		saa += da * da
		sbb += db * db
	}
	if saa < 1e-12 || sbb < 1e-12 {
		return 0
	}
	return sab / math.Sqrt(saa*sbb)
}

// Runner is the thin loop around Detector: snapshots in, findings out.
type Runner struct {
	D       *Detector
	Enabled func() bool // nil = always on; false when ISOLATION=off (detector idle)
	Emit    func(at time.Time, findings []Finding)
}

// Run blocks until ctx ends or in closes. Emit is called every tick, with an
// empty slice when calm, so consumers can run their own hysteresis timers.
func (r *Runner) Run(ctx context.Context, in <-chan metrics.Snapshot) {
	for {
		select {
		case <-ctx.Done():
			return
		case snap, ok := <-in:
			if !ok {
				return
			}
			if r.Enabled != nil && !r.Enabled() {
				continue
			}
			f := r.D.Observe(snap)
			if r.Emit != nil {
				r.Emit(snap.Start, f)
			}
		}
	}
}
