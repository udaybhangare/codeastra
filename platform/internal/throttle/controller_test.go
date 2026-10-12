package throttle

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/bulkhead/platform/internal/detector"
	"github.com/bulkhead/platform/internal/policy"
)

var t0 = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

type fakeAct struct {
	weight   map[string]float64
	quar     map[string]bool
	rate     map[string]float64
	burst    map[string]bool
	cpus     map[string]float64
	dbCap    map[string]int
	cpuCalls int
}

func newFake() *fakeAct {
	return &fakeAct{map[string]float64{}, map[string]bool{}, map[string]float64{}, map[string]bool{},
		map[string]float64{}, map[string]int{}, 0}
}
func (f *fakeAct) SetWeight(t string, w float64)          { f.weight[t] = w }
func (f *fakeAct) SetQuarantine(t string, on bool)        { f.quar[t] = on }
func (f *fakeAct) SetBuckets(t string, m float64, b bool) { f.rate[t], f.burst[t] = m, b }
func (f *fakeAct) SetConnCap(t string, n int)             { f.dbCap[t] = n }
func (f *fakeAct) Update(_ context.Context, t string, c float64, _ int64) error {
	f.cpus[t] = c
	f.cpuCalls++
	return nil
}

type sink struct{ evs []Event }

func (s *sink) Publish(e Event) { s.evs = append(s.evs, e) }

type rig struct {
	c    *Controller
	f    *fakeAct
	sink *sink
	now  time.Time
	pols map[string]policy.Policy
}

func newRig(cfg Config, pred bool) *rig {
	r := &rig{f: newFake(), sink: &sink{}, now: t0, pols: map[string]policy.Policy{}}
	for _, n := range []string{"rogue", "rogue2", "rogue3", "rogue4"} {
		r.pols[n] = policy.Policy{TenantID: n, Weight: 4, ReserveCPU: 0.4, LimitCPU: 2, LimitMemMB: 1024, DBConns: 10}
	}
	cfg.PredictiveEnabled = pred
	r.c = New(cfg, Deps{
		Policy:    func(t string) (policy.Policy, bool) { p, ok := r.pols[t]; return p, ok },
		Act:       Actuators{Scheduler: r.f, Buckets: r.f, Cgroup: r.f, DB: r.f},
		Publisher: r.sink,
		Now:       func() time.Time { return r.now },
	})
	return r
}

func finding(t string, score float64) detector.Finding {
	return detector.Finding{Culprit: t, Score: score, Victims: []string{"acme"}, Evidence: detector.Evidence{
		Resources: []detector.ResourceEvidence{{Resource: "cpu", Share: 0.71, Entitlement: 0.2, Excess: 0.51, Corr: 0.91, Contribution: score}},
		Victims:   []detector.VictimEvidence{{Tenant: "acme", Inflation: 6.2, P99Ms: 620, BaselineMs: 100}},
	}}
}

// tick advances 1 s per call and feeds findings for tenants with score > 0.
func (r *rig) tick(scores map[string]float64) {
	var fs []detector.Finding
	for t, s := range scores {
		if s > 0 {
			fs = append(fs, finding(t, s))
		}
	}
	r.c.Observe(r.now, fs)
	r.now = r.now.Add(time.Second)
}

func (r *rig) run(n int, scores map[string]float64) {
	for i := 0; i < n; i++ {
		r.tick(scores)
	}
}

func (r *rig) lvl(t string) Level { return r.c.Level(t) }

func TestEscalationTimings(t *testing.T) {
	r := newRig(Config{}, false)
	hot := map[string]float64{"rogue": 0.2}
	want := map[int]Level{0: Observe, 2: Observe, 3: Soft, 7: Soft, 8: Hard, 15: Hard, 16: Quarantine}
	for sec := 0; sec <= 20; sec++ {
		r.tick(hot)
		if w, ok := want[sec]; ok && r.lvl("rogue") != w {
			t.Fatalf("t=%ds: level %v, want %v", sec, r.lvl("rogue"), w)
		}
	}
	if !r.f.quar["rogue"] {
		t.Fatal("quarantine lane not set")
	}
	var reasons []string
	for _, e := range r.sink.evs {
		reasons = append(reasons, e.Reason)
	}
	if got := strings.Join(reasons, ","); got != "DETECTED,SUSTAINED,PERSISTED,PERSISTED" {
		t.Fatalf("reasons = %s", got)
	}
}

