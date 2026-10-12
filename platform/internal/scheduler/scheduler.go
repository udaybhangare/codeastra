// Package scheduler decides which queued invocation runs next (docs/03 §3.3).
// DRR is the isolation-ON policy; FIFO is the isolation-OFF baseline; Switch
// swaps between them at runtime without losing queued work.
package scheduler

import (
	"errors"
	"math"
	"sync/atomic"
	"time"
)

var (
	ErrQueueFull = errors.New("scheduler: queue full")
	ErrClosed    = errors.New("scheduler: closed") // retry against the new scheduler
)

// Job is one queued invocation. Cost is the estimated cost unit; the scheduler
// treats Payload as opaque.
type Job struct {
	Tenant     string
	Cost       float64
	EnqueuedAt time.Time
	Payload    any
	// OnDrop is called if the job is discarded (e.g. a swap overflowed the new queue).
	OnDrop func(error)
}

// Eligible reports whether the dispatcher can start a job for this tenant right now
// (global slot free, tenant concurrency cap, quarantine slot cap).
type Eligible func(tenant string, quarantined bool) bool

type Scheduler interface {
	// Enqueue is safe from any goroutine. Returns ErrQueueFull (drop-tail) when the
	// tenant's bounded queue is full.
	Enqueue(j *Job) error
	// Next picks the next job that is eligible. Call from ONE goroutine (the dispatcher).
	Next(ok Eligible) (*Job, bool)
	Depth(tenant string) int
	// SetWeight sets the tenant's effective DRR weight (> 0). No-op for FIFO.
	SetWeight(tenant string, w float64)
	SetQuarantine(tenant string, on bool)
	SetQueueCap(tenant string, n int)
	// SetNotify registers a callback fired (non-blocking) when new work arrives.
	SetNotify(fn func())
	// Drain closes the scheduler (Enqueue → ErrClosed) and returns everything queued.
	Drain() []*Job
}

// atomicF64 is a float64 usable from many goroutines.
type atomicF64 struct{ b atomic.Uint64 }

func (a *atomicF64) Load() float64   { return math.Float64frombits(a.b.Load()) }
func (a *atomicF64) Store(v float64) { a.b.Store(math.Float64bits(v)) }
