// Package dispatcher turns scheduled jobs into worker calls: bounded global and
// per-tenant concurrency, a quarantine slot cap, per-call timeout, actual-cost
// accounting and estimator feedback (docs/02 request lifecycle steps 5–7).
package dispatcher

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/bulkhead/platform/internal/cost"
	"github.com/bulkhead/platform/internal/policy"
	"github.com/bulkhead/platform/internal/scheduler"
)

var (
	ErrQueueFull = errors.New("dispatcher: queue full")
	ErrNoWorker  = errors.New("dispatcher: no worker for tenant")
	ErrTimeout   = errors.New("dispatcher: worker call timed out")
	ErrWorker    = errors.New("dispatcher: worker call failed")
	ErrStopped   = errors.New("dispatcher: stopped")
)

// Backend resolves a tenant to its worker's base URL (workerpool.Pool does).
type Backend interface {
	Addr(tenant string) (string, bool)
}

type Policies interface {
	Get(tenantID string) (policy.Policy, bool)
}

type Config struct {
	GlobalSlots      int           // max concurrent worker calls overall (default 16)
	QuarantineSlots  int           // cap on concurrent quarantine-lane calls (default 2)
	QuarantineConc   int           // per-tenant concurrency while quarantined (default 1)
	Timeout          time.Duration // per worker call (default 30s)
	Now              func() time.Time
	Client           *http.Client
	OnComplete       func(Completion) // optional; metrics hook (prompt 07)
	DefaultTenantCap int              // in-flight cap when a tenant has no policy (default 4)
}

// Request is one admitted invocation.
type Request struct {
	TenantID string
	Task     string
	Params   map[string]any
	EstCost  float64
}

// Result of a completed invocation.
type Result struct {
	Status    int             // HTTP status to return to the caller
	OK        bool            // worker reported success
	Body      json.RawMessage // worker's JSON result
	Cost      float64         // actual cost units
	Vector    cost.Vector
	QueueWait time.Duration
	Exec      time.Duration
}

// Completion is what OnComplete receives for every finished (or failed) call.
type Completion struct {
	Tenant, Task string
	Result       Result
	Err          error
}

type workerResult struct {
	OK        bool    `json:"ok"`
	WallMS    float64 `json:"wall_ms"`
	CPUMS     float64 `json:"cpu_ms"`
	MemPeakMB float64 `json:"mem_peak_mb"`
	DBMS      float64 `json:"db_ms"`
	Bytes     int64   `json:"bytes"`
}

type pending struct {
	req  Request
	ctx  context.Context
	done chan outcome // buffered 1
}

type outcome struct {
	res Result
	err error
}

type tstate struct {
	inflight atomic.Int64
	conc     atomic.Int64
	seen     atomic.Bool
	polStamp atomic.Int64
}

type Dispatcher struct {
	cfg     Config
	sched   *scheduler.Switch
	backend Backend
	pols    Policies
	est     *cost.Estimator

	wake      chan struct{}
	global    atomic.Int64
	quar      atomic.Int64
	isolation atomic.Bool
	tenants   sync.Map // string -> *tstate
	wg        sync.WaitGroup
}

// New builds a dispatcher around a scheduler Switch. Call Run to start dispatching.
func New(cfg Config, s *scheduler.Switch, b Backend, p Policies, e *cost.Estimator) *Dispatcher {
	if cfg.GlobalSlots <= 0 {
		cfg.GlobalSlots = 16
	}
	if cfg.QuarantineSlots <= 0 {
		cfg.QuarantineSlots = 2
	}
	if cfg.QuarantineConc <= 0 {
		cfg.QuarantineConc = 1
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 30 * time.Second
	}
	if cfg.DefaultTenantCap <= 0 {
		cfg.DefaultTenantCap = 4
	}
	if cfg.Now == nil {
		cfg.Now = time.Now // constructor default; main injects the clock explicitly
	}
	if cfg.Client == nil {
		cfg.Client = &http.Client{Transport: &http.Transport{MaxIdleConnsPerHost: 32}}
	}
	d := &Dispatcher{cfg: cfg, sched: s, backend: b, pols: p, est: e, wake: make(chan struct{}, 1)}
	d.isolation.Store(s.IsDRR())
	s.SetNotify(d.poke)
	return d
}

