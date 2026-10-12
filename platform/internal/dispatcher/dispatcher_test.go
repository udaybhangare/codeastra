package dispatcher

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/bulkhead/platform/internal/cost"
	"github.com/bulkhead/platform/internal/policy"
	"github.com/bulkhead/platform/internal/scheduler"
)

type pols map[string]policy.Policy

func (p pols) Get(t string) (policy.Policy, bool) { v, ok := p[t]; return v, ok }

type backend map[string]string

func (b backend) Addr(t string) (string, bool) { v, ok := b[t]; return v, ok }

// fakeWorker records concurrency per tenant (tenant is carried in params).
type fakeWorker struct {
	hold   time.Duration
	cur    map[string]int
	maxCur map[string]int
	maxAll int
	all    int
	mu     sync.Mutex
	srv    *httptest.Server
}

func newFakeWorker(hold time.Duration) *fakeWorker {
	f := &fakeWorker{hold: hold, cur: map[string]int{}, maxCur: map[string]int{}}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Params map[string]any `json:"params"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		t, _ := req.Params["t"].(string)
		f.mu.Lock()
		f.cur[t]++
		f.all++
		f.maxCur[t] = max(f.maxCur[t], f.cur[t])
		f.maxAll = max(f.maxAll, f.all)
		f.mu.Unlock()
		time.Sleep(f.hold)
		f.mu.Lock()
		f.cur[t]--
		f.all--
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"task":"cpu-burn","wall_ms":10,"cpu_ms":40,"mem_peak_mb":10,"bytes":1024}`))
	}))
	return f
}

func (f *fakeWorker) peak(t string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	if t == "" {
		return f.maxAll
	}
	return f.maxCur[t]
}

type harness struct {
	d    *Dispatcher
	est  *cost.Estimator
	stop context.CancelFunc
}

func start(t *testing.T, cfg Config, p pols, b backend) *harness {
	t.Helper()
	est := cost.NewEstimator(cost.DefaultWeights)
	sw := scheduler.NewSwitch(scheduler.DRRConfig{}, 1000)
	d := New(cfg, sw, b, p, est)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { d.Run(ctx); close(done) }()
	t.Cleanup(func() { cancel(); <-done })
	return &harness{d: d, est: est, stop: cancel}
}

func pol(id string, conc, depth, weight int) policy.Policy {
	return policy.Policy{TenantID: id, Weight: weight, Concurrency: conc, QueueDepth: depth}
}

func TestSubmitReturnsActualCostAndUpdatesEstimator(t *testing.T) {
	w := newFakeWorker(0)
	defer w.srv.Close()
	h := start(t, Config{}, pols{"a": pol("a", 4, 10, 1)}, backend{"a": w.srv.URL})
	params := map[string]any{"t": "a", "ms": 40.0}
	_, before := h.est.Estimate("a", "cpu-burn", params)
	res, err := h.d.Submit(context.Background(), Request{TenantID: "a", Task: "cpu-burn", Params: params, EstCost: before})
	if err != nil || !res.OK || res.Status != 200 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	want := cost.DefaultWeights.Unit(cost.Vector{CPUms: 40, MemMBms: 100, Bytes: 1024})
	if res.Cost != want {
		t.Fatalf("cost %v want %v", res.Cost, want)
	}
	if _, after := h.est.Estimate("a", "cpu-burn", params); after == before {
		t.Fatal("estimator was not updated from the actual cost")
	}
}

func TestQueueWaitUsesInjectedClock(t *testing.T) {
	w := newFakeWorker(0)
	defer w.srv.Close()
	var n atomic.Int64
	base := time.Unix(1000, 0)
	// each clock read advances 5ms: enqueue=0, start=5, finish=10
	now := func() time.Time { return base.Add(time.Duration(n.Add(1)-1) * 5 * time.Millisecond) }
	h := start(t, Config{Now: now}, pols{"a": pol("a", 4, 10, 1)}, backend{"a": w.srv.URL})
	res, err := h.d.Submit(context.Background(), Request{TenantID: "a", Task: "echo", Params: map[string]any{"t": "a"}, EstCost: 1})
	if err != nil {
		t.Fatal(err)
	}
	if res.QueueWait != 5*time.Millisecond || res.Exec != 5*time.Millisecond {
		t.Fatalf("wait=%v exec=%v", res.QueueWait, res.Exec)
	}
}

func submitN(t *testing.T, h *harness, tenant string, n int) {
	t.Helper()
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := h.d.Submit(context.Background(), Request{TenantID: tenant, Task: "echo",
				Params: map[string]any{"t": tenant}, EstCost: 1})
			if err != nil {
				t.Errorf("%s: %v", tenant, err)
			}
		}()
	}
	wg.Wait()
}