func TestActionsAndSafetyFloors(t *testing.T) {
	r := newRig(Config{}, false)
	r.run(10, map[string]float64{"rogue": 0.2}) // Hard at t=8
	if r.lvl("rogue") != Hard {
		t.Fatalf("level %v", r.lvl("rogue"))
	}
	// cpu 2×0.4=0.8 ≥ floor 0.4×0.5=0.2; weight 4×0.5; rate .5; db 10×.5
	if r.f.cpus["rogue"] != 0.8 || r.f.weight["rogue"] != 2 || r.f.rate["rogue"] != 0.5 || r.f.dbCap["rogue"] != 5 || r.f.burst["rogue"] {
		t.Fatalf("hard actions: cpu=%v w=%v rate=%v db=%v burst=%v", r.f.cpus["rogue"], r.f.weight["rogue"], r.f.rate["rogue"], r.f.dbCap["rogue"], r.f.burst["rogue"])
	}
	// high reservation: floor (reserve×0.5 = 1.8) beats 0.4×limit
	r2 := newRig(Config{}, false)
	p := r2.pols["rogue"]
	p.ReserveCPU = 3.6
	p.LimitCPU = 4
	r2.pols["rogue"] = p
	r2.run(10, map[string]float64{"rogue": 0.2})
	if r2.f.cpus["rogue"] != 1.8 {
		t.Fatalf("floor not honoured: %v", r2.f.cpus["rogue"])
	}
	r2.run(10, map[string]float64{"rogue": 0.2}) // → Quarantine, floor may be broken
	if r2.lvl("rogue") != Quarantine || r2.f.cpus["rogue"] >= 1.8 {
		t.Fatalf("quarantine cpu=%v level=%v", r2.f.cpus["rogue"], r2.lvl("rogue"))
	}
}

func TestNoFlappingUnderNoisyScore(t *testing.T) {
	r := newRig(Config{}, false)
	r.run(10, map[string]float64{"rogue": 0.2}) // Hard
	// harm blinks on/off every second for 2 minutes (and dips below τ₁)
	for i := 0; i < 120; i++ {
		s := 0.0
		switch i % 3 {
		case 0:
			s = 0.2
		case 1:
			s = 0.01 // below τ₁ → not harm
		}
		r.tick(map[string]float64{"rogue": s})
		if r.lvl("rogue") < Hard {
			t.Fatalf("flapped down to %v at i=%d", r.lvl("rogue"), i)
		}
	}
	for _, e := range r.sink.evs {
		if e.Reason == ReasonRecovered {
			t.Fatalf("recovery event under noisy harm: %+v", e)
		}
	}
}

func TestRecoveryCurveAIMD(t *testing.T) {
	r := newRig(Config{}, false)
	r.run(9, map[string]float64{"rogue": 0.2}) // Hard, cpu .8
	prev := r.f.cpus["rogue"]
	var steps []float64
	steps = append(steps, prev)
	downAt := -1
	for i := 0; i < 120 && r.lvl("rogue") != Normal || i < 1; i++ {
		r.tick(nil)
		if r.lvl("rogue") == Soft && downAt < 0 {
			downAt = i
		}
		c := r.f.cpus["rogue"]
		if c < prev-1e-9 {
			t.Fatalf("cpu decreased during calm: %v → %v", prev, c)
		}
		if c != prev {
			steps = append(steps, c)
		}
		prev = c
	}
	// harm last seen t=8 (tick index 8); calm 15 s → Soft at tick idx 15 of this loop (t=23)
	if downAt < 0 {
		t.Fatal("never recovered to Soft")
	}
	if r.lvl("rogue") != Normal {
		t.Fatalf("not fully recovered: %v", r.lvl("rogue"))
	}
	for i := 0; i < 80; i++ { // AIMD tail finishes after the level reaches Normal
		r.tick(nil)
		prev = r.f.cpus["rogue"]
	}
	if prev != 2 {
		t.Fatalf("cpu %v, want full limit 2", prev)
	}
	// additive increase = 10% of the gap: first ramp step from 0.8 toward 2.0 (Soft target) is +0.12
	if len(steps) < 6 || steps[1] < 0.8+0.1*1.2-1e-6 || steps[1] > 0.8+0.1*1.2+1e-6 {
		t.Fatalf("ramp not gradual: %v", steps)
	}
	if r.f.rate["rogue"] != 1 || !r.f.burst["rogue"] || r.f.dbCap["rogue"] != 0 || r.f.weight["rogue"] != 4 {
		t.Fatalf("limits not restored: %+v", r.f)
	}
}