func (d *Dispatcher) poke() {
	select {
	case d.wake <- struct{}{}:
	default:
	}
}

// Scheduler exposes the scheduler for the throttle controller (SetWeight, SetQuarantine).
func (d *Dispatcher) Scheduler() *scheduler.Switch { return d.sched }

// Depth implements admission.Queue.
func (d *Dispatcher) Depth(tenant string) int { return d.sched.Depth(tenant) }

func (d *Dispatcher) SetWeight(tenant string, w float64)   { d.sched.SetWeight(tenant, w) }
func (d *Dispatcher) SetQuarantine(tenant string, on bool) { d.sched.SetQuarantine(tenant, on) }

// SetIsolation swaps DRR (on) / FIFO (off) and toggles per-tenant concurrency caps.
func (d *Dispatcher) SetIsolation(on bool) {
	d.isolation.Store(on)
	d.sched.Use(on)
	d.poke()
}

// InFlight is the number of worker calls currently running (all tenants).
func (d *Dispatcher) InFlight() int { return int(d.global.Load()) }

func (d *Dispatcher) ts(tenant string) *tstate {
	if v, ok := d.tenants.Load(tenant); ok {
		return v.(*tstate)
	}
	v, _ := d.tenants.LoadOrStore(tenant, &tstate{})
	return v.(*tstate)
}

// syncPolicy applies weight, queue cap and concurrency from the policy snapshot
// whenever the policy changed (UpdatedAt), so later controller overrides stick.
func (d *Dispatcher) syncPolicy(tenant string) {
	pol, ok := d.pols.Get(tenant)
	st := d.ts(tenant)
	if !ok {
		return
	}
	stamp := pol.UpdatedAt.UnixNano()
	if st.seen.Load() && st.polStamp.Load() == stamp {
		return
	}
	st.polStamp.Store(stamp)
	st.seen.Store(true)
	st.conc.Store(int64(pol.Concurrency))
	d.sched.SetWeight(tenant, float64(pol.Weight))
	d.sched.SetQueueCap(tenant, pol.QueueDepth)
}

func (d *Dispatcher) eligible(tenant string, quarantined bool) bool {
	if d.global.Load() >= int64(d.cfg.GlobalSlots) {
		return false
	}
	if quarantined && d.quar.Load() >= int64(d.cfg.QuarantineSlots) {
		return false
	}
	if !d.isolation.Load() {
		return true
	}
	st := d.ts(tenant)
	limit := st.conc.Load()
	if limit <= 0 {
		limit = int64(d.cfg.DefaultTenantCap)
	}
	if quarantined {
		limit = min(limit, int64(d.cfg.QuarantineConc))
	}
	return st.inflight.Load() < limit
}

// Submit enqueues the request and blocks until it completes, the queue rejects it,
// or ctx ends. The caller must already have passed admission.
func (d *Dispatcher) Submit(ctx context.Context, r Request) (Result, error) {
	d.syncPolicy(r.TenantID)
	p := &pending{req: r, ctx: ctx, done: make(chan outcome, 1)}
	job := &scheduler.Job{Tenant: r.TenantID, Cost: r.EstCost, EnqueuedAt: d.cfg.Now(), Payload: p,
		OnDrop: func(err error) { p.done <- outcome{err: mapQueueErr(err)} }}
	if err := d.sched.Enqueue(job); err != nil {
		return Result{}, mapQueueErr(err)
	}
	select {
	case o := <-p.done:
		return o.res, o.err
	case <-ctx.Done():
		return Result{}, ctx.Err()
	}
}

