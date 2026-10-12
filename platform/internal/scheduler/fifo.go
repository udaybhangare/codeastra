package scheduler

import "sync"

// FIFO is the isolation-OFF baseline: one global bounded queue, strict arrival
// order, no per-tenant fairness (head-of-line blocking is the point).
type FIFO struct {
	mu     sync.Mutex
	q      []*Job
	head   int
	cap    int
	per    map[string]int
	closed bool
	notify func()
}

func NewFIFO(capacity int) *FIFO {
	if capacity <= 0 {
		capacity = 10000
	}
	return &FIFO{cap: capacity, per: map[string]int{}}
}

func (f *FIFO) SetNotify(fn func()) { f.mu.Lock(); f.notify = fn; f.mu.Unlock() }

func (f *FIFO) Enqueue(j *Job) error {
	f.mu.Lock()
	if f.closed {
		f.mu.Unlock()
		return ErrClosed
	}
	if len(f.q)-f.head >= f.cap {
		f.mu.Unlock()
		return ErrQueueFull
	}
	f.q = append(f.q, j)
	f.per[j.Tenant]++
	fn := f.notify
	f.mu.Unlock()
	if fn != nil {
		fn()
	}
	return nil
}

func (f *FIFO) Next(ok Eligible) (*Job, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.head >= len(f.q) || !ok(f.q[f.head].Tenant, false) {
		return nil, false
	}
	j := f.q[f.head]
	f.q[f.head] = nil
	f.head++
	if f.head == len(f.q) {
		f.q, f.head = f.q[:0], 0
	} else if f.head > 64 && f.head*2 > len(f.q) {
		n := copy(f.q, f.q[f.head:])
		clear(f.q[n:])
		f.q, f.head = f.q[:n], 0
	}
	if f.per[j.Tenant]--; f.per[j.Tenant] <= 0 {
		delete(f.per, j.Tenant)
	}
	return j, true
}

func (f *FIFO) Depth(tenant string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.per[tenant]
}

func (f *FIFO) SetWeight(string, float64)  {}
func (f *FIFO) SetQuarantine(string, bool) {}
func (f *FIFO) SetQueueCap(string, int)    {}

func (f *FIFO) Drain() []*Job {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = true
	out := append([]*Job(nil), f.q[f.head:]...)
	f.q, f.head = nil, 0
	f.per = map[string]int{}
	return out
}
