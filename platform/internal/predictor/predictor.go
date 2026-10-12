// Package predictor is the Go side of the AI overload predictor (docs/07).
//
// It runs OFF the request hot path: once per metrics snapshot it asks the
// Python sidecar for forecasts (150 ms timeout). If the sidecar is slow it
// reuses the last prediction briefly; if it is down it uses an in-process
// EWMA fallback so detection and throttling keep working.
package predictor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/bulkhead/platform/internal/metrics"
)

// FeatureNames is the order of the per-second feature vector (docs/07).
var FeatureNames = []string{"rate", "cost_units_s", "queue_depth", "queue_wait_p95", "exec_p95",
	"cpu_share", "mem_share", "db_conns", "bytes_s", "rejections_s"}

// Prediction is one tenant's forecast.
type Prediction struct {
	P         float64  `json:"p_overload"`
	TopFactor string   `json:"top_factor"`
	ETA       *float64 `json:"eta_s"`
	Source    string   `json:"source"` // sidecar | cached | fallback
}

// Result is one prediction round.
type Result struct {
	At      time.Time
	Host    float64
	Model   string // baseline | ewma-fallback
	Tenants map[string]Prediction
}

type wireTenant struct {
	ID       string    `json:"id"`
	Features []float64 `json:"features"`
}
type wireHost struct {
	CPUUtil  float64 `json:"cpu_util"`
	MemUtil  float64 `json:"mem_util"`
	Capacity float64 `json:"capacity_cost_units_s,omitempty"`
}
type wireReq struct {
	TS      string       `json:"ts"`
	Tenants []wireTenant `json:"tenants"`
	Host    wireHost     `json:"host"`
}
type wireResp struct {
	PHost   float64 `json:"p_overload_host"`
	Model   string  `json:"model"`
	Tenants []struct {
		ID  string   `json:"id"`
		P   float64  `json:"p_overload"`
		Top string   `json:"top_factor"`
		ETA *float64 `json:"eta_s"`
	} `json:"tenants"`
}

// Client calls the sidecar's POST /predict.
type Client struct {
	Base string
	HTTP *http.Client
}

// NewClient returns a client with the 150 ms timeout of docs/07.
func NewClient(base string) *Client {
	return &Client{Base: strings.TrimRight(base, "/"), HTTP: &http.Client{Timeout: 150 * time.Millisecond}}
}

func (c *Client) predict(ctx context.Context, req wireReq) (wireResp, error) {
	var out wireResp
	body, _ := json.Marshal(req)
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Base+"/predict", bytes.NewReader(body))
	if err != nil {
		return out, err
	}
	r.Header.Set("Content-Type", "application/json")
	res, err := c.HTTP.Do(r)
	if err != nil {
		return out, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		_, _ = io.Copy(io.Discard, res.Body)
		return out, fmt.Errorf("predictor status %d", res.StatusCode)
	}
	return out, json.NewDecoder(res.Body).Decode(&out)
}

// Features builds the fixed-order vector for one closed window.
func Features(w *metrics.Window) []float64 {
	return []float64{
		float64(w.Requests), w.CostUnit, float64(w.QueueDepth), w.QueueWaitP95, w.ExecP95,
		w.CPUShare, w.MemMB, w.DBms / 1000, w.Bytes, float64(w.Rejected),
	}
}

// Config of the Service.
type Config struct {
	Client   *Client // nil = fallback only
	Capacity float64 // host capacity in cost units/s
	Now      func() time.Time
	Log      *slog.Logger
	// CacheFor is how long the last sidecar answer may stand in for a failed
	// call before the fallback takes over (default 3 s).
	CacheFor time.Duration
	OnResult func(Result) // called after every round; must not block
}

// Stats are the client-side counters surfaced on /admin/predictor.
type Stats struct {
	Calls, Errors, Fallbacks, CachedUses int64
	LastLatencyMs, AvgLatencyMs          float64
	Source                               string
}

// Service turns snapshots into Results.
type Service struct {
	cfg Config
	fb  *Fallback

	calls, errs, fbs, cached atomic.Int64
	latNs, latCnt, lastNs    atomic.Int64

	mu       sync.Mutex
	last     Result // last answer from the sidecar
	haveLast bool
	latest   Result
	source   string
	down     bool
}

