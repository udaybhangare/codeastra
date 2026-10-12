package scheduler

import (
	"sync"
	"sync/atomic"
)

// DRRConfig tunes the Deficit Round Robin scheduler.
type DRRConfig struct {
	BaseQuantum      float64 // cost units credited per round at weight 1 (default 100)
	MaxJobCost       float64 // cost used for credit accounting is capped here (default 20×BaseQuantum)
	DefaultQueueCap  int     // per-tenant bound until SetQueueCap (default 1000)
	QuarantineWeight float64 // weight every quarantined tenant gets in the quarantine ring (default 0.25)
	QuarantineEvery  int     // every Nth dispatch tries the quarantine ring first (default 8)
}

func (c *DRRConfig) defaults() {
	if c.BaseQuantum <= 0 {
		c.BaseQuantum = 100
	}
	if c.MaxJobCost <= 0 {
		c.MaxJobCost = 20 * c.BaseQuantum
	}
	if c.DefaultQueueCap <= 0 {
		c.DefaultQueueCap = 1000
	}
	if c.QuarantineWeight <= 0 {
		c.QuarantineWeight = 0.25
	}
	if c.QuarantineEvery <= 0 {
		c.QuarantineEvery = 8
	}
}

// tenantQ: queue fields are guarded by mu (Enqueue vs Next); ring fields
// (deficit, credited, inRing) are touched only by the single Next goroutine.
type tenantQ struct {
	id         string
	mu         sync.Mutex
	q          []*Job
	head       int
	weight     atomicF64
	cap        atomic.Int64
	quarantine atomic.Bool
	depth      atomic.Int64
	signaled   atomic.Bool // queued on d.activate and not yet picked up

	deficit  float64
	credited bool // quantum already added this visit
	inRing   int  // 0 none, 1 main, 2 quarantine
}

type ring struct {
	members []*tenantQ
	cur     int
}

// DRR is a cost-aware Deficit Round Robin scheduler: per-tenant bounded FIFO queues,
// quantum = BaseQuantum × weight, deficit reset when a queue empties, and a separate
// low-weight quarantine ring. Enqueue only takes the tenant's own lock; the ring is
// owned by the dispatcher goroutine, so there is no global lock on the dispatch path.
type DRR struct {
	cfg      DRRConfig
	tenants  sync.Map // string -> *tenantQ
	activate chan *tenantQ
	closed   atomic.Bool
	notify   atomic.Pointer[func()]

	main, quar ring
	tick       int // Next-goroutine only
}

func NewDRR(cfg DRRConfig) *DRR {
	cfg.defaults()
	return &DRR{cfg: cfg, activate: make(chan *tenantQ, 4096)}
}

func (d *DRR) tenant(id string) *tenantQ {
	if v, ok := d.tenants.Load(id); ok {
		return v.(*tenantQ)
	}
	t := &tenantQ{id: id}
	t.weight.Store(1)
	t.cap.Store(int64(d.cfg.DefaultQueueCap))
	v, _ := d.tenants.LoadOrStore(id, t)
	return v.(*tenantQ)
}

func (d *DRR) SetNotify(fn func()) { d.notify.Store(&fn) }

func (d *DRR) SetWeight(tenant string, w float64) {
	if w > 0 {
		d.tenant(tenant).weight.Store(w)
	}
}
func (d *DRR) SetQuarantine(tenant string, on bool) { d.tenant(tenant).quarantine.Store(on) }
func (d *DRR) SetQueueCap(tenant string, n int) {
	if n < 0 {
		n = 0
	}
	d.tenant(tenant).cap.Store(int64(n))
}

func (d *DRR) Depth(tenant string) int {
	if v, ok := d.tenants.Load(tenant); ok {
		return int(v.(*tenantQ).depth.Load())
	}
	return 0
}

func (d *DRR) Enqueue(j *Job) error {
	t := d.tenant(j.Tenant)
	t.mu.Lock()
	if d.closed.Load() {
		t.mu.Unlock()
		return ErrClosed
	}
	if int64(len(t.q)-t.head) >= t.cap.Load() {
		t.mu.Unlock()
		return ErrQueueFull
	}
	t.q = append(t.q, j)
	t.depth.Store(int64(len(t.q) - t.head))
	t.mu.Unlock()

	if t.signaled.CompareAndSwap(false, true) {
		select {
		case d.activate <- t:
		default: // activation channel full: Next rescans tenants (see rescan)
			t.signaled.Store(false)
		}
	}
	if fn := d.notify.Load(); fn != nil {
		(*fn)()
	}
	return nil
}

