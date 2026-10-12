package throttle

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/bulkhead/platform/internal/detector"
	"github.com/bulkhead/platform/internal/policy"
)

// Deps are the injected collaborators of a Controller.
type Deps struct {
	Policy    func(tenant string) (policy.Policy, bool)
	List      func() map[string]policy.Policy // optional; needed for SetPanic
	Act       Actuators
	Store     Store     // optional
	Publisher Publisher // optional
	Now       func() time.Time
	Log       *slog.Logger
}

// actuation is the concrete limit set derived from level + knobs + policy.
type actuation struct {
	weight     float64
	rateMult   float64
	burstOn    bool
	cpus       float64
	memMB      int64
	dbCap      int
	quarantine bool
}

type tstate struct {
	level     Level
	enteredAt time.Time
	k         Knobs

	lastHarm    time.Time
	harmSince   time.Time
	lastAbove2  time.Time
	above2Since time.Time
	lastDown    time.Time
	predAt      time.Time
	predP       float64
	score       float64
	finding     *detector.Finding

	pinned     bool
	breaches   []time.Time
	applied    actuation
	hasApplied bool
	lastLog    time.Time
	lastEv     *Event // most recent event, for State()
}

// Controller runs the throttle ladder for all tenants.
type Controller struct {
	cfg Config
	d   Deps

	mu     sync.Mutex
	st     map[string]*tstate
	panic  bool // shed free-tier tenants (docs/06 safety rail)
	lvlMu  sync.RWMutex
	levels map[string]Level
}

// New builds a controller. cfg zero fields take defaults.
func New(cfg Config, d Deps) *Controller {
	cfg.fill()
	if d.Now == nil {
		d.Now = time.Now // only used for manual pin/unpin timestamps; Observe is snapshot-clocked
	}
	if d.Log == nil {
		d.Log = slog.Default()
	}
	return &Controller{cfg: cfg, d: d, st: map[string]*tstate{}, levels: map[string]Level{}}
}

// Level returns the tenant's current level (Normal if unknown). Hot-path safe.
func (c *Controller) Level(tenant string) Level {
	c.lvlMu.RLock()
	defer c.lvlMu.RUnlock()
	return c.levels[tenant]
}

// Levels returns every tenant currently above Normal.
func (c *Controller) Levels() map[string]Level {
	c.lvlMu.RLock()
	defer c.lvlMu.RUnlock()
	out := make(map[string]Level, len(c.levels))
	for t, l := range c.levels {
		out[t] = l
	}
	return out
}

func (c *Controller) setLevel(t string, l Level) {
	c.lvlMu.Lock()
	defer c.lvlMu.Unlock()
	if l == Normal {
		delete(c.levels, t)
	} else {
		c.levels[t] = l
	}
}

// Observe feeds one detector tick (call every window, with an empty slice when
// calm). `at` is the snapshot time.
func (c *Controller) Observe(at time.Time, findings []detector.Finding) {
	c.mu.Lock()
	var evs []Event
	best := map[string]*detector.Finding{}
	for i := range findings {
		f := &findings[i]
		if p, ok := best[f.Culprit]; !ok || f.Score > p.Score {
			best[f.Culprit] = f
		}
	}
	names := map[string]struct{}{}
	for t := range c.st {
		names[t] = struct{}{}
	}
	for t := range best {
		names[t] = struct{}{}
	}
	if c.panic && c.d.List != nil {
		for t, p := range c.d.List() {
			if p.Tier == policy.TierFree {
				names[t] = struct{}{}
			}
		}
	}
	order := make([]string, 0, len(names))
	for t := range names {
		order = append(order, t)
	}
	// highest score first so scarce culprit slots go to the worst offenders
	sort.Slice(order, func(i, j int) bool {
		si, sj := 0.0, 0.0
		if f := best[order[i]]; f != nil {
			si = f.Score
		}
		if f := best[order[j]]; f != nil {
			sj = f.Score
		}
		if si != sj {
			return si > sj
		}
		return order[i] < order[j]
	})
	for _, t := range order {
		pol, ok := c.d.Policy(t)
		if !ok {
			delete(c.st, t)
			c.setLevel(t, Normal)
			continue
		}
		s := c.st[t]
		if s == nil {
			s = &tstate{k: Knobs{1, 1, 1, 1}}
			c.st[t] = s
		}
		evs = append(evs, c.step(t, s, pol, at, best[t])...)
		if s.level == Normal && !s.pinned && s.k == c.cfg.Profile[Normal] &&
			(s.lastDown.IsZero() || at.Sub(s.lastDown) > c.cfg.Reoffense) {
			delete(c.st, t)
		}
	}
	c.mu.Unlock()
	c.emit(evs)
}

