package lg

import (
	"bytes"
	"context"
	"encoding/json"
	"io/fs"
	"math"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/bulkhead/loadgen/scenarios"
)

func scen(t *testing.T, id string) *Scenario {
	t.Helper()
	b, err := fs.ReadFile(scenarios.FS, id+".json")
	if err != nil {
		t.Fatal(err)
	}
	sc, err := ParseScenario(b)
	if err != nil {
		t.Fatal(err)
	}
	return sc
}

func TestAllScenariosValid(t *testing.T) {
	for _, id := range []string{"S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"} {
		sc := scen(t, id)
		if sc.ID != id || len(BuildSchedule(sc, 1)) == 0 {
			t.Errorf("%s: bad scenario", id)
		}
	}
}

func TestSameSeedByteIdentical(t *testing.T) {
	for _, id := range []string{"S1", "S5", "S6"} {
		sc := scen(t, id)
		a := Canonical(BuildSchedule(sc, 42))
		b := Canonical(BuildSchedule(sc, 42))
		c := Canonical(BuildSchedule(sc, 43))
		if !bytes.Equal(a, b) {
			t.Errorf("%s: same seed differs", id)
		}
		if bytes.Equal(a, c) {
			t.Errorf("%s: different seeds identical", id)
		}
	}
}

func count(reqs []Request, tenant, phase string) int {
	n := 0
	for _, r := range reqs {
		if r.Tenant == tenant && r.Phase == phase {
			n++
		}
	}
	return n
}

func TestArrivalRates(t *testing.T) {
	mk := func(a Arrival, dur int) *Scenario {
		a.Phase = "attack"
		return &Scenario{Name: "t", Phases: []Phase{{"attack", dur}},
			Tenants: []TenantSpec{{Tenant: "x", Role: "victim", Arrivals: []Arrival{a}}}}
	}
	near := func(name string, got int, want float64, tol float64) {
		if math.Abs(float64(got)-want) > tol*want {
			t.Errorf("%s: got %d want ≈%.0f", name, got, want)
		}
	}
	near("constant", len(BuildSchedule(mk(Arrival{Process: "constant", RPS: 50}, 20), 1)), 1000, 0.01)
	near("poisson", len(BuildSchedule(mk(Arrival{Process: "poisson", RPS: 50}, 60), 1)), 3000, 0.06)
	near("ramp", len(BuildSchedule(mk(Arrival{Process: "ramp", RPS: 0, RPSEnd: 100}, 60), 1)), 3000, 0.06)
	// burst: 5 rps base, 10x for 20s in 60s => 5*40 + 50*20 = 1200
	near("burst", len(BuildSchedule(mk(Arrival{Process: "burst", RPS: 5, BurstMultiplier: 10, BurstDurationS: 20}, 60), 1)), 1200, 0.08)
}

func TestRetryFlagAndOrdering(t *testing.T) {
	reqs := BuildSchedule(scen(t, "S4"), 7)
	storm := 0
	for i, r := range reqs {
		if i > 0 && r.Offset < reqs[i-1].Offset {
			t.Fatal("schedule not sorted")
		}
		if r.IgnoreRetry {
			storm++
			if r.Tenant != "rogue-ml" || r.Phase != "attack" {
				t.Fatalf("retry flag on %s/%s", r.Tenant, r.Phase)
			}
		}
	}
	if storm == 0 {
		t.Fatal("no retry-storm requests")
	}
	if count(reqs, "acme-shop", "warmup") == 0 {
		t.Fatal("no victim traffic")
	}
}

type stubSender struct {
	delay time.Duration
	calls atomic.Int64
	fn    func(r Request, n int64) Outcome
}

func (s *stubSender) Do(ctx context.Context, r Request) Outcome {
	n := s.calls.Add(1)
	time.Sleep(s.delay)
	if s.fn != nil {
		return s.fn(r, n)
	}
	return Outcome{Status: 200, Level: -1}
}

// Open loop: a slow server (300 ms) must not slow down the arrival process,
// and measured latency includes the full service time.
func TestOpenLoopDoesNotWaitForResponses(t *testing.T) {
	sc := &Scenario{Name: "t", Phases: []Phase{{"attack", 2}},
		Tenants: []TenantSpec{{Tenant: "x", Role: "victim", Arrivals: []Arrival{{Phase: "attack", Process: "constant", RPS: 100}}}}}
	reqs := BuildSchedule(sc, 1)
	ex := &Executor{Clock: RealClock{}, Sender: &stubSender{delay: 300 * time.Millisecond}, Cfg: DefaultExecConfig()}
	t0 := time.Now()
	res, st := ex.Run(context.Background(), reqs)
	if st.Sent != int64(len(reqs)) || len(res) != len(reqs) {
		t.Fatalf("sent %d results %d want %d", st.Sent, len(res), len(reqs))
	}
	if el := time.Since(t0); el > 2*time.Second+600*time.Millisecond {
		t.Fatalf("took %v: closed-loop behaviour?", el)
	}
	if res[0].LatencyMs < 290 {
		t.Fatalf("latency %v too low", res[0].LatencyMs)
	}
}

