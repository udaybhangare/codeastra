package gateway

import (
	"context"
	"net/http"
)

// KeyRotator replaces a tenant's API keys with one new key.
type KeyRotator interface {
	Rotate(ctx context.Context, tenantID string) (string, error)
}

// handleMeLive returns the caller's own latest 1 s window (latency, rate, queue).
// The portal polls it to draw history; other tenants' windows are never included.
func (s *Server) handleMeLive(w http.ResponseWriter, r *http.Request) {
	t, _ := TenantFrom(r.Context())
	out := map[string]any{"tenant_id": t.TenantID, "at": s.Now().UTC()}
	if s.Metrics != nil {
		for _, win := range s.Metrics.Latest().Windows {
			if win.Tenant != t.TenantID {
				continue
			}
			out["rps"], out["ok_rps"], out["rejected_rps"] = win.Requests, win.OK, win.Rejected
			out["p50_ms"], out["p95_ms"], out["p99_ms"] = win.P50, win.P95, win.P99
			out["queue_wait_p95_ms"], out["queue_depth"], out["inflight"] = win.QueueWaitP95, win.QueueDepth, win.InFlight
			out["cost_units_s"] = win.CostUnit
		}
	}
	writeJSON(w, 200, out)
}

// handleMeRotate: the tenant is always the token's tenant. The new key is
// returned once; the old key stops working immediately.
func (s *Server) handleMeRotate(w http.ResponseWriter, r *http.Request) {
	t, _ := TenantFrom(r.Context())
	key, err := s.Rotator.Rotate(r.Context(), t.TenantID)
	if err != nil {
		s.Log.Error("key rotate", "request_id", RequestID(r.Context()), "err", err)
		writeErr(w, 500, "internal", "could not rotate key")
		return
	}
	s.audit(r, t.TenantID, "apikey.rotate", t.TenantID, nil)
	writeJSON(w, 200, map[string]any{"tenant_id": t.TenantID, "api_key": key,
		"note": "shown once; the previous key no longer works"})
}
