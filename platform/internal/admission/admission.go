// Package admission is the layered gate in front of the scheduler (docs/03 §3.2).
// Cheapest first; layers that consumed tokens are refunded if a later layer rejects.
package admission

import (
	"context"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"github.com/bulkhead/platform/internal/cost"
	"github.com/bulkhead/platform/internal/policy"
	"github.com/bulkhead/platform/internal/ratelimit"
)

type Reason string

const (
	ReasonNone        Reason = ""
	ReasonRate        Reason = "RATE"
	ReasonCostQuota   Reason = "COST_QUOTA"
	ReasonConcurrency Reason = "CONCURRENCY"
	ReasonQueueFull   Reason = "QUEUE_FULL"
	ReasonBandwidth   Reason = "BANDWIDTH"
	ReasonQuarantine  Reason = "QUARANTINE"
)

// Burst windows (seconds of allowance) for the cost and bandwidth buckets.
const (
	CostBurstSeconds      = 2
	BandwidthBurstSeconds = 2
)

type Decision struct {
	Allow      bool
	Reason     Reason
	RetryAfter time.Duration
	EstCost    float64     // estimated cost units
	EstVector  cost.Vector // estimated resource vector
	// Release must be called exactly once when an allowed request finishes (or is
	// abandoned); it frees the concurrency slot. Always non-nil.
	Release func()
}

type Policies interface {
	Get(tenantID string) (policy.Policy, bool)
}

// Queue exposes per-tenant queue depth (the scheduler, prompt 05, implements it).
type Queue interface{ Depth(tenantID string) int }

// Quarantine reports tenants whose quarantine lane is rejecting new work (prompt 10).
type Quarantine interface{ Rejects(tenantID string) bool }

// Scale reports the throttle controller's rate/cost multiplier for a tenant and
// whether burst is allowed (1, true = untouched).
type Scale interface {
	RateScale(tenantID string) (mult float64, burstOn bool)
}

type Request struct {
	TenantID string
	Task     string
	Params   map[string]any
	Bytes    int64 // request body size
}

type Admitter struct {
	Policies   Policies
	Limiter    ratelimit.Limiter
	Estimator  *cost.Estimator
	Queue      Queue      // optional
	Quarantine Quarantine // optional
	Scale      Scale      // optional: throttle multipliers (prompt 10)

	isolationOff atomic.Bool
	mu           sync.Mutex
	inflight     map[string]int
}

func New(p Policies, l ratelimit.Limiter, e *cost.Estimator) *Admitter {
	return &Admitter{Policies: p, Limiter: l, Estimator: e, inflight: map[string]int{}}
}

// SetIsolation toggles on/off. OFF = pass-through (still estimates and counts in-flight).
func (a *Admitter) SetIsolation(on bool) { a.isolationOff.Store(!on) }
func (a *Admitter) IsolationOn() bool    { return !a.isolationOff.Load() }

func (a *Admitter) InFlight(tenant string) int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.inflight[tenant]
}

func (a *Admitter) acquire(t string, limit int) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if limit > 0 && a.inflight[t] >= limit {
		return false
	}
	a.inflight[t]++
	return true
}

func (a *Admitter) releaser(t string) func() {
	var once sync.Once
	return func() {
		once.Do(func() {
			a.mu.Lock()
			if a.inflight[t] > 0 {
				a.inflight[t]--
			}
			a.mu.Unlock()
		})
	}
}

func rej(r Reason, after time.Duration, v cost.Vector, c float64) Decision {
	return Decision{Reason: r, RetryAfter: after, EstCost: c, EstVector: v, Release: func() {}}
}

// Admit runs the pipeline. Unknown tenants (no policy) are rejected as RATE.
func (a *Admitter) Admit(ctx context.Context, r Request) Decision {
	vec, units := a.Estimator.Estimate(r.TenantID, r.Task, r.Params)
	pol, ok := a.Policies.Get(r.TenantID)
	if !ok {
		return rej(ReasonRate, time.Second, vec, units)
	}
	if a.isolationOff.Load() {
		a.acquire(r.TenantID, 0)
		return Decision{Allow: true, EstCost: units, EstVector: vec, Release: a.releaser(r.TenantID)}
	}

	if a.Quarantine != nil && a.Quarantine.Rejects(r.TenantID) {
		return rej(ReasonQuarantine, 5*time.Second, vec, units)
	}

	// 2. request-rate bucket (1 token per request)
	mult, burstOn := 1.0, true
	if a.Scale != nil {
		mult, burstOn = a.Scale.RateScale(r.TenantID)
	}
	rateKey, ratePar := "rate:"+r.TenantID, ratelimit.Params{Rate: pol.RPS * mult, Burst: float64(pol.Burst) * mult}
	if !burstOn {
		ratePar.Burst = math.Max(1, ratePar.Rate) // one second of rate
	}
	if res := a.Limiter.Take(ctx, rateKey, 1, ratePar); !res.Allowed {
		return rej(ReasonRate, res.RetryAfter, vec, units)
	}

	// 3. cost bucket (the real quota). Oversize jobs are clamped to the burst so they
	// are admittable when the bucket is full instead of being rejected forever.
	costKey := "cost:" + r.TenantID
	costBurst := float64(CostBurstSeconds)
	if !burstOn {
		costBurst = 1
	}
	costPar := ratelimit.Params{Rate: pol.CostPerS * mult, Burst: pol.CostPerS * mult * costBurst}
	debit := minF(units, costPar.Burst)
	if res := a.Limiter.Take(ctx, costKey, debit, costPar); !res.Allowed {
		a.Limiter.Refund(ctx, rateKey, 1, ratePar)
		return rej(ReasonCostQuota, res.RetryAfter, vec, units)
	}
	refund := func() {
		a.Limiter.Refund(ctx, rateKey, 1, ratePar)
		a.Limiter.Refund(ctx, costKey, debit, costPar)
	}

	// 4a. concurrency cap
	if !a.acquire(r.TenantID, pol.Concurrency) {
		refund()
		return rej(ReasonConcurrency, 100*time.Millisecond, vec, units)
	}
	release := a.releaser(r.TenantID)

	// 4b. queue depth cap (drop-tail)
	if a.Queue != nil && a.Queue.Depth(r.TenantID) >= pol.QueueDepth {
		release()
		refund()
		return rej(ReasonQueueFull, 250*time.Millisecond, vec, units)
	}

	// 5. bandwidth bucket: request bytes + estimated response bytes
	bwPar := ratelimit.Params{Rate: float64(pol.BandwidthBps), Burst: float64(pol.BandwidthBps) * BandwidthBurstSeconds}
	bytes := minF(float64(r.Bytes)+vec.Bytes, bwPar.Burst)
	if res := a.Limiter.Take(ctx, "bw:"+r.TenantID, bytes, bwPar); !res.Allowed {
		release()
		refund()
		return rej(ReasonBandwidth, res.RetryAfter, vec, units)
	}
	return Decision{Allow: true, EstCost: units, EstVector: vec, Release: release}
}

func minF(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