func TestGlobalAndPerTenantConcurrencyBounded(t *testing.T) {
	w := newFakeWorker(30 * time.Millisecond)
	defer w.srv.Close()
	h := start(t, Config{GlobalSlots: 3},
		pols{"a": pol("a", 1, 50, 1), "b": pol("b", 8, 50, 1)},
		backend{"a": w.srv.URL, "b": w.srv.URL})
	var wg sync.WaitGroup
	for _, id := range []string{"a", "b"} {
		wg.Add(1)
		go func() { defer wg.Done(); submitN(t, h, id, 8) }()
	}
	wg.Wait()
	if w.peak("a") != 1 {
		t.Errorf("tenant a concurrency cap 1 violated: %d", w.peak("a"))
	}
	if w.peak("") > 3 {
		t.Errorf("global slots 3 violated: %d", w.peak(""))
	}
	if w.peak("") < 2 {
		t.Errorf("no parallelism observed: %d", w.peak(""))
	}
}

func TestIsolationOffDropsPerTenantCap(t *testing.T) {
	w := newFakeWorker(30 * time.Millisecond)
	defer w.srv.Close()
	h := start(t, Config{GlobalSlots: 6}, pols{"a": pol("a", 1, 50, 1)}, backend{"a": w.srv.URL})
	h.d.SetIsolation(false)
	submitN(t, h, "a", 6)
	if w.peak("a") < 2 {
		t.Fatalf("OFF mode should ignore the per-tenant cap, max=%d", w.peak("a"))
	}
}

func TestQuarantineSlotCap(t *testing.T) {
	w := newFakeWorker(30 * time.Millisecond)
	defer w.srv.Close()
	h := start(t, Config{GlobalSlots: 8, QuarantineSlots: 2, QuarantineConc: 8},
		pols{"x": pol("x", 8, 50, 1), "y": pol("y", 8, 50, 1)},
		backend{"x": w.srv.URL, "y": w.srv.URL})
	h.d.SetQuarantine("x", true)
	h.d.SetQuarantine("y", true)
	var wg sync.WaitGroup
	for _, id := range []string{"x", "y"} {
		wg.Add(1)
		go func() { defer wg.Done(); submitN(t, h, id, 6) }()
	}
	wg.Wait()
	if w.peak("") > 2 {
		t.Fatalf("quarantine slot cap 2 violated: %d", w.peak(""))
	}
}

func TestErrors(t *testing.T) {
	slow := newFakeWorker(300 * time.Millisecond)
	defer slow.srv.Close()
	h := start(t, Config{Timeout: 50 * time.Millisecond},
		pols{"a": pol("a", 1, 1, 1), "n": pol("n", 1, 5, 1)},
		backend{"a": slow.srv.URL})
	ctx := context.Background()
	if _, err := h.d.Submit(ctx, Request{TenantID: "n", Task: "echo", EstCost: 1}); !errors.Is(err, ErrNoWorker) {
		t.Errorf("want ErrNoWorker, got %v", err)
	}
	if _, err := h.d.Submit(ctx, Request{TenantID: "a", Task: "echo", Params: map[string]any{"t": "a"}, EstCost: 1}); !errors.Is(err, ErrTimeout) {
		t.Errorf("want ErrTimeout, got %v", err)
	}
	// queue depth 1 with 1 slot busy: second queued ok, third rejected
	h2 := start(t, Config{GlobalSlots: 1}, pols{"a": pol("a", 1, 1, 1)}, backend{"a": slow.srv.URL})
	errs := make(chan error, 3)
	for i := 0; i < 3; i++ {
		go func() {
			_, err := h2.d.Submit(ctx, Request{TenantID: "a", Task: "echo", Params: map[string]any{"t": "a"}, EstCost: 1})
			errs <- err
		}()
		time.Sleep(40 * time.Millisecond)
	}
	full := 0
	for i := 0; i < 3; i++ {
		if errors.Is(<-errs, ErrQueueFull) {
			full++
		}
	}
	if full != 1 {
		t.Errorf("want exactly 1 ErrQueueFull, got %d", full)
	}
}

func TestCallerCancelWhileQueuedFreesWork(t *testing.T) {
	w := newFakeWorker(100 * time.Millisecond)
	defer w.srv.Close()
	h := start(t, Config{GlobalSlots: 1}, pols{"a": pol("a", 1, 10, 1)}, backend{"a": w.srv.URL})
	go h.d.Submit(context.Background(), Request{TenantID: "a", Task: "echo", Params: map[string]any{"t": "a"}, EstCost: 1})
	time.Sleep(20 * time.Millisecond)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := h.d.Submit(ctx, Request{TenantID: "a", Task: "echo", Params: map[string]any{"t": "a"}, EstCost: 1}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("want deadline exceeded, got %v", err)
	}
	time.Sleep(200 * time.Millisecond)
	if w.peak("") != 1 {
		t.Fatalf("cancelled job must not run; max concurrent %d", w.peak(""))
	}
}
