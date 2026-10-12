package usage

import (
	"context"
	"math"
	"sync"
	"testing"
	"time"

	"github.com/bulkhead/platform/internal/cost"
	"github.com/bulkhead/platform/internal/metrics"
)

type memStore struct {
	mu     sync.Mutex
	rows   map[[3]any]Row // (tenant, window, task) → absolute row
	wins   map[[2]any]WindowRow
	writes int
}

func newMem() *memStore {
	return &memStore{rows: map[[3]any]Row{}, wins: map[[2]any]WindowRow{}}
}

func (m *memStore) Write(_ context.Context, rows []Row, wins []WindowRow) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.writes++
	for _, r := range rows {
		m.rows[[3]any{r.Tenant, r.Window, r.Task}] = r // upsert = replace
	}
	for _, w := range wins {
		m.wins[[2]any{w.Tenant, w.Window}] = w
	}
	return nil
}

func (m *memStore) Rows(_ context.Context, tenant string, from, to time.Time) ([]Row, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Row
	for _, r := range m.rows {
		if (tenant == "" || r.Tenant == tenant) && !r.Window.Before(from) && r.Window.Before(to) {
			out = append(out, r)
		}
	}
	return out, nil
}

var t0 = time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

func ev(tenant, task string, at time.Time, status int, c float64) metrics.Event {
	return metrics.Event{At: at, Tenant: tenant, Task: task, Status: status, Cost: c,
		CPUms: c * 0.8, DBms: c * 0.1, Bytes: int64(c) * 10, MemPeakMB: 32, Exec: 100 * time.Millisecond}
}

// feed returns the sum of per-request cost units (what X-Cost-Units reports).
func feed(w *Writer) (sum float64) {
	tenants := []string{"a", "b", "c"}
	tasks := []string{"echo", "cpu-burn", "db-query"}
	for i := 0; i < 600; i++ {
		at := t0.Add(time.Duration(i) * 37 * time.Millisecond)
		c := float64(1 + i%50)
		st := 200
		if i%11 == 0 {
			st, c = 429, 0
		}
		w.Record(ev(tenants[i%3], tasks[i%3+i%2*0], at, st, c))
		sum += c
	}
	return sum
}

