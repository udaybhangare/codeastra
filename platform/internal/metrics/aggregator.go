// Package metrics turns request events into per-tenant 1-second windows with
// accurate tail latency, host/container usage, fairness metrics, and fan-out
// to subscribers (detector, WebSocket hub, ledger).
package metrics

import (
	"context"
	"runtime"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// Config for an Aggregator. All time comes from Now.
type Config struct {
	Now    func() time.Time
	Window time.Duration // default 1s
	Ring   int           // windows kept per tenant, default 600 (10 min)
	Buffer int           // event channel capacity, default 8192

	Cores       float64                     // host cores (default runtime.NumCPU)
	Entitlement func(tenant string) float64 // guaranteed cores; 0/nil = unknown
	Gauges      func(tenant string) (queueDepth, inflight int)
	Baselines   *Baselines // shared with the detector; created when nil
	Sampler     Sampler    // optional host/container source
	// IsOffender excludes tenants from victim-inflation. Default: a tenant is an
	// offender while it uses more than its entitlement.
	IsOffender func(tenant string) bool
}

// Counters are cumulative per-tenant totals.
type Counters struct {
	Requests, OK, Rejected, Errors uint64
	CPUms, DBms, Bytes, Cost       float64
}

type tenantAgg struct {
	total, qw, exec Histogram
	n, ok, rej, err int
	cpu, db, bytes  float64
	cost, mem       float64

	ring       []Window // guarded by Aggregator.rmu
	head, size int
	cum        Counters
}

// Aggregator ingests events and emits closed windows. Ingest/Advance must be
// called from a single goroutine (Run does); readers are concurrency-safe.
type Aggregator struct {
	cfg Config
	ch  chan Event

	dropped atomic.Uint64

	// owned by the aggregating goroutine
	tenants map[string]*tenantAgg
	cur     time.Time

	rmu     sync.RWMutex // ring, last snapshot, counters
	last    Snapshot
	subWin  []chan<- Window
	subSnap []chan<- Snapshot

	smu    sync.Mutex // latest sampler reading
	host   Host
	stats  map[string]TenantStat
	subDrp atomic.Uint64
}

func New(cfg Config) *Aggregator {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Window <= 0 {
		cfg.Window = time.Second
	}
	if cfg.Ring <= 0 {
		cfg.Ring = 600
	}
	if cfg.Buffer <= 0 {
		cfg.Buffer = 8192
	}
	if cfg.Cores <= 0 {
		cfg.Cores = float64(runtime.NumCPU())
	}
	if cfg.Baselines == nil {
		cfg.Baselines = NewBaselines(BaselineConfig{})
	}
	return &Aggregator{cfg: cfg, ch: make(chan Event, cfg.Buffer), tenants: map[string]*tenantAgg{}}
}

// Baselines returns the calm-baseline tracker shared with the detector.
func (a *Aggregator) Baselines() *Baselines { return a.cfg.Baselines }

// Record enqueues an event without blocking or allocating; when the buffer is
// full the event is dropped and counted (Dropped).
func (a *Aggregator) Record(ev Event) {
	if ev.At.IsZero() {
		ev.At = a.cfg.Now()
	}
	select {
	case a.ch <- ev:
	default:
		a.dropped.Add(1)
	}
}

func (a *Aggregator) Dropped() uint64 { return a.dropped.Load() }

// Subscribe delivers every closed per-tenant Window to ch (non-blocking; a full
// channel drops the window for that subscriber).
func (a *Aggregator) Subscribe(ch chan<- Window) {
	a.rmu.Lock()
	a.subWin = append(a.subWin, ch)
	a.rmu.Unlock()
}

// SubscribeSnapshots delivers one Snapshot (all tenants + host + fairness) per tick.
func (a *Aggregator) SubscribeSnapshots(ch chan<- Snapshot) {
	a.rmu.Lock()
	a.subSnap = append(a.subSnap, ch)
	a.rmu.Unlock()
}

// Run drains events, rolls windows on the injected clock, and polls the
// sampler once per window until ctx ends.
func (a *Aggregator) Run(ctx context.Context) {
	if a.cfg.Sampler != nil {
		go a.sampleLoop(ctx)
	}
	tick := time.NewTicker(a.cfg.Window / 4)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case ev := <-a.ch:
			a.Ingest(ev)
		case <-tick.C:
			a.drain()
			a.Advance(a.cfg.Now())
		}
	}
}

