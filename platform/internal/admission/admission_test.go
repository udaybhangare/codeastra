package admission

import (
	"context"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/bulkhead/platform/internal/cost"
	"github.com/bulkhead/platform/internal/policy"
	"github.com/bulkhead/platform/internal/ratelimit"
)

type pols map[string]policy.Policy

func (p pols) Get(id string) (policy.Policy, bool) { v, ok := p[id]; return v, ok }

type q int

func (d q) Depth(string) int { return int(d) }

type quar bool

func (b quar) Rejects(string) bool { return bool(b) }

var ctx = context.Background()

func base() policy.Policy {
	return policy.Policy{TenantID: "a", Tier: policy.TierPro, RPS: 100, Burst: 100, CostPerS: 1000,
		Concurrency: 100, QueueDepth: 100, DBConns: 1, BandwidthBps: 1 << 20, Weight: 1}
}

func setup(p policy.Policy) (*Admitter, *time.Time) {
	now := time.Unix(1000, 0)
	a := New(pols{"a": p}, ratelimit.NewMemory(func() time.Time { return now }),
		cost.NewEstimator(cost.DefaultWeights))
	return a, &now
}

func TestEachLayerRejectsWithReason(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*policy.Policy)
		setup  func(*Admitter)
		task   string
		params map[string]any
		bytes  int64
		reps   int // requests sent; the last one is checked
		want   Reason
		status int
	}{
		{"rate", func(p *policy.Policy) { p.Burst = 2; p.RPS = 1 }, nil, "echo", nil, 0, 3, ReasonRate, 429},
		{"cost", func(p *policy.Policy) { p.CostPerS = 100 }, nil, "cpu-burn", map[string]any{"ms": 150.0}, 0, 2, ReasonCostQuota, 429},
		{"concurrency", func(p *policy.Policy) { p.Concurrency = 1 }, nil, "echo", nil, 0, 2, ReasonConcurrency, 429},
		{"queue", nil, func(a *Admitter) { a.Queue = q(100) }, "echo", nil, 0, 1, ReasonQueueFull, 503},
		{"bandwidth", func(p *policy.Policy) { p.BandwidthBps = 1000 }, nil, "echo", nil, 1500, 2, ReasonBandwidth, 429},
		{"quarantine", nil, func(a *Admitter) { a.Quarantine = quar(true) }, "echo", nil, 0, 1, ReasonQuarantine, 503},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := base()
			if c.mutate != nil {
				c.mutate(&p)
			}
			a, _ := setup(p)
			if c.setup != nil {
				c.setup(a)
			}
			var d Decision
			for i := 0; i < c.reps; i++ {
				d = a.Admit(ctx, Request{TenantID: "a", Task: c.task, Params: c.params, Bytes: c.bytes})
			}
			if d.Allow || d.Reason != c.want {
				t.Fatalf("want reject %s, got allow=%v reason=%q", c.want, d.Allow, d.Reason)
			}
			if d.RetryAfter <= 0 {
				t.Fatal("retry-after must be set")
			}
			w := httptest.NewRecorder()
			WriteReject(w, d)
			if w.Code != c.status || w.Header().Get("X-Reason") != string(c.want) || w.Header().Get("Retry-After") == "" {
				t.Fatalf("http: code=%d hdr=%v", w.Code, w.Header())
			}
		})
	}
}

func TestAllowAndReleaseFreesConcurrency(t *testing.T) {
	p := base()
	p.Concurrency = 1
	a, _ := setup(p)
	d := a.Admit(ctx, Request{TenantID: "a", Task: "echo"})
	if !d.Allow || a.InFlight("a") != 1 {
		t.Fatal("first must be allowed")
	}
	if a.Admit(ctx, Request{TenantID: "a", Task: "echo"}).Allow {
		t.Fatal("second must hit cap")
	}
	d.Release()
	d.Release() // idempotent
	if a.InFlight("a") != 0 || !a.Admit(ctx, Request{TenantID: "a", Task: "echo"}).Allow {
		t.Fatal("slot should be free after Release")
	}
}

func TestRejectedLaterLayerRefundsEarlierTokens(t *testing.T) {
	p := base()
	p.Concurrency = 1
	p.CostPerS = 50 // burst 100 units
	a, _ := setup(p)
	hold := a.Admit(ctx, Request{TenantID: "a", Task: "echo"})
	for i := 0; i < 200; i++ { // all rejected by CONCURRENCY; must not drain cost/rate
		a.Admit(ctx, Request{TenantID: "a", Task: "echo"})
	}
	hold.Release()
	if d := a.Admit(ctx, Request{TenantID: "a", Task: "echo"}); !d.Allow {
		t.Fatalf("rejected requests leaked tokens: %q", d.Reason)
	}
}

func TestIsolationOffIsPassThrough(t *testing.T) {
	p := base()
	p.Burst, p.RPS, p.Concurrency = 1, 1, 1
	a, _ := setup(p)
	a.SetIsolation(false)
	for i := 0; i < 20; i++ {
		d := a.Admit(ctx, Request{TenantID: "a", Task: "cpu-burn"})
		if !d.Allow || d.EstCost <= 0 {
			t.Fatal("OFF must allow and still estimate")
		}
	}
	if a.InFlight("a") != 20 {
		t.Fatal("OFF still measures in-flight")
	}
}

func TestUnknownTenantRejected(t *testing.T) {
	a, _ := setup(base())
	if d := a.Admit(ctx, Request{TenantID: "ghost", Task: "echo"}); d.Allow {
		t.Fatal("no policy => reject")
	}
}

func TestConcurrentNoOverAdmissionBeyondBurst(t *testing.T) {
	p := base()
	p.Burst, p.RPS = 40, 1
	a, _ := setup(p) // clock frozen
	var ok atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if d := a.Admit(ctx, Request{TenantID: "a", Task: "echo"}); d.Allow {
				ok.Add(1)
			}
		}()
	}
	wg.Wait()
	if ok.Load() != 40 {
		t.Fatalf("admitted %d, want burst 40", ok.Load())
	}
}

// 1 expensive task and 500 cheap tasks must debit roughly the same cost tokens.
func TestCostProportionality(t *testing.T) {
	est := cost.NewEstimator(cost.DefaultWeights)
	_, burn := est.Estimate("a", "cpu-burn", nil)
	var cheap float64
	for i := 0; i < 500; i++ {
		_, c := est.Estimate("a", "echo", nil)
		cheap += c
	}
	if r := cheap / burn; r < 0.5 || r > 2 {
		t.Fatalf("500 echo / 1 cpu-burn cost ratio = %.2f, want ~1", r)
	}
	// and via the real bucket: cost bucket drains by est cost
	p := base()
	p.CostPerS = 1000
	a, _ := setup(p)
	if d := a.Admit(ctx, Request{TenantID: "a", Task: "cpu-burn"}); !d.Allow || d.EstCost != burn {
		t.Fatalf("burn admit: %+v", d)
	}
}