func mapQueueErr(err error) error {
	if errors.Is(err, scheduler.ErrQueueFull) {
		return ErrQueueFull
	}
	return err
}

// Run dispatches until ctx ends, then waits for in-flight calls.
func (d *Dispatcher) Run(ctx context.Context) {
	defer d.wg.Wait()
	for {
		d.pump(ctx)
		select {
		case <-ctx.Done():
			for _, j := range d.sched.Drain() {
				j.Payload.(*pending).done <- outcome{err: ErrStopped}
			}
			return
		case <-d.wake:
		}
	}
}

func (d *Dispatcher) pump(ctx context.Context) {
	for ctx.Err() == nil && d.global.Load() < int64(d.cfg.GlobalSlots) {
		var lane bool
		j, ok := d.sched.Next(func(t string, q bool) bool {
			if d.eligible(t, q) {
				lane = q
				return true
			}
			return false
		})
		if !ok {
			return
		}
		p := j.Payload.(*pending)
		if err := p.ctx.Err(); err != nil { // caller gave up while queued
			p.done <- outcome{err: err}
			continue
		}
		st := d.ts(j.Tenant)
		st.inflight.Add(1)
		d.global.Add(1)
		if lane {
			d.quar.Add(1)
		}
		d.wg.Add(1)
		go func() {
			defer d.wg.Done()
			o := d.call(ctx, j, p)
			st.inflight.Add(-1)
			d.global.Add(-1)
			if lane {
				d.quar.Add(-1)
			}
			d.poke() // a slot freed
			if d.cfg.OnComplete != nil {
				d.cfg.OnComplete(Completion{Tenant: p.req.TenantID, Task: p.req.Task, Result: o.res, Err: o.err})
			}
			p.done <- o
		}()
	}
}

// call executes one job against the tenant's worker.
func (d *Dispatcher) call(ctx context.Context, j *scheduler.Job, p *pending) outcome {
	start := d.cfg.Now()
	res := Result{QueueWait: start.Sub(j.EnqueuedAt)}
	finish := func(o outcome) outcome {
		o.res.QueueWait = res.QueueWait
		o.res.Exec = d.cfg.Now().Sub(start)
		return o
	}
	addr, ok := d.backend.Addr(p.req.TenantID)
	if !ok {
		return finish(outcome{err: ErrNoWorker})
	}
	body, _ := json.Marshal(map[string]any{"task": p.req.Task, "params": p.req.Params})
	cctx, cancel := context.WithTimeout(p.ctx, d.cfg.Timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodPost, addr+"/run", bytes.NewReader(body))
	if err != nil {
		return finish(outcome{err: fmt.Errorf("%w: %v", ErrWorker, err)})
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := d.cfg.Client.Do(req)
	if err != nil {
		if errors.Is(cctx.Err(), context.DeadlineExceeded) {
			return finish(outcome{err: ErrTimeout})
		}
		if p.ctx.Err() != nil {
			return finish(outcome{err: p.ctx.Err()})
		}
		return finish(outcome{err: fmt.Errorf("%w: %v", ErrWorker, err)})
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		if errors.Is(cctx.Err(), context.DeadlineExceeded) {
			return finish(outcome{err: ErrTimeout})
		}
		return finish(outcome{err: fmt.Errorf("%w: %v", ErrWorker, err)})
	}
	var wr workerResult
	_ = json.Unmarshal(raw, &wr)
	vec := cost.Vector{CPUms: wr.CPUMS, MemMBms: wr.MemPeakMB * wr.WallMS, DBms: wr.DBMS, Bytes: float64(wr.Bytes)}
	res.Body, res.OK, res.Status, res.Vector = raw, wr.OK, resp.StatusCode, vec
	res.Cost = d.est.W.Unit(vec)
	if wr.OK {
		d.est.Observe(p.req.TenantID, p.req.Task, p.req.Params, vec)
	}
	return finish(outcome{res: res})
}