func (a *Aggregator) drain() {
	for {
		select {
		case ev := <-a.ch:
			a.Ingest(ev)
		default:
			return
		}
	}
}

func (a *Aggregator) sampleLoop(ctx context.Context) {
	t := time.NewTicker(a.cfg.Window)
	defer t.Stop()
	for {
		h, s := a.cfg.Sampler.Sample(ctx)
		a.smu.Lock()
		a.host, a.stats = h, s
		a.smu.Unlock()
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// Ingest folds one event into the open window, closing earlier windows first.
func (a *Aggregator) Ingest(ev Event) {
	a.advanceTo(ev.At)
	t := a.tenants[ev.Tenant]
	if t == nil {
		t = &tenantAgg{ring: make([]Window, a.cfg.Ring)}
		a.tenants[ev.Tenant] = t
	}
	t.n++
	switch {
	case ev.Rejected():
		t.rej++
	case ev.OK():
		t.ok++
	default:
		t.err++
	}
	if !ev.Rejected() {
		t.total.Record(micros(ev.Total))
		t.qw.Record(micros(ev.QueueWait))
		t.exec.Record(micros(ev.Exec))
	}
	t.cpu += ev.CPUms
	t.db += ev.DBms
	t.bytes += float64(ev.Bytes)
	t.cost += ev.Cost
	if ev.MemPeakMB > t.mem {
		t.mem = ev.MemPeakMB
	}
}

// Advance closes every window that ended at or before now.
func (a *Aggregator) Advance(now time.Time) { a.advanceTo(now) }

func micros(d time.Duration) uint64 {
	if d <= 0 {
		return 0
	}
	return uint64(d / time.Microsecond)
}

func (a *Aggregator) advanceTo(t time.Time) {
	w := a.cfg.Window
	if a.cur.IsZero() {
		a.cur = t.Truncate(w)
		return
	}
	if gap := t.Sub(a.cur); gap > time.Duration(a.cfg.Ring)*w {
		a.cur = t.Truncate(w).Add(-time.Duration(a.cfg.Ring) * w) // skip ancient gap
	}
	for !t.Before(a.cur.Add(w)) {
		a.closeWindow(a.cur)
		a.cur = a.cur.Add(w)
	}
}

func ms(us float64) float64 { return us / 1000 }

func (a *Aggregator) closeWindow(start time.Time) {
	a.smu.Lock()
	host, stats := a.host, a.stats
	a.smu.Unlock()

	names := make([]string, 0, len(a.tenants))
	for n := range a.tenants {
		names = append(names, n)
	}
	sort.Strings(names)

	secs := a.cfg.Window.Seconds()
	snap := Snapshot{Start: start, Host: host, Windows: make([]Window, 0, len(names))}
	var xs []float64
	var victims []float64

	for _, n := range names {
		t := a.tenants[n]
		w := Window{
			Start: start, Tenant: n,
			Requests: t.n, OK: t.ok, Rejected: t.rej, Errors: t.err,
			P50: ms(t.total.Quantile(.50)), P95: ms(t.total.Quantile(.95)), P99: ms(t.total.Quantile(.99)),
			QueueWaitP50: ms(t.qw.Quantile(.50)), QueueWaitP95: ms(t.qw.Quantile(.95)), QueueWaitP99: ms(t.qw.Quantile(.99)),
			ExecP50: ms(t.exec.Quantile(.50)), ExecP95: ms(t.exec.Quantile(.95)), ExecP99: ms(t.exec.Quantile(.99)),
			CPUms: t.cpu, DBms: t.db, Bytes: t.bytes, CostUnit: t.cost, MemPeakMB: t.mem,
		}
		completions := t.ok + t.err
		cores := t.cpu / 1000 / secs
		if s, ok := stats[n]; ok {
			cores, w.MemMB = s.CPUCores, s.MemMB
		} else {
			w.MemMB = t.mem
		}
		w.CPUShare = clamp01(cores / a.cfg.Cores)
		if a.cfg.Gauges != nil {
			w.QueueDepth, w.InFlight = a.cfg.Gauges(n)
		}
		ent := 0.0
		if a.cfg.Entitlement != nil {
			ent = a.cfg.Entitlement(n)
		}
		w.Entitlement = ent / a.cfg.Cores
		w.P99Inflation = a.cfg.Baselines.Observe(&w, completions)

		if ent > 0 && (w.Requests > 0 || w.QueueDepth > 0) {
			x := cores / ent
			xs = append(xs, x)
			offender := x > 1
			if a.cfg.IsOffender != nil {
				offender = a.cfg.IsOffender(n)
			}
			if !offender && completions >= a.cfg.Baselines.cfg.MinSamples && w.P99Inflation > 0 {
				victims = append(victims, w.P99Inflation)
			}
		}
		snap.Windows = append(snap.Windows, w)

		t.total.Reset()
		t.qw.Reset()
		t.exec.Reset()
		t.n, t.ok, t.rej, t.err = 0, 0, 0, 0
		t.cpu, t.db, t.bytes, t.cost, t.mem = 0, 0, 0, 0, 0
	}

	snap.Fairness.Jain = Jain(xs)
	snap.Fairness.VictimInflation = 1
	for _, v := range victims {
		if v > snap.Fairness.VictimInflation {
			snap.Fairness.VictimInflation = v
		}
	}

	a.rmu.Lock()
	for _, w := range snap.Windows {
		t := a.tenants[w.Tenant]
		t.ring[t.head] = w
		t.head = (t.head + 1) % len(t.ring)
		if t.size < len(t.ring) {
			t.size++
		}
		t.cum.Requests += uint64(w.Requests)
		t.cum.OK += uint64(w.OK)
		t.cum.Rejected += uint64(w.Rejected)
		t.cum.Errors += uint64(w.Errors)
		t.cum.CPUms += w.CPUms
		t.cum.DBms += w.DBms
		t.cum.Bytes += w.Bytes
		t.cum.Cost += w.CostUnit
	}
	a.last = snap
	subW := append([]chan<- Window(nil), a.subWin...)
	subS := append([]chan<- Snapshot(nil), a.subSnap...)
	a.rmu.Unlock()

	for _, ch := range subS {
		select {
		case ch <- snap:
		default:
			a.subDrp.Add(1)
		}
	}
	for _, ch := range subW {
		for _, w := range snap.Windows {
			select {
			case ch <- w:
			default:
				a.subDrp.Add(1)
			}
		}
	}
}

// Latest returns the most recently closed snapshot.
func (a *Aggregator) Latest() Snapshot {
	a.rmu.RLock()
	defer a.rmu.RUnlock()
	return a.last
}

// Recent returns up to n of a tenant's latest windows, oldest first.
func (a *Aggregator) Recent(tenant string, n int) []Window {
	a.rmu.RLock()
	defer a.rmu.RUnlock()
	t := a.tenants[tenant]
	if t == nil || n <= 0 {
		return nil
	}
	if n > t.size {
		n = t.size
	}
	out := make([]Window, n)
	for i := 0; i < n; i++ {
		idx := (t.head - n + i + 2*len(t.ring)) % len(t.ring)
		out[i] = t.ring[idx]
	}
	return out
}

// Totals returns cumulative counters for a tenant (closed windows only).
func (a *Aggregator) Totals(tenant string) Counters {
	a.rmu.RLock()
	defer a.rmu.RUnlock()
	if t := a.tenants[tenant]; t != nil {
		return t.cum
	}
	return Counters{}
}
