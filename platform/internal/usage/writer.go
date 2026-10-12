// Package usage meters per-tenant consumption into a ledger and turns it into
// showback reports. Everything here is a showback / estimate, not a financial
// system of record.
package usage

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/bulkhead/platform/internal/metrics"
)

const (
	window       = time.Second
	flushEvery   = 5 * time.Second
	retainClosed = 2 * time.Minute // keep flushed windows so late events re-upsert absolute totals
)

// Row is one (tenant, 1 s window, task) usage record with absolute totals.
type Row struct {
	Tenant    string    `json:"tenant_id"`
	Window    time.Time `json:"window_start"`
	Task      string    `json:"task"`
	Req       int64     `json:"req"`
	OK        int64     `json:"ok"`
	Rejected  int64     `json:"rejected"`
	CPUms     float64   `json:"cpu_ms"`
	MemMBms   float64   `json:"mem_mb_ms"`
	DBms      float64   `json:"db_ms"`
	Bytes     int64     `json:"bytes"`
	CostUnits float64   `json:"cost_units"`
}

// WindowRow is the per-tenant window aggregate (usage_ledger table).
type WindowRow struct {
	Row           // Task is empty; totals across tasks
	P99ms float64 `json:"p99_ms"`
}

// Store persists and reads ledger rows. Write must be idempotent: rows carry
// absolute totals and replace any earlier row with the same key.
type Store interface {
	Write(ctx context.Context, rows []Row, wins []WindowRow) error
	// Rows returns task rows with from <= window_start < to; tenant "" means all tenants.
	Rows(ctx context.Context, tenant string, from, to time.Time) ([]Row, error)
}

type winKey struct {
	tenant string
	start  time.Time
}

type winAcc struct {
	tasks map[string]*Row
	p99   float64
	dirty bool
}

// Writer folds metrics events into 1 s windows and batch-upserts them.
type Writer struct {
	store Store
	now   func() time.Time
	log   *slog.Logger

	mu   sync.Mutex
	wins map[winKey]*winAcc
	p99  chan metrics.Window
}

func NewWriter(store Store, now func() time.Time, log *slog.Logger) *Writer {
	if log == nil {
		log = slog.Default()
	}
	return &Writer{store: store, now: now, log: log,
		wins: map[winKey]*winAcc{}, p99: make(chan metrics.Window, 1024)}
}

// WindowSink is the channel to pass to metrics.Aggregator.Subscribe; it supplies p99.
func (w *Writer) WindowSink() chan<- metrics.Window { return w.p99 }

// Record accounts one request outcome (completion or rejection).
func (w *Writer) Record(ev metrics.Event) {
	at := ev.At
	if at.IsZero() {
		at = w.now()
	}
	k := winKey{ev.Tenant, at.Truncate(window)}
	w.mu.Lock()
	defer w.mu.Unlock()
	acc := w.wins[k]
	if acc == nil {
		acc = &winAcc{tasks: map[string]*Row{}}
		w.wins[k] = acc
	}
	r := acc.tasks[ev.Task]
	if r == nil {
		r = &Row{Tenant: ev.Tenant, Window: k.start, Task: ev.Task}
		acc.tasks[ev.Task] = r
	}
	r.Req++
	switch {
	case ev.Rejected():
		r.Rejected++
	case ev.OK():
		r.OK++
	}
	r.CPUms += ev.CPUms
	r.MemMBms += ev.MemPeakMB * float64(ev.Exec.Milliseconds())
	r.DBms += ev.DBms
	r.Bytes += ev.Bytes
	r.CostUnits += ev.Cost
	acc.dirty = true
}

// Run flushes every 5 s until ctx ends, then once more.
func (w *Writer) Run(ctx context.Context) {
	t := time.NewTicker(flushEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			fctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			w.drainP99()
			w.flush(fctx, w.now().Add(window)) // include the open window on shutdown
			cancel()
			return
		case m := <-w.p99:
			w.setP99(m)
		case <-t.C:
			w.drainP99()
			w.flush(ctx, w.now())
		}
	}
}

func (w *Writer) drainP99() {
	for {
		select {
		case m := <-w.p99:
			w.setP99(m)
		default:
			return
		}
	}
}

func (w *Writer) setP99(m metrics.Window) {
	w.mu.Lock()
	if a := w.wins[winKey{m.Tenant, m.Start.Truncate(window)}]; a != nil {
		a.p99 = m.P99
		a.dirty = true
	}
	w.mu.Unlock()
}

// Flush writes every dirty window that closed at or before now. Exposed for tests.
func (w *Writer) Flush(ctx context.Context, now time.Time) error {
	w.drainP99()
	return w.flush(ctx, now)
}

func (w *Writer) flush(ctx context.Context, now time.Time) error {
	var rows []Row
	var wins []WindowRow
	var keys []winKey
	w.mu.Lock()
	for k, a := range w.wins {
		if !a.dirty || k.start.Add(window).After(now) {
			continue
		}
		agg := WindowRow{Row: Row{Tenant: k.tenant, Window: k.start}, P99ms: a.p99}
		for _, r := range a.tasks {
			rows = append(rows, *r)
			agg.Req += r.Req
			agg.OK += r.OK
			agg.Rejected += r.Rejected
			agg.CPUms += r.CPUms
			agg.MemMBms += r.MemMBms
			agg.DBms += r.DBms
			agg.Bytes += r.Bytes
			agg.CostUnits += r.CostUnits
		}
		wins = append(wins, agg)
		keys = append(keys, k)
	}
	w.mu.Unlock()
	if len(rows) == 0 {
		w.evict(now)
		return nil
	}
	if err := w.store.Write(ctx, rows, wins); err != nil {
		w.log.Warn("usage ledger write failed; will retry", "rows", len(rows), "err", err)
		return err // windows stay dirty
	}
	w.mu.Lock()
	for _, k := range keys {
		if a := w.wins[k]; a != nil {
			a.dirty = false
		}
	}
	w.mu.Unlock()
	w.evict(now)
	return nil
}

// evict forgets clean windows older than retainClosed.
func (w *Writer) evict(now time.Time) {
	cut := now.Add(-retainClosed)
	w.mu.Lock()
	for k, a := range w.wins {
		if !a.dirty && k.start.Before(cut) {
			delete(w.wins, k)
		}
	}
	w.mu.Unlock()
}
