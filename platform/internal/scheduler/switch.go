package scheduler

import (
	"sync"
	"sync/atomic"
)

// Switch fronts DRR and FIFO and swaps between them at runtime (isolation A/B).
// Per-tenant settings are remembered and re-applied to a DRR after a swap.
type Switch struct {
	cur    atomic.Pointer[Scheduler]
	drr    *DRR
	fifo   func() *FIFO
	isDRR  atomic.Bool
	swapMu sync.Mutex // serialises swaps only; never taken by Enqueue/Next

	setMu  sync.Mutex
	weight map[string]float64
	quar   map[string]bool
	qcap   map[string]int
	notify func()
}

// NewSwitch starts with DRR active.
func NewSwitch(cfg DRRConfig, fifoCap int) *Switch {
	s := &Switch{drr: NewDRR(cfg), fifo: func() *FIFO { return NewFIFO(fifoCap) },
		weight: map[string]float64{}, quar: map[string]bool{}, qcap: map[string]int{}}
	var sc Scheduler = s.drr
	s.cur.Store(&sc)
	s.isDRR.Store(true)
	return s
}

func (s *Switch) active() Scheduler { return *s.cur.Load() }

// IsDRR reports whether the fair scheduler is active.
func (s *Switch) IsDRR() bool { return s.isDRR.Load() }

// Use swaps the scheduler. Queued jobs are moved over in arrival order per tenant;
// jobs that no longer fit are dropped via Job.OnDrop.
func (s *Switch) Use(drr bool) {
	s.swapMu.Lock()
	defer s.swapMu.Unlock()
	if s.isDRR.Load() == drr {
		return
	}
	var next Scheduler
	if drr {
		s.drr = NewDRR(s.drr.cfg)
		next = s.drr
		s.setMu.Lock()
		for t, w := range s.weight {
			s.drr.SetWeight(t, w)
		}
		for t, q := range s.quar {
			s.drr.SetQuarantine(t, q)
		}
		for t, c := range s.qcap {
			s.drr.SetQueueCap(t, c)
		}
		s.setMu.Unlock()
	} else {
		next = s.fifo()
	}
	s.setMu.Lock()
	fn := s.notify
	s.setMu.Unlock()
	if fn != nil {
		next.SetNotify(fn)
	}
	old := s.active()
	s.cur.Store(&next)
	s.isDRR.Store(drr)
	for _, j := range old.Drain() {
		if err := next.Enqueue(j); err != nil && j.OnDrop != nil {
			j.OnDrop(err)
		}
	}
	if fn != nil {
		fn()
	}
}

func (s *Switch) Enqueue(j *Job) error {
	for {
		err := s.active().Enqueue(j)
		if err != ErrClosed {
			return err
		}
	}
}

func (s *Switch) Next(ok Eligible) (*Job, bool) { return s.active().Next(ok) }
func (s *Switch) Depth(t string) int            { return s.active().Depth(t) }
func (s *Switch) Drain() []*Job                 { return s.active().Drain() }

func (s *Switch) SetNotify(fn func()) {
	s.setMu.Lock()
	s.notify = fn
	s.setMu.Unlock()
	s.active().SetNotify(fn)
}

func (s *Switch) SetWeight(t string, w float64) {
	s.setMu.Lock()
	s.weight[t] = w
	s.setMu.Unlock()
	s.active().SetWeight(t, w)
}

func (s *Switch) SetQuarantine(t string, on bool) {
	s.setMu.Lock()
	s.quar[t] = on
	s.setMu.Unlock()
	s.active().SetQuarantine(t, on)
}

func (s *Switch) SetQueueCap(t string, n int) {
	s.setMu.Lock()
	s.qcap[t] = n
	s.setMu.Unlock()
	s.active().SetQueueCap(t, n)
}