func (c *Controller) step(t string, s *tstate, pol policy.Policy, at time.Time, f *detector.Finding) []Event {
	cfg := &c.cfg
	harm := f != nil && f.Score >= cfg.Tau1
	newBurst := false
	if harm {
		newBurst = s.lastHarm.IsZero() || at.Sub(s.lastHarm) > cfg.Grace
		if newBurst {
			s.harmSince = at
		}
		s.lastHarm, s.score, s.finding = at, f.Score, f
		if f.Score >= cfg.Tau2 {
			if s.lastAbove2.IsZero() || at.Sub(s.lastAbove2) > cfg.Grace {
				s.above2Since = at
			}
			s.lastAbove2 = at
		}
	}
	var evs []Event
	if s.pinned {
		return c.apply(t, s, pol, at, ReasonRecovering, s.level, false)
	}
	harmNow := !s.lastHarm.IsZero() && at.Sub(s.lastHarm) <= cfg.Grace
	moved := false
	move := func(to Level, reason string, md bool) {
		if to > Observe && s.level < Soft && c.culpritsAbove(t) >= cfg.MaxCulprits && reason != ReasonLimitBreach && reason != ReasonPanic {
			return // slot cap: hold at Observe (rail: max simultaneous culprits)
		}
		evs = append(evs, c.transition(t, s, pol, at, to, reason, md, "system", "")...)
		moved = true
	}

	shed := c.panic && pol.Tier == policy.TierFree
	switch {
	case shed && s.level < Hard:
		move(Hard, ReasonPanic, false)
	case harm && newBurst && !s.lastDown.IsZero() && at.Sub(s.lastDown) <= cfg.Reoffense && s.level < Quarantine:
		to := s.level + 1
		if to == Observe {
			to = Soft // re-offenders skip the no-action rung
		}
		s.lastDown = time.Time{}
		move(to, ReasonReoffense, true)
	case s.level == Normal && harm:
		move(Observe, ReasonDetected, false)
	case s.level == Observe && harmNow && !s.lastAbove2.IsZero() && at.Sub(s.lastAbove2) <= cfg.Grace &&
		at.Sub(s.above2Since) >= cfg.Sustain2:
		move(Soft, ReasonSustained, false)
	case s.level == Soft && harmNow && at.Sub(s.harmSince) >= cfg.Persist3 && c.dwelled(s, at):
		move(Hard, ReasonPersisted, false)
	case s.level == Hard && harmNow && at.Sub(s.harmSince) >= cfg.Persist4 && c.dwelled(s, at):
		move(Quarantine, ReasonPersisted, false)
	}

	// Predicted entry (no-op unless enabled and the predictor reported).
	if !moved && cfg.PredictiveEnabled && !s.predAt.IsZero() && at.Sub(s.predAt) <= cfg.Grace {
		switch {
		case s.level == Normal && s.predP >= cfg.PredictObserve:
			move(Observe, ReasonPredicted, false)
		case s.level == Observe && s.predP >= cfg.PredictSoft && at.Sub(s.enteredAt) >= cfg.Sustain2:
			move(Soft, ReasonPredicted, false)
		}
	}

	// De-escalate after enough calm (harm and forecasts both absent).
	if !moved && s.level > Normal && !(shed && s.level <= Hard) && c.dwelled(s, at) {
		last := s.lastHarm
		if s.predAt.After(last) {
			last = s.predAt
		}
		if at.Sub(last) >= cfg.Calm[s.level] {
			s.lastDown = at
			note := fmt.Sprintf("calm for %ds", int(cfg.Calm[s.level].Seconds()))
			evs = append(evs, c.transition(t, s, pol, at, s.level-1, ReasonRecovered, false, "system", note)...)
			moved = true
		}
	}

	if !moved {
		if !harm {
			c.ramp(s)
		}
		evs = append(evs, c.apply(t, s, pol, at, ReasonRecovering, s.level, false)...)
	}
	return evs
}

func (c *Controller) dwelled(s *tstate, at time.Time) bool {
	return s.enteredAt.IsZero() || at.Sub(s.enteredAt) >= c.cfg.MinDwell
}

func (c *Controller) culpritsAbove(self string) int {
	n := 0
	for t, s := range c.st {
		if t != self && s.level >= Soft {
			n++
		}
	}
	return n
}