// NewService builds a Service.
func NewService(cfg Config) *Service {
	if cfg.CacheFor <= 0 {
		cfg.CacheFor = 3 * time.Second
	}
	if cfg.Log == nil {
		cfg.Log = slog.Default()
	}
	return &Service{cfg: cfg, fb: NewFallback(cfg.Capacity), source: "fallback"}
}

// Latest returns the most recent round (zero Result before the first).
func (s *Service) Latest() Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.latest
}

// P returns the latest p_overload for a tenant (0 when unknown).
func (s *Service) P(tenant string) float64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.latest.Tenants[tenant].P
}

// Stats returns a copy of the counters.
func (s *Service) Stats() Stats {
	s.mu.Lock()
	src := s.source
	s.mu.Unlock()
	st := Stats{Calls: s.calls.Load(), Errors: s.errs.Load(), Fallbacks: s.fbs.Load(),
		CachedUses: s.cached.Load(), LastLatencyMs: float64(s.lastNs.Load()) / 1e6, Source: src}
	if n := s.latCnt.Load(); n > 0 {
		st.AvgLatencyMs = float64(s.latNs.Load()) / float64(n) / 1e6
	}
	return st
}

// Run consumes snapshots until ctx ends or in closes.
func (s *Service) Run(ctx context.Context, in <-chan metrics.Snapshot) {
	for {
		select {
		case <-ctx.Done():
			return
		case snap, ok := <-in:
			if !ok {
				return
			}
			s.Observe(ctx, snap)
		}
	}
}

// Observe runs one prediction round.
func (s *Service) Observe(ctx context.Context, snap metrics.Snapshot) Result {
	at := s.cfg.Now()
	req := wireReq{TS: at.UTC().Format(time.RFC3339),
		Host: wireHost{CPUUtil: clamp01(snap.Host.CPUUtil), MemUtil: clamp01(snap.Host.MemUtil), Capacity: s.cfg.Capacity}}
	for i := range snap.Windows {
		w := &snap.Windows[i]
		req.Tenants = append(req.Tenants, wireTenant{ID: w.Tenant, Features: Features(w)})
	}
	// The fallback is fed every round so it is warm when the sidecar dies.
	fbRes := s.fb.Step(at, req)

	res := fbRes
	source := "fallback"
	if s.cfg.Client != nil {
		s.calls.Add(1)
		t0 := time.Now() // latency metric only; not used in logic
		resp, err := s.cfg.Client.predict(ctx, req)
		d := time.Since(t0)
		s.lastNs.Store(int64(d))
		s.latNs.Add(int64(d))
		s.latCnt.Add(1)
		s.mu.Lock()
		switch {
		case err == nil:
			res = toResult(at, resp)
			s.last, s.haveLast, source = res, true, "sidecar"
			if s.down {
				s.cfg.Log.Info("predictor: sidecar recovered")
				s.down = false
			}
		case s.haveLast && at.Sub(s.last.At) <= s.cfg.CacheFor:
			s.errs.Add(1)
			s.cached.Add(1)
			res = s.last
			res.Tenants = tag(res.Tenants, "cached")
			source = "cached"
		default:
			s.errs.Add(1)
			s.fbs.Add(1)
			if !s.down {
				s.cfg.Log.Warn("predictor: sidecar unavailable, using in-process EWMA fallback", "err", err)
				s.down = true
			}
		}
		s.mu.Unlock()
	} else {
		s.fbs.Add(1)
	}
	if source == "sidecar" {
		res.Tenants = tag(res.Tenants, "sidecar")
	}
	s.mu.Lock()
	s.latest, s.source = res, source
	s.mu.Unlock()
	if s.cfg.OnResult != nil {
		s.cfg.OnResult(res)
	}
	return res
}

func toResult(at time.Time, r wireResp) Result {
	out := Result{At: at, Host: r.PHost, Model: r.Model, Tenants: make(map[string]Prediction, len(r.Tenants))}
	for _, t := range r.Tenants {
		out.Tenants[t.ID] = Prediction{P: t.P, TopFactor: t.Top, ETA: t.ETA}
	}
	return out
}

func tag(m map[string]Prediction, src string) map[string]Prediction {
	out := make(map[string]Prediction, len(m))
	for k, v := range m {
		v.Source = src
		out[k] = v
	}
	return out
}

func clamp01(x float64) float64 {
	if x < 0 {
		return 0
	}
	if x > 1 {
		return 1
	}
	return x
}