func TestRetryPolicies(t *testing.T) {
	cfg := DefaultExecConfig()
	cfg.DefaultRetryAft = 20 * time.Millisecond
	run := func(ignore bool) int64 {
		s := &stubSender{fn: func(r Request, n int64) Outcome {
			return Outcome{Status: 429, Reason: "RATE", RetryAfter: 10 * time.Millisecond, Level: -1}
		}}
		ex := &Executor{Clock: RealClock{}, Sender: s, Cfg: cfg}
		ex.Run(context.Background(), []Request{{Tenant: "x", Phase: "attack", Task: "echo", IgnoreRetry: ignore}})
		return s.calls.Load()
	}
	if got := run(true); got != 1+int64(cfg.StormRetries) {
		t.Errorf("storm attempts %d", got)
	}
	if got := run(false); got != 1+int64(cfg.HonorRetries) {
		t.Errorf("honor attempts %d", got)
	}
}

// Small version of the 500 rps acceptance check over real HTTP + token
// refresh; the full 500 rps / 60 s run is deferred to prompt 19.
func TestHTTPSenderAchievedRate(t *testing.T) {
	var mints, invokes atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/auth/token":
			mints.Add(1)
			if r.Header.Get("X-API-Key") != "k" {
				w.WriteHeader(401)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"token": "t", "expires_in": 900})
		default:
			invokes.Add(1)
			w.Header().Set("X-Throttle-Level", "0")
			w.Write([]byte(`{"ok":true}`))
		}
	}))
	defer srv.Close()
	sc := &Scenario{Name: "t", Phases: []Phase{{"attack", 4}},
		Tenants: []TenantSpec{{Tenant: "x", Role: "victim", Arrivals: []Arrival{{Phase: "attack", Process: "poisson", RPS: 500}}}}}
	reqs := BuildSchedule(sc, 9)
	snd := NewHTTPSender(srv.URL, map[string]string{"x": "k"}, RealClock{})
	rep, err := Run(context.Background(), RunConfig{Scenario: sc, Seed: 9, Mode: "", Sender: snd, Clock: RealClock{}, Exec: DefaultExecConfig()})
	if err != nil {
		t.Fatal(err)
	}
	want := float64(len(reqs)) / 4
	if got := rep.Dispatch.AchievedRPS; math.Abs(got-want)/want > 0.02 {
		t.Errorf("achieved %.1f vs target %.1f rps", got, want)
	}
	if invokes.Load() != int64(len(reqs)) || mints.Load() != 1 {
		t.Errorf("invokes %d mints %d", invokes.Load(), mints.Load())
	}
	if st := rep.Tenants[0].Phases["attack"]; st.OK != len(reqs) || st.P99Ms <= 0 {
		t.Errorf("bad stats %+v", st)
	}
}

func TestReportMetricsAndAssertions(t *testing.T) {
	sc := &Scenario{Name: "t", Phases: []Phase{{"warmup", 10}, {"attack", 10}},
		Tenants: []TenantSpec{
			{Tenant: "v", Role: "victim", Arrivals: []Arrival{{Phase: "warmup", Process: "constant", RPS: 1}}},
			{Tenant: "r", Role: "culprit", Arrivals: []Arrival{{Phase: "attack", Process: "constant", RPS: 1}}},
			{Tenant: "p", Role: "false_positive_probe", Arrivals: []Arrival{{Phase: "attack", Process: "constant", RPS: 1}}},
		},
		Assertions: []Assertion{
			{Metric: "victim_p99_inflation", Op: "<=", Value: 1.5},
			{Metric: "time_to_mitigate_s", Op: "<=", Value: 8},
			{Metric: "false_positive_count", Op: "==", Value: 0},
		}}
	s := time.Unix(0, 0)
	res := []Result{
		{Tenant: "v", Phase: "warmup", Status: 200, LatencyMs: 10, Level: -1},
		{Tenant: "v", Phase: "attack", Status: 200, LatencyMs: 12, Level: -1},
		{Tenant: "r", Phase: "attack", Status: 200, At: 10*time.Second + 3*time.Second, Level: 3},
		{Tenant: "p", Phase: "attack", Status: 200, Level: 4},
	}
	rep := BuildReport(sc, nil, res, ExecStats{}, 1, "on", s, s)
	if rep.Metrics["victim_p99_inflation"] != 1.2 || rep.Metrics["time_to_mitigate_s"] != 3 {
		t.Errorf("metrics %v", rep.Metrics)
	}
	if !rep.Assertions[0].Pass || !rep.Assertions[1].Pass || rep.Assertions[2].Pass || rep.Pass {
		t.Errorf("assertions %+v", rep.Assertions)
	}
}