// transition changes level and applies the new profile, returning its event.
func (c *Controller) transition(t string, s *tstate, pol policy.Policy, at time.Time, to Level,
	reason string, md bool, actor, note string) []Event {
	from := s.level
	s.level, s.enteredAt, s.harmSince = to, at, at
	prof := c.cfg.Profile[to]
	k := s.k
	if md {
		k = Knobs{k.Weight * c.cfg.ReoffenseMD, k.Rate * c.cfg.ReoffenseMD, k.CPU * c.cfg.ReoffenseMD, k.DB * c.cfg.ReoffenseMD}
	}
	s.k = Knobs{min(k.Weight, prof.Weight), min(k.Rate, prof.Rate), min(k.CPU, prof.CPU), min(k.DB, prof.DB)}
	if actor != "system" { // manual pin: exact profile either direction
		s.k = prof
	}
	c.setLevel(t, to)
	return c.apply(t, s, pol, at, reason, from, true, note)
}

// ramp is AIMD additive increase: close RampStep of the gap to the level's profile.
func (c *Controller) ramp(s *tstate) {
	T := c.cfg.Profile[s.level]
	up := func(v *float64, target float64) {
		if *v >= target {
			return
		}
		*v += c.cfg.RampStep * (target - *v)
		if target-*v < 0.01 {
			*v = target
		}
	}
	up(&s.k.Weight, T.Weight)
	up(&s.k.Rate, T.Rate)
	up(&s.k.CPU, T.CPU)
	up(&s.k.DB, T.DB)
}

// derive turns knobs into concrete limits, enforcing the safety floors
// (docs/06: never below reservation×0.25; CPU never below reservation×0.5)
// except in Quarantine.
func (c *Controller) derive(pol policy.Policy, lvl Level, k Knobs) actuation {
	cfg := &c.cfg
	a := actuation{memMB: int64(pol.LimitMemMB), quarantine: lvl == Quarantine}
	w, r, cpu, db := k.Weight, k.Rate, k.CPU, k.DB
	cpus := pol.LimitCPU * cpu
	if lvl == Quarantine {
		cpus = math.Max(cpus, cfg.QuarantineMinCP)
	} else {
		floor := pol.ReserveCPU * math.Max(cfg.CPUFloorFrac, cfg.RailFrac)
		cpus = math.Max(cpus, floor)
		w, r = math.Max(w, cfg.MinWeight), math.Max(r, cfg.MinRate)
	}
	if pol.LimitCPU > 0 {
		cpus = math.Min(cpus, pol.LimitCPU)
	}
	a.cpus = cpus
	a.weight = float64(pol.Weight) * w
	a.rateMult = r
	a.burstOn = lvl < Soft && r >= 1
	if db < 1 && pol.DBConns > 0 {
		a.dbCap = max(1, int(math.Round(float64(pol.DBConns)*db)))
	}
	return a
}

// apply pushes changed limits to the actuators and, when something changed
// and logging is due, returns the event that records them with evidence.
func (c *Controller) apply(t string, s *tstate, pol policy.Policy, at time.Time, reason string,
	from Level, force bool, note ...string) []Event {
	want := c.derive(pol, s.level, s.k)
	prev, have := s.applied, s.hasApplied
	var acts []Action
	ctx, cancel := context.WithTimeout(context.Background(), c.cfg.ActuateTimeout)
	defer cancel()
	a := c.d.Act
	if a.Scheduler != nil {
		if !have || differ(prev.weight, want.weight) {
			a.Scheduler.SetWeight(t, want.weight)
			acts = append(acts, Action{"scheduler.weight", want.weight})
		}
		if !have && want.quarantine || have && prev.quarantine != want.quarantine {
			a.Scheduler.SetQuarantine(t, want.quarantine)
			acts = append(acts, Action{"scheduler.quarantine", b2f(want.quarantine)})
		}
	}
	if a.Buckets != nil && (!have || differ(prev.rateMult, want.rateMult) || prev.burstOn != want.burstOn) {
		a.Buckets.SetBuckets(t, want.rateMult, want.burstOn)
		acts = append(acts, Action{"bucket.rate_mult", want.rateMult}, Action{"bucket.burst", b2f(want.burstOn)})
	}
	if a.DB != nil && (!have || prev.dbCap != want.dbCap) {
		a.DB.SetConnCap(t, want.dbCap)
		acts = append(acts, Action{"db.conn_cap", float64(want.dbCap)})
	}
	cpuOK := true
	if a.Cgroup != nil && (!have || differ(prev.cpus, want.cpus)) {
		if err := a.Cgroup.Update(ctx, t, want.cpus, want.memMB); err != nil {
			c.d.Log.Warn("throttle: cgroup update failed", "tenant", t, "err", err)
			cpuOK = false // retried next tick
		} else {
			acts = append(acts, Action{"cgroup.cpus", want.cpus})
		}
	}
	if !cpuOK {
		want.cpus = prev.cpus
	}
	s.applied, s.hasApplied = want, true
	if len(acts) == 0 && !force {
		return nil
	}
	atTarget := s.k == c.cfg.Profile[s.level]
	if !force && !atTarget && at.Sub(s.lastLog) < c.cfg.EventEvery {
		return nil // rate-limit recovery-step rows
	}
	s.lastLog = at
	n := ""
	if len(note) > 0 {
		n = note[0]
	}
	ev := Event{TS: at, Tenant: t, From: from, To: s.level, Reason: reason, Actor: "system",
		Actions: acts, Evidence: c.evidence(s, at, n)}
	if s.pinned {
		ev.Actor = "admin"
	}
	ev.Explanation = Explain(ev, pol)
	s.lastEv = &ev
	return []Event{ev}
}

