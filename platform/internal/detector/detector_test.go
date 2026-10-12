package detector

import (
	"fmt"
	"math"
	"math/rand"
	"sort"
	"testing"
	"time"

	"github.com/bulkhead/platform/internal/metrics"
)

const (
	ent     = 0.2
	nTicks  = 70
	onset   = 20
	baseP99 = 50.0
	gain    = 10.0
)

// role of a tenant in a synthetic trace.
type role int

const (
	steady    role = iota // light, within quota: a potential victim
	abuserCPU             // hogs CPU above entitlement, hurting everyone
	abuserDB              // hogs the shared DB above entitlement
	busy                  // above entitlement but harmless (no latency effect)
	flash                 // brief spike, stays within reservation
	selfOver              // overloads itself: slow because of its own excess
)

func (r role) abuser() bool { return r == abuserCPU || r == abuserDB }

type trace struct {
	name  string
	roles []role
	snaps []metrics.Snapshot
}

func (t trace) truth() map[string]bool {
	m := map[string]bool{}
	for i, r := range t.roles {
		if r.abuser() {
			m[fmt.Sprintf("t%d", i)] = true
		}
	}
	return m
}

// gen builds a deterministic trace: usage → latency with a 1-window lag.
func gen(name string, seed int64, roles ...role) trace {
	rng := rand.New(rand.NewSource(seed))
	n := len(roles)
	ar := make([]float64, n)
	prevExcess := 0.0
	tr := trace{name: name, roles: roles}
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for tick := 0; tick < nTicks; tick++ {
		snap := metrics.Snapshot{Start: t0.Add(time.Duration(tick) * time.Second)}
		use := make([]float64, n)
		excessNow := 0.0
		for i, r := range roles {
			ar[i] = 0.7*ar[i] + rng.NormFloat64()*0.15
			u := 0.08 + 0.01*rng.NormFloat64()
			switch r {
			case abuserCPU, abuserDB:
				if tick >= onset {
					u = ent + 0.3*(1+ar[i])
				}
			case busy:
				if tick >= 0 {
					u = 0.3 + 0.03*ar[i]
				}
			case flash:
				if tick >= onset && tick < onset+10 {
					u = 0.19 + 0.005*rng.NormFloat64()
				}
			case selfOver:
				if tick >= 8 {
					u = 0.4 + 0.05*ar[i]
				}
			}
			use[i] = u
			if r.abuser() && u > ent {
				excessNow += u - ent
			}
		}
		for i, r := range roles {
			infl := 1 + gain*prevExcess
			if r == selfOver && tick >= 8 {
				infl += 5
			}
			if r.abuser() {
				infl = 1
			}
			p99 := baseP99 * infl * (1 + 0.04*rng.NormFloat64())
			w := metrics.Window{
				Start: snap.Start, Tenant: fmt.Sprintf("t%d", i),
				Requests: 20, OK: 20, P99: p99, P95: p99 * 0.8, QueueWaitP95: p99 * 0.05,
				Entitlement: ent,
			}
			if r == abuserDB {
				w.DBms = use[i] * 4000
				w.CPUShare = 0.08
			} else {
				w.CPUShare = use[i]
			}
			snap.Windows = append(snap.Windows, w)
		}
		prevExcess = excessNow
		tr.snaps = append(tr.snaps, snap)
	}
	return tr
}

// run replays a trace; it returns every culprit ever flagged and all ticks.
func run(tr trace, cfg Config) (flagged map[string]bool, ticks [][]Finding) {
	d := New(cfg)
	flagged = map[string]bool{}
	for _, s := range tr.snaps {
		f := d.Observe(s)
		ticks = append(ticks, f)
		for _, x := range f {
			flagged[x.Culprit] = true
		}
	}
	return
}

func keys(m map[string]bool) []string {
	var k []string
	for s := range m {
		k = append(k, s)
	}
	sort.Strings(k)
	return k
}

func TestAcceptanceScenarios(t *testing.T) {
	cases := []struct {
		name  string
		roles []role
		want  []string // exact set of culprits ever flagged
	}{
		{"1 single abuser, steady victim", []role{abuserCPU, steady, steady, steady}, []string{"t0"}},
		{"1b single DB abuser", []role{steady, steady, abuserDB, steady}, []string{"t2"}},
		{"2 busy but harmless, no victim", []role{busy, steady, steady, steady}, nil},
		{"3 flash crowd within reservation", []role{flash, steady, steady, steady}, nil},
		{"4 two abusers both ranked", []role{abuserCPU, steady, abuserDB, steady}, []string{"t0", "t2"}},
		{"5 victim degraded by own overload", []role{selfOver, steady, steady, steady}, nil},
		{"5b own overload next to a busy tenant", []role{selfOver, busy, steady, steady}, nil},
	}
	for i, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			tr := gen(c.name, int64(100+i), c.roles...)
			flagged, ticks := run(tr, Config{})
			got := keys(flagged)
			if fmt.Sprint(got) != fmt.Sprint(c.want) {
				t.Fatalf("flagged %v, want %v", got, c.want)
			}
			if len(c.want) == 2 {
				both := false
				for _, f := range ticks {
					if len(f) >= 2 {
						both = f[0].Score >= f[1].Score
						break
					}
				}
				if !both {
					t.Fatalf("never saw both abusers ranked in one tick")
				}
			}
		})
	}
}