func TestLedgerSumMatchesRequestCost(t *testing.T) {
	st := newMem()
	w := NewWriter(st, func() time.Time { return t0 }, nil)
	want := feed(w)
	if err := w.Flush(context.Background(), t0.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	rows, _ := st.Rows(context.Background(), "", t0.Add(-time.Hour), t0.Add(2*time.Hour))
	got := totalsOf(rows).CostUnits
	if math.Abs(got-want)/want > 0.01 {
		t.Fatalf("ledger %.2f vs requests %.2f", got, want)
	}
	var reqs int64
	for _, r := range rows {
		reqs += r.Req
	}
	if reqs != 600 {
		t.Fatalf("requests %d", reqs)
	}
	// per-window aggregate equals the sum of its task rows
	var wsum float64
	for _, wr := range st.wins {
		wsum += wr.CostUnits
	}
	if math.Abs(wsum-got) > 1e-6 {
		t.Fatalf("window aggregate %.2f != task rows %.2f", wsum, got)
	}
}

func TestFlushIsIdempotentAndHandlesLateEvents(t *testing.T) {
	st := newMem()
	w := NewWriter(st, func() time.Time { return t0 }, nil)
	w.Record(ev("a", "echo", t0, 200, 10))
	now := t0.Add(5 * time.Second)
	_ = w.Flush(context.Background(), now)
	_ = w.Flush(context.Background(), now) // nothing dirty: no second write
	if st.writes != 1 {
		t.Fatalf("writes=%d, want 1", st.writes)
	}
	w.Record(ev("a", "echo", t0.Add(200*time.Millisecond), 200, 5)) // late event, same window
	_ = w.Flush(context.Background(), now)
	rows, _ := st.Rows(context.Background(), "a", t0, t0.Add(time.Second))
	if len(rows) != 1 || rows[0].CostUnits != 15 || rows[0].Req != 2 {
		t.Fatalf("rows=%+v", rows)
	}
}

func TestOpenWindowNotFlushed(t *testing.T) {
	st := newMem()
	w := NewWriter(st, func() time.Time { return t0 }, nil)
	w.Record(ev("a", "echo", t0.Add(500*time.Millisecond), 200, 1))
	_ = w.Flush(context.Background(), t0.Add(900*time.Millisecond))
	if st.writes != 0 {
		t.Fatal("open window must not be written")
	}
}

func TestP99Recorded(t *testing.T) {
	st := newMem()
	w := NewWriter(st, func() time.Time { return t0 }, nil)
	w.Record(ev("a", "echo", t0, 200, 1))
	w.WindowSink() <- metrics.Window{Tenant: "a", Start: t0, P99: 42}
	_ = w.Flush(context.Background(), t0.Add(3*time.Second))
	if got := st.wins[[2]any{"a", t0}].P99ms; got != 42 {
		t.Fatalf("p99=%v", got)
	}
}

func reporter(st Store) *Reporter {
	tiers := map[string]string{"a": "free", "b": "pro", "c": "enterprise"}
	return &Reporter{Store: st, Card: DefaultRateCard(), Weights: cost.DefaultWeights,
		Tier: func(id string) string { return tiers[id] }}
}

func TestShowbackReproducesFromRawRows(t *testing.T) {
	st := newMem()
	w := NewWriter(st, func() time.Time { return t0 }, nil)
	feed(w)
	_ = w.Flush(context.Background(), t0.Add(time.Hour))
	r := reporter(st)
	from, to := t0.Add(-time.Minute), t0.Add(time.Hour)

	sb, err := r.Showback(context.Background(), "b", from, to)
	if err != nil {
		t.Fatal(err)
	}
	// Recompute independently from raw rows.
	rows, _ := st.Rows(context.Background(), "b", from, to)
	var cpu, mem, db, bytes float64
	for _, x := range rows {
		cpu += x.CPUms
		mem += x.MemMBms
		db += x.DBms
		bytes += float64(x.Bytes)
	}
	c := r.Card
	sub := (cost.DefaultWeights.A*cpu+cost.DefaultWeights.G*bytes/1024)*c.PerCostUnit +
		mem/1000/1024*c.PerGBs + db/1000*c.PerDBs
	if math.Abs(sb.Subtotal-sub) > 1e-9 {
		t.Fatalf("subtotal %.9f vs raw %.9f", sb.Subtotal, sub)
	}
	var lines, tasks float64
	for _, l := range sb.Lines {
		lines += l.Amount
	}
	for _, tl := range sb.ByTask {
		tasks += tl.Amount
	}
	if math.Abs(lines-sb.Subtotal) > 1e-9 || math.Abs(tasks-sb.Subtotal) > 1e-9 {
		t.Fatalf("lines %.9f tasks %.9f subtotal %.9f", lines, tasks, sb.Subtotal)
	}
	want := math.Max(0, sub*0.8-math.Min(sub*0.8, 50000*c.PerCostUnit))
	if math.Abs(sb.Total-want) > 1e-9 {
		t.Fatalf("total %.9f want %.9f", sb.Total, want)
	}
}

func TestTopSpendersAndFreeAllowance(t *testing.T) {
	st := newMem()
	w := NewWriter(st, func() time.Time { return t0 }, nil)
	for i := 0; i < 100; i++ {
		w.Record(ev("big", "cpu-burn", t0.Add(time.Duration(i)*time.Second), 200, 100000))
		w.Record(ev("small", "echo", t0.Add(time.Duration(i)*time.Second), 200, 1))
	}
	_ = w.Flush(context.Background(), t0.Add(time.Hour))
	r := reporter(st)
	r.Tier = func(string) string { return "free" }
	au, err := r.Admin(context.Background(), t0.Add(-time.Minute), t0.Add(time.Hour), 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(au.Top) != 1 || au.Top[0].Tenant != "big" || au.Top[0].Amount <= 0 {
		t.Fatalf("top=%+v", au.Top)
	}
	sb, _ := r.Showback(context.Background(), "small", t0.Add(-time.Minute), t0.Add(time.Hour))
	if sb.Total != 0 || sb.FreeCredit <= 0 {
		t.Fatalf("small tenant should be inside free allowance: %+v", sb)
	}
}

func TestRangeValidation(t *testing.T) {
	r := reporter(newMem())
	if _, err := r.Usage(context.Background(), "a", t0, t0); err != ErrRange {
		t.Fatal("empty range accepted")
	}
	if _, err := r.Showback(context.Background(), "a", t0, t0.Add(48*time.Hour)); err != ErrRange {
		t.Fatal("huge range accepted")
	}
}
