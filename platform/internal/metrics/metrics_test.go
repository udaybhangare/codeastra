package metrics

import (
	"math"
	"math/rand"
	"sort"
	"testing"
	"time"
)

var t0 = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

func TestHistogramAccuracy(t *testing.T) {
	rng := rand.New(rand.NewSource(1))
	dists := map[string]func() uint64{
		"uniform":   func() uint64 { return uint64(rng.Intn(500_000)) + 1 },
		"lognormal": func() uint64 { return uint64(math.Exp(rng.NormFloat64()*1.2+9)) + 1 },
		"bimodal": func() uint64 {
			if rng.Intn(10) == 0 {
				return uint64(2_000_000 + rng.Intn(1_000_000))
			}
			return uint64(5_000 + rng.Intn(3_000))
		},
	}
	for name, gen := range dists {
		var h Histogram
		vals := make([]float64, 50_000)
		for i := range vals {
			v := gen()
			vals[i] = float64(v)
			h.Record(v)
		}
		sort.Float64s(vals)
		for _, q := range []float64{.5, .9, .95, .99, .999} {
			want := vals[int(math.Ceil(q*float64(len(vals))))-1]
			got := h.Quantile(q)
			if err := math.Abs(got-want) / want; err > 0.01 {
				t.Errorf("%s q=%v got %v want %v err %.3f%%", name, q, got, want, err*100)
			}
		}
	}
}

func TestHistogramResetAndClamp(t *testing.T) {
	var h Histogram
	h.Record(1 << 40) // clamped, must not panic
	if h.Count() != 1 || h.Quantile(1) <= 0 {
		t.Fatal("clamp failed")
	}
	h.Reset()
	if h.Count() != 0 || h.Quantile(.5) != 0 {
		t.Fatal("reset failed")
	}
}

func TestJainKnownVectors(t *testing.T) {
	cases := []struct {
		x    []float64
		want float64
	}{
		{[]float64{1, 1, 1, 1}, 1},
		{[]float64{1, 0, 0, 0}, 0.25},
		{[]float64{1, 2, 3, 4}, 100.0 / 120},
		{[]float64{5}, 1},
		{nil, 1},
		{[]float64{0, 0}, 1},
	}
	for _, c := range cases {
		if got := Jain(c.x); math.Abs(got-c.want) > 1e-9 {
			t.Errorf("Jain(%v)=%v want %v", c.x, got, c.want)
		}
	}
}

func ev(at time.Time, tenant string, total time.Duration, status int) Event {
	return Event{At: at, Tenant: tenant, Total: total, Exec: total / 2, QueueWait: total / 2, Status: status, CPUms: 10}
}

func TestWindowRollover(t *testing.T) {
	a := New(Config{Now: func() time.Time { return t0 }, Cores: 4})
	a.Ingest(ev(t0.Add(100*time.Millisecond), "a", 10*time.Millisecond, 200))
	a.Ingest(ev(t0.Add(900*time.Millisecond), "a", 20*time.Millisecond, 200))
	a.Ingest(ev(t0.Add(950*time.Millisecond), "a", 0, 429))
	if len(a.Recent("a", 5)) != 0 {
		t.Fatal("window closed early")
	}
	a.Ingest(ev(t0.Add(1100*time.Millisecond), "a", 30*time.Millisecond, 500)) // rolls window 0
	w := a.Recent("a", 5)
	if len(w) != 1 {
		t.Fatalf("want 1 window, got %d", len(w))
	}
	if w[0].Requests != 3 || w[0].OK != 2 || w[0].Rejected != 1 || w[0].Errors != 0 {
		t.Fatalf("counts: %+v", w[0])
	}
	if !w[0].Start.Equal(t0) {
		t.Fatalf("start %v", w[0].Start)
	}
	if w[0].P99 < 19.5 || w[0].P99 > 20.5 { // rejected excluded from latency
		t.Fatalf("p99 %v", w[0].P99)
	}
	// gap: jump 3s, empty windows are emitted for the idle seconds
	a.Advance(t0.Add(4500 * time.Millisecond))
	w = a.Recent("a", 10)
	if len(w) != 4 || w[1].Requests != 1 || w[2].Requests != 0 || w[3].Requests != 0 {
		t.Fatalf("gap windows: %d %+v", len(w), w)
	}
	if c := a.Totals("a"); c.Requests != 4 || c.Rejected != 1 || c.Errors != 1 {
		t.Fatalf("totals %+v", c)
	}
}