func TestReoffenseSkipsUpAndHalves(t *testing.T) {
	r := newRig(Config{}, false)
	r.run(1, map[string]float64{"rogue": 0.2}) // Observe
	r.run(10, nil)                             // calm → Normal
	if r.lvl("rogue") != Normal {
		t.Fatalf("expected Normal, got %v", r.lvl("rogue"))
	}
	r.run(20, nil)
	r.tick(map[string]float64{"rogue": 0.2}) // back within 60 s
	if r.lvl("rogue") != Soft {
		t.Fatalf("re-offense should land at Soft, got %v", r.lvl("rogue"))
	}
	last := r.sink.evs[len(r.sink.evs)-1]
	if last.Reason != ReasonReoffense {
		t.Fatalf("reason %s", last.Reason)
	}
	// after >60 s of calm a new offense starts from scratch at Observe
	r2 := newRig(Config{}, false)
	r2.run(1, map[string]float64{"rogue": 0.2})
	r2.run(100, nil)
	r2.tick(map[string]float64{"rogue": 0.2})
	if r2.lvl("rogue") != Observe {
		t.Fatalf("late re-offense should be Observe, got %v", r2.lvl("rogue"))
	}
}

func TestPinUnpin(t *testing.T) {
	r := newRig(Config{}, false)
	if err := r.c.Pin("rogue", Hard, "admin:uday"); err != nil {
		t.Fatal(err)
	}
	r.run(120, nil)
	if r.lvl("rogue") != Hard || r.f.cpus["rogue"] != 0.8 {
		t.Fatalf("pin did not hold: %v cpu=%v", r.lvl("rogue"), r.f.cpus["rogue"])
	}
	if e := r.sink.evs[0]; e.Reason != ReasonPin || e.Actor != "admin:uday" {
		t.Fatalf("pin event %+v", e)
	}
	if err := r.c.Unpin("rogue", "admin:uday"); err != nil {
		t.Fatal(err)
	}
	r.run(50, nil)
	if r.lvl("rogue") >= Hard {
		t.Fatalf("did not recover after unpin: %v", r.lvl("rogue"))
	}
	if r.c.Pin("nobody", Soft, "x") == nil || r.c.Unpin("rogue2", "x") == nil {
		t.Fatal("expected errors for unknown / unpinned tenant")
	}
}

func TestPredictedEntryBehindFlag(t *testing.T) {
	off := newRig(Config{}, false)
	off.c.Predict(off.now, "rogue", 0.99)
	off.run(5, nil)
	if off.lvl("rogue") != Normal || len(off.sink.evs) != 0 {
		t.Fatal("prediction must be a no-op when disabled")
	}
	on := newRig(Config{}, true)
	for i := 0; i < 6; i++ {
		on.c.Predict(on.now, "rogue", 0.9)
		on.tick(nil)
	}
	if on.lvl("rogue") != Soft {
		t.Fatalf("predicted level %v, want Soft", on.lvl("rogue"))
	}
	for _, e := range on.sink.evs {
		if e.Reason != ReasonPredicted || e.Evidence.Predicted == nil {
			t.Fatalf("bad predicted event %+v", e)
		}
	}
}

func TestLimitBreachLoopQuarantines(t *testing.T) {
	r := newRig(Config{}, false)
	r.c.ReportLimitBreach(r.now, "rogue", "oom")
	r.c.ReportLimitBreach(r.now.Add(5*time.Second), "rogue", "oom")
	if r.lvl("rogue") != Normal {
		t.Fatal("two breaches should not quarantine")
	}
	r.c.ReportLimitBreach(r.now.Add(10*time.Second), "rogue", "oom")
	if r.lvl("rogue") != Quarantine || !r.f.quar["rogue"] {
		t.Fatalf("level %v", r.lvl("rogue"))
	}
}