func (c *Controller) evidence(s *tstate, at time.Time, note string) Evidence {
	secs := func(t time.Time) float64 {
		if t.IsZero() {
			return 0
		}
		return math.Round(at.Sub(t).Seconds()*10) / 10
	}
	e := Evidence{Finding: s.finding, Score: s.score, Note: note,
		Thresh: map[string]float64{"tau1": c.cfg.Tau1, "tau2": c.cfg.Tau2},
		Timers: map[string]float64{"since_harm": secs(s.lastHarm), "harm_streak": secs(s.harmSince),
			"above_tau2": secs(s.above2Since), "at_level": secs(s.enteredAt)}}
	if !s.predAt.IsZero() {
		p := s.predP
		e.Predicted = &p
	}
	return e
}

func (c *Controller) emit(evs []Event) {
	for _, e := range evs {
		if c.d.Store != nil {
			ctx, cancel := context.WithTimeout(context.Background(), c.cfg.ActuateTimeout)
			if err := c.d.Store.Insert(ctx, e); err != nil {
				c.d.Log.Warn("throttle: event insert failed", "tenant", e.Tenant, "err", err)
			}
			cancel()
		}
		if c.d.Publisher != nil {
			c.d.Publisher.Publish(e)
		}
	}
}

// Predict feeds a predictor forecast p_overload for the tenant. It has no
// effect unless Config.PredictiveEnabled; evaluated on the next Observe.
func (c *Controller) Predict(at time.Time, tenant string, p float64) {
	if !c.cfg.PredictiveEnabled {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.d.Policy(tenant); !ok {
		return
	}
	s := c.st[tenant]
	if s == nil {
		if p < c.cfg.PredictObserve {
			return
		}
		s = &tstate{k: Knobs{1, 1, 1, 1}}
		c.st[tenant] = s
	}
	if p >= c.cfg.PredictObserve {
		s.predAt, s.predP = at, p
	}
}

// ReportLimitBreach records an OOM kill / limit-breach; a loop of them
// (BreachCount within BreachWindow) sends the tenant straight to Quarantine.
func (c *Controller) ReportLimitBreach(at time.Time, tenant, kind string) {
	c.mu.Lock()
	pol, ok := c.d.Policy(tenant)
	if !ok {
		c.mu.Unlock()
		return
	}
	s := c.st[tenant]
	if s == nil {
		s = &tstate{k: Knobs{1, 1, 1, 1}}
		c.st[tenant] = s
	}
	keep := s.breaches[:0]
	for _, b := range s.breaches {
		if at.Sub(b) <= c.cfg.BreachWindow {
			keep = append(keep, b)
		}
	}
	s.breaches = append(keep, at)
	var evs []Event
	if len(s.breaches) >= c.cfg.BreachCount && s.level < Quarantine && !s.pinned {
		s.lastHarm = at
		evs = c.transition(tenant, s, pol, at, Quarantine, ReasonLimitBreach, false, "system",
			fmt.Sprintf("%d %s events in %ds", len(s.breaches), kind, int(c.cfg.BreachWindow.Seconds())))
	}
	c.mu.Unlock()
	c.emit(evs)
}

// Pin holds the tenant at a level (admin override) until Unpin.
func (c *Controller) Pin(tenant string, lvl Level, actor string) error {
	if lvl < Normal || lvl > Quarantine {
		return fmt.Errorf("throttle: invalid level %d", lvl)
	}
	c.mu.Lock()
	pol, ok := c.d.Policy(tenant)
	if !ok {
		c.mu.Unlock()
		return fmt.Errorf("throttle: unknown tenant %q", tenant)
	}
	at := c.d.Now()
	s := c.st[tenant]
	if s == nil {
		s = &tstate{k: Knobs{1, 1, 1, 1}}
		c.st[tenant] = s
	}
	s.pinned = true
	evs := c.transition(tenant, s, pol, at, lvl, ReasonPin, false, actor, "pinned by "+actor)
	for i := range evs {
		evs[i].Actor = actor
	}
	c.mu.Unlock()
	c.emit(evs)
	return nil
}

// Unpin returns control to the automatic ladder; calm timers restart now.
func (c *Controller) Unpin(tenant, actor string) error {
	c.mu.Lock()
	pol, ok := c.d.Policy(tenant)
	s := c.st[tenant]
	if !ok || s == nil || !s.pinned {
		c.mu.Unlock()
		return fmt.Errorf("throttle: tenant %q is not pinned", tenant)
	}
	at := c.d.Now()
	s.pinned = false
	s.lastHarm, s.enteredAt = at, at
	ev := Event{TS: at, Tenant: tenant, From: s.level, To: s.level, Reason: ReasonUnpin, Actor: actor,
		Evidence: c.evidence(s, at, "unpinned by "+actor)}
	ev.Explanation = Explain(ev, pol)
	s.lastEv = &ev
	c.mu.Unlock()
	c.emit([]Event{ev})
	return nil
}

// State is the tenant-visible throttle state (contract ThrottleState).
type State struct {
	Level       Level     `json:"level"`
	Since       time.Time `json:"since"`
	Pinned      bool      `json:"pinned"`
	Explanation string    `json:"explanation"`
	Evidence    *Evidence `json:"evidence,omitempty"`
	Actions     []string  `json:"actions"`
}

// State returns the current level and the explanation of the latest decision.
func (c *Controller) State(tenant string) State {
	c.mu.Lock()
	defer c.mu.Unlock()
	s := c.st[tenant]
	if s == nil {
		return State{Level: Normal, Explanation: "No throttling applied.", Actions: []string{}}
	}
	out := State{Level: s.level, Since: s.enteredAt, Pinned: s.pinned, Actions: []string{}}
	if s.lastEv != nil {
		out.Explanation = s.lastEv.Explanation
		ev := s.lastEv.Evidence
		out.Evidence = &ev
		for _, a := range s.lastEv.Actions {
			out.Actions = append(out.Actions, fmt.Sprintf("%s=%g", a.Kind, a.Value))
		}
	}
	if out.Explanation == "" {
		out.Explanation = "No throttling applied."
	}
	return out
}

// SetPanic switches the global panic rail: while on, free-tier tenants are held
// at Hard or above so paying tenants keep their share. Turning it off lets them
// recover through the normal ladder (calm timers start now).
func (c *Controller) SetPanic(on bool, actor string) {
	c.mu.Lock()
	if c.panic == on || c.d.List == nil {
		c.panic = on
		c.mu.Unlock()
		return
	}
	c.panic = on
	at := c.d.Now()
	pols := c.d.List()
	ids := make([]string, 0, len(pols))
	for t, p := range pols {
		if p.Tier == policy.TierFree {
			ids = append(ids, t)
		}
	}
	sort.Strings(ids)
	var evs []Event
	for _, t := range ids {
		pol := pols[t]
		s := c.st[t]
		if on {
			if s == nil {
				s = &tstate{k: Knobs{1, 1, 1, 1}}
				c.st[t] = s
			}
			if s.pinned || s.level >= Hard {
				continue
			}
			es := c.transition(t, s, pol, at, Hard, ReasonPanic, false, "system", "panic mode on, set by "+actor)
			for i := range es {
				es[i].Actor = actor
			}
			evs = append(evs, es...)
			continue
		}
		if s == nil || s.pinned || s.level == Normal {
			continue
		}
		s.lastHarm, s.enteredAt = at, at
		ev := Event{TS: at, Tenant: t, From: s.level, To: s.level, Reason: ReasonPanicClear, Actor: actor,
			Evidence: c.evidence(s, at, "panic mode off, set by "+actor)}
		ev.Explanation = Explain(ev, pol)
		s.lastEv = &ev
		evs = append(evs, ev)
	}
	c.mu.Unlock()
	c.emit(evs)
}

func differ(a, b float64) bool { return math.Abs(a-b) > 1e-9*math.Max(1, math.Abs(a)) }

func b2f(b bool) float64 {
	if b {
		return 1
	}
	return 0
}