func TestRingBounded(t *testing.T) {
	a := New(Config{Now: func() time.Time { return t0 }, Ring: 5})
	a.Ingest(ev(t0, "a", time.Millisecond, 200))
	a.Advance(t0.Add(20 * time.Second))
	w := a.Recent("a", 100)
	if len(w) != 5 {
		t.Fatalf("ring len %d", len(w))
	}
	for i := 1; i < len(w); i++ {
		if !w[i].Start.After(w[i-1].Start) {
			t.Fatal("ring not ordered oldest-first")
		}
	}
}

func TestFairnessAndInflation(t *testing.T) {
	ent := map[string]float64{"hog": 1, "vic": 1}
	a := New(Config{
		Now: func() time.Time { return t0 }, Cores: 4,
		Entitlement: func(s string) float64 { return ent[s] },
		Baselines:   NewBaselines(BaselineConfig{MinSamples: 3}),
	})
	feed := func(sec int, hogCPU float64, vicLat time.Duration) {
		base := t0.Add(time.Duration(sec) * time.Second)
		for i := 0; i < 10; i++ {
			e := ev(base.Add(time.Duration(i)*10*time.Millisecond), "vic", vicLat, 200)
			e.CPUms = 50
			a.Ingest(e)
			h := ev(base.Add(time.Duration(i)*10*time.Millisecond), "hog", 5*time.Millisecond, 200)
			h.CPUms = hogCPU / 10
			a.Ingest(h)
		}
	}
	for s := 0; s < 5; s++ { // calm: both within entitlement
		feed(s, 500, 10*time.Millisecond)
	}
	a.Advance(t0.Add(5 * time.Second))
	if j := a.Latest().Fairness.Jain; j < 0.99 {
		t.Fatalf("calm jain %v", j)
	}
	b, ok := a.Baselines().Get("vic")
	if !ok || math.Abs(b.P99-10) > 0.2 {
		t.Fatalf("baseline %+v %v", b, ok)
	}
	for s := 5; s < 8; s++ { // attack: hog uses 3 cores, victim 6x slower
		feed(s, 3000, 60*time.Millisecond)
	}
	a.Advance(t0.Add(8 * time.Second))
	f := a.Latest().Fairness
	if f.Jain > 0.8 {
		t.Fatalf("attack jain %v", f.Jain)
	}
	if f.VictimInflation < 5.5 || f.VictimInflation > 6.5 {
		t.Fatalf("inflation %v", f.VictimInflation)
	}
	// baseline frozen while degraded
	b2, _ := a.Baselines().Get("vic")
	if math.Abs(b2.P99-b.P99) > 1e-9 {
		t.Fatalf("baseline drifted %v -> %v", b.P99, b2.P99)
	}
}

func TestSubscribeAndDrop(t *testing.T) {
	a := New(Config{Now: func() time.Time { return t0 }, Buffer: 2})
	ch := make(chan Window, 4)
	a.Subscribe(ch)
	a.Ingest(ev(t0, "a", time.Millisecond, 200))
	a.Advance(t0.Add(time.Second))
	select {
	case w := <-ch:
		if w.Tenant != "a" {
			t.Fatal(w)
		}
	default:
		t.Fatal("no window delivered")
	}
	for i := 0; i < 5; i++ {
		a.Record(Event{Tenant: "a", Status: 200})
	}
	if a.Dropped() != 3 {
		t.Fatalf("dropped %d", a.Dropped())
	}
}

func BenchmarkIngest(b *testing.B) {
	a := New(Config{Now: func() time.Time { return t0 }})
	e := ev(t0, "a", 12*time.Millisecond, 200)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		e.At = t0.Add(time.Duration(i%1000) * time.Millisecond)
		a.Ingest(e)
	}
}