func TestMaxCulpritsCap(t *testing.T) {
	cfg := Config{MaxCulprits: 2}
	r := newRig(cfg, false)
	hot := map[string]float64{"rogue": 0.4, "rogue2": 0.3, "rogue3": 0.2, "rogue4": 0.15}
	r.run(8, hot)
	soft := 0
	for _, t := range []string{"rogue", "rogue2", "rogue3", "rogue4"} {
		if r.lvl(t) >= Soft {
			soft++
		}
	}
	if soft != 2 || r.lvl("rogue") < Soft || r.lvl("rogue2") < Soft {
		t.Fatalf("cap violated: %v", r.c.Levels())
	}
}

func TestEventsCarryEvidenceAndExplanation(t *testing.T) {
	r := newRig(Config{}, false)
	r.run(10, map[string]float64{"rogue": 0.2})
	if len(r.sink.evs) == 0 {
		t.Fatal("no events")
	}
	for _, e := range r.sink.evs {
		if e.Evidence.Finding == nil || len(e.Actions) == 0 || e.Explanation == "" || e.Evidence.Thresh["tau1"] == 0 {
			t.Fatalf("event lacks evidence/actions/explanation: %+v", e)
		}
	}
	got := r.sink.evs[len(r.sink.evs)-1].Explanation
	want := "rogue throttled to Hard: used 71% CPU vs 20% entitlement; acme p99 rose 6.2× (r=0.91)."
	if got != want {
		t.Fatalf("explanation\n got  %q\n want %q", got, want)
	}
}

func TestUnknownTenantIgnored(t *testing.T) {
	r := newRig(Config{}, false)
	r.tick(map[string]float64{"ghost": 0.5})
	if r.lvl("ghost") != Normal || r.f.cpuCalls != 0 {
		t.Fatal("unknown tenant must be ignored")
	}
}

func TestPanicShedsFreeTierFirst(t *testing.T) {
	r := newRig(Config{}, false)
	free, pro := r.pols["rogue"], r.pols["rogue2"]
	free.Tier, pro.Tier = policy.TierFree, policy.TierPro
	r.pols["rogue"], r.pols["rogue2"] = free, pro
	r.c.d.List = func() map[string]policy.Policy { return r.pols }

	r.c.SetPanic(true, "admin")
	if r.lvl("rogue") != Hard || r.lvl("rogue2") != Normal {
		t.Fatalf("levels: %v", r.c.Levels())
	}
	if e := r.sink.evs[0]; e.Reason != ReasonPanic || e.Actor != "admin" || e.Explanation == "" {
		t.Fatalf("event %+v", e)
	}
	r.run(60, nil) // no harm, but panic holds free tier at Hard
	if r.lvl("rogue") != Hard {
		t.Fatalf("panic should hold Hard, got %v", r.lvl("rogue"))
	}
	r.c.SetPanic(false, "admin")
	r.run(60, nil)
	if r.lvl("rogue") != Normal {
		t.Fatalf("should recover after panic off, got %v", r.lvl("rogue"))
	}
}

func TestStateAndHub(t *testing.T) {
	r := newRig(Config{}, false)
	hub := NewHub()
	ch, cancel := hub.Subscribe()
	defer cancel()
	r.c.d.Publisher = hub
	if s := r.c.State("rogue"); s.Level != Normal || s.Explanation == "" {
		t.Fatalf("calm state %+v", s)
	}
	r.run(4, map[string]float64{"rogue": 0.2})
	s := r.c.State("rogue")
	if s.Level != Soft || s.Evidence == nil || len(s.Actions) == 0 || !strings.Contains(s.Explanation, "rogue") {
		t.Fatalf("state %+v", s)
	}
	select {
	case e := <-ch:
		m := WSMessage(e)
		if m["type"] != "event" || m["kind"] != "throttle" || m["tenant_id"] != "rogue" {
			t.Fatalf("ws message %+v", m)
		}
	default:
		t.Fatal("hub delivered nothing")
	}
}