func TestEvidenceAndVictims(t *testing.T) {
	tr := gen("ev", 7, abuserCPU, steady, steady, steady)
	_, ticks := run(tr, Config{})
	var f *Finding
	for _, x := range ticks {
		if len(x) > 0 {
			f = &x[0]
			break
		}
	}
	if f == nil {
		t.Fatal("no finding")
	}
	if f.Culprit != "t0" || len(f.Victims) == 0 || f.Score < DefaultConfig().Tau {
		t.Fatalf("bad finding: %+v", f)
	}
	ev := f.Evidence
	if len(ev.Victims) == 0 || ev.Victims[0].Inflation < 2.5 || len(ev.Resources) != int(numRes) {
		t.Fatalf("thin evidence: %+v", ev)
	}
	if ev.Resources[CPU].Excess <= 0 || ev.Resources[CPU].Corr <= 0 {
		t.Fatalf("cpu evidence missing: %+v", ev.Resources[CPU])
	}
}

func TestBaselineFrozenDuringDegradation(t *testing.T) {
	tr := gen("freeze", 3, abuserCPU, steady, steady, steady)
	d := New(Config{})
	for _, s := range tr.snaps {
		d.Observe(s)
	}
	// Victims were slowed ~4-10× for 50 windows; the baseline must not follow.
	if b := d.st["t1"].baseP99; b > baseP99*1.3 {
		t.Fatalf("baseline drifted to %.1f", b)
	}
}

func TestPearsonAndLag(t *testing.T) {
	a := []float64{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12}
	if r := pearson(a, a); math.Abs(r-1) > 1e-9 {
		t.Fatalf("r=%v", r)
	}
	if r := pearson(a, make([]float64, len(a))); r != 0 {
		t.Fatalf("constant series should give 0, got %v", r)
	}
	// lat[i] = use[i-1]: perfect at lag 1.
	use := []float64{3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7}
	lat := append([]float64{0}, use[:len(use)-1]...)
	if r, l := laggedCorr(use, lat, 2, 8, false); r < 0.999 || l != 1 {
		t.Fatalf("r=%v lag=%d", r, l)
	}
}

// TestPrecisionRecall replays a generated suite (≥50 traces) and reports
// trace-level precision/recall of the flagged-culprit sets.
func TestPrecisionRecall(t *testing.T) {
	mixes := [][]role{
		{abuserCPU, steady, steady, steady},
		{steady, abuserDB, steady, steady},
		{abuserCPU, steady, abuserDB, steady},
		{busy, steady, steady, steady},
		{flash, steady, steady, steady},
		{steady, selfOver, steady, steady},
		{abuserCPU, busy, flash, steady},
		{steady, steady, busy, steady},
		{selfOver, busy, abuserDB, steady},
		{steady, steady, steady, steady},
	}
	var tp, fp, fn, traces int
	for i := 0; i < 60; i++ {
		roles := mixes[i%len(mixes)]
		tr := gen(fmt.Sprintf("trace-%d", i), int64(1000+i), roles...)
		flagged, _ := run(tr, Config{})
		truth := tr.truth()
		for k := range flagged {
			if truth[k] {
				tp++
			} else {
				fp++
				t.Logf("FP %s mix=%v flagged=%s", tr.name, roles, k)
			}
		}
		for k := range truth {
			if !flagged[k] {
				fn++
				t.Logf("FN %s mix=%v missed=%s", tr.name, roles, k)
			}
		}
		traces++
	}
	prec := float64(tp) / math.Max(1, float64(tp+fp))
	rec := float64(tp) / math.Max(1, float64(tp+fn))
	t.Logf("traces=%d TP=%d FP=%d FN=%d precision=%.3f recall=%.3f", traces, tp, fp, fn, prec, rec)
	if traces < 50 || prec < 0.95 || rec < 0.95 {
		t.Fatalf("precision=%.3f recall=%.3f below 0.95", prec, rec)
	}
}
