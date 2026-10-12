package predictor

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/bulkhead/platform/internal/metrics"
)

func snap(cost float64) metrics.Snapshot {
	return metrics.Snapshot{Windows: []metrics.Window{{Tenant: "t", CostUnit: cost, Requests: 5}}}
}

type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

func TestFallbackRampAlertsEarly(t *testing.T) {
	f := NewFallback(100)
	at := time.Unix(0, 0)
	cross, alert := -1, -1
	for i := 0; i < 60; i++ {
		cost := 5 + 2.5*float64(i)
		if cross < 0 && cost >= 50 {
			cross = i
		}
		r := f.Step(at, wireReq{Tenants: []wireTenant{{ID: "t", Features: []float64{0, cost}}}})
		if alert < 0 && r.Tenants["t"].P >= 0.6 {
			alert = i
		}
	}
	if alert < 0 || cross-alert < 3 {
		t.Fatalf("alert=%d cross=%d, want ≥3 s lead", alert, cross)
	}
}

func TestFallbackFlatNoAlarm(t *testing.T) {
	f := NewFallback(100)
	for i := 0; i < 600; i++ {
		cost := 20 + float64(i%7) - 3
		r := f.Step(time.Unix(0, 0), wireReq{Tenants: []wireTenant{{ID: "t", Features: []float64{0, cost}}}})
		if r.Tenants["t"].P >= 0.6 {
			t.Fatalf("false alarm at %d: %v", i, r.Tenants["t"])
		}
	}
}

func TestSidecarThenCachedThenFallback(t *testing.T) {
	down := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if down {
			http.Error(w, "boom", 500)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"p_overload_host": 0.1, "model": "baseline",
			"tenants": []map[string]any{{"id": "t", "p_overload": 0.9, "top_factor": "cost_rate_trend", "eta_s": 4.0}}})
	}))
	defer srv.Close()
	clk := &clock{t: time.Unix(1000, 0)}
	s := NewService(Config{Client: NewClient(srv.URL), Capacity: 100, Now: clk.now,
		Log: slog.New(slog.NewTextHandler(io.Discard, nil))})
	ctx := context.Background()

	r := s.Observe(ctx, snap(10))
	if p := r.Tenants["t"]; p.P != 0.9 || p.Source != "sidecar" || *p.ETA != 4 {
		t.Fatalf("sidecar: %+v", p)
	}
	down = true
	clk.t = clk.t.Add(time.Second)
	if p := s.Observe(ctx, snap(10)).Tenants["t"]; p.Source != "cached" || p.P != 0.9 {
		t.Fatalf("cached: %+v", p)
	}
	clk.t = clk.t.Add(10 * time.Second)
	if p := s.Observe(ctx, snap(10)).Tenants["t"]; p.Source != "fallback" || p.P > 0.5 {
		t.Fatalf("fallback: %+v", p)
	}
	st := s.Stats()
	if st.Errors != 2 || st.Fallbacks != 1 || st.CachedUses != 1 || st.Source != "fallback" {
		t.Fatalf("stats: %+v", st)
	}
}

func TestTimeoutIs150ms(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(500 * time.Millisecond)
	}))
	defer srv.Close()
	s := NewService(Config{Client: NewClient(srv.URL), Capacity: 100, Now: time.Now,
		Log: slog.New(slog.NewTextHandler(io.Discard, nil))})
	t0 := time.Now()
	r := s.Observe(context.Background(), snap(1))
	if d := time.Since(t0); d > 400*time.Millisecond {
		t.Fatalf("took %v", d)
	}
	if r.Model != "ewma-fallback" {
		t.Fatalf("model %s", r.Model)
	}
}

func TestNoClientIsFallbackOnly(t *testing.T) {
	s := NewService(Config{Capacity: 100, Now: time.Now})
	if r := s.Observe(context.Background(), snap(1)); r.Model != "ewma-fallback" {
		t.Fatal(r.Model)
	}
}