// peek returns the head job's cost without removing it.
func (t *tenantQ) peek() (*Job, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.head >= len(t.q) {
		return nil, false
	}
	return t.q[t.head], true
}

func (t *tenantQ) pop() *Job {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.head >= len(t.q) {
		return nil
	}
	j := t.q[t.head]
	t.q[t.head] = nil
	t.head++
	if t.head == len(t.q) {
		t.q, t.head = t.q[:0], 0
	} else if t.head > 64 && t.head*2 > len(t.q) {
		n := copy(t.q, t.q[t.head:])
		clear(t.q[n:])
		t.q, t.head = t.q[:n], 0
	}
	t.depth.Store(int64(len(t.q) - t.head))
	return j
}

// admit moves newly active tenants into the ring that matches their lane.
func (d *DRR) admit() {
	for {
		select {
		case t := <-d.activate:
			t.signaled.Store(false)
			d.place(t)
		default:
			return
		}
	}
}

// rescan covers the (rare) case where the activation channel overflowed.
func (d *DRR) rescan() {
	d.tenants.Range(func(_, v any) bool {
		t := v.(*tenantQ)
		if t.inRing == 0 && t.depth.Load() > 0 {
			d.place(t)
		}
		return true
	})
}

func (d *DRR) place(t *tenantQ) {
	want := 1
	if t.quarantine.Load() {
		want = 2
	}
	if t.inRing == want {
		return
	}
	if t.inRing != 0 { // lane changed while queued: leave the old ring lazily
		d.leave(t)
	}
	r := &d.main
	if want == 2 {
		r = &d.quar
	}
	r.members = append(r.members, t)
	t.inRing = want
}

func (d *DRR) leave(t *tenantQ) {
	r := &d.main
	if t.inRing == 2 {
		r = &d.quar
	}
	for i, m := range r.members {
		if m == t {
			r.members = append(r.members[:i], r.members[i+1:]...)
			if r.cur > i {
				r.cur--
			}
			if r.cur >= len(r.members) {
				r.cur = 0
			}
			break
		}
	}
	t.inRing = 0
	t.credited = false
}

func (d *DRR) Next(ok Eligible) (*Job, bool) {
	d.admit()
	d.tick++
	first, second := &d.main, &d.quar
	if d.tick%d.cfg.QuarantineEvery == 0 {
		first, second = second, first
	}
	if j, found := d.next(first, ok); found {
		return j, true
	}
	if j, found := d.next(second, ok); found {
		return j, true
	}
	if len(d.main.members) == 0 && len(d.quar.members) == 0 {
		d.rescan()
		if j, found := d.next(&d.main, ok); found {
			return j, true
		}
		return d.next(&d.quar, ok)
	}
	return nil, false
}

// next runs the DRR loop on one ring. Oversize heads keep their deficit across
// rounds (accumulation) so they never block the ring; the credited cost is capped
// at MaxJobCost so accumulation takes a bounded number of rounds.
func (d *DRR) next(r *ring, ok Eligible) (*Job, bool) {
	skipped := 0
	for len(r.members) > 0 && skipped < len(r.members) {
		if r.cur >= len(r.members) {
			r.cur = 0
		}
		t := r.members[r.cur]
		laneQuar := t.inRing == 2
		if t.quarantine.Load() != laneQuar { // lane changed: re-home
			d.leave(t)
			d.place(t)
			continue
		}
		head, has := t.peek()
		if !has {
			t.deficit, t.credited = 0, false // idle: no hoarding
			d.leave(t)
			continue
		}
		if !ok(t.id, laneQuar) {
			skipped++
			t.credited = false
			r.cur++
			continue
		}
		if !t.credited {
			w := t.weight.Load()
			if laneQuar {
				w = d.cfg.QuarantineWeight
			}
			t.deficit += d.cfg.BaseQuantum * w
			t.credited = true
		}
		c := min(head.Cost, d.cfg.MaxJobCost)
		if c <= t.deficit {
			j := t.pop()
			t.deficit -= c
			if _, more := t.peek(); !more {
				t.deficit, t.credited = 0, false
				d.leave(t)
			}
			return j, true
		}
		t.credited = false
		r.cur++
		skipped = 0 // credit was added: progress, keep cycling
	}
	return nil, false
}

func (d *DRR) Drain() []*Job {
	d.closed.Store(true)
	var out []*Job
	d.tenants.Range(func(_, v any) bool {
		t := v.(*tenantQ)
		t.mu.Lock()
		out = append(out, t.q[t.head:]...)
		t.q, t.head = nil, 0
		t.depth.Store(0)
		t.mu.Unlock()
		return true
	})
	return out
}
