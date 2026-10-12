package gateway

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/bulkhead/platform/internal/usage"
)

// timeRange reads ?from=&to= (RFC3339) or ?range=15m (ending now); default last hour.
func (s *Server) timeRange(r *http.Request) (from, to time.Time, err error) {
	q := r.URL.Query()
	to = s.Now()
	if v := q.Get("to"); v != "" {
		if to, err = time.Parse(time.RFC3339, v); err != nil {
			return
		}
	}
	span := time.Hour
	if v := q.Get("range"); v != "" {
		if span, err = time.ParseDuration(v); err != nil {
			return
		}
	}
	from = to.Add(-span)
	if v := q.Get("from"); v != "" {
		if from, err = time.Parse(time.RFC3339, v); err != nil {
			return
		}
	}
	return from, to, nil
}

func (s *Server) usageReady(w http.ResponseWriter) bool {
	if s.Usage == nil {
		writeErr(w, 503, "usage_unavailable", "usage ledger is not configured")
		return false
	}
	return true
}

func (s *Server) usageErr(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, usage.ErrRange) {
		writeErr(w, 400, "bad_range", "range must be positive and at most 24h (use from/to RFC3339 or range=15m)")
		return
	}
	s.Log.Error("usage query", "request_id", RequestID(r.Context()), "err", err)
	writeErr(w, 500, "internal", "usage query failed")
}

func (s *Server) badRange(w http.ResponseWriter, err error) bool {
	if err != nil {
		writeErr(w, 400, "bad_range", "from/to must be RFC3339 and range a duration like 15m")
		return true
	}
	return false
}

// handleMeUsage: the tenant is always the token's tenant.
func (s *Server) handleMeUsage(w http.ResponseWriter, r *http.Request) {
	if !s.usageReady(w) {
		return
	}
	t, _ := TenantFrom(r.Context())
	from, to, err := s.timeRange(r)
	if s.badRange(w, err) {
		return
	}
	u, err := s.Usage.Usage(r.Context(), t.TenantID, from, to)
	if err != nil {
		s.usageErr(w, r, err)
		return
	}
	out := map[string]any{"tenant_id": t.TenantID, "tier": t.Tier, "usage": u}
	if p, ok := s.Policies.Get(t.TenantID); ok {
		allowance := p.CostPerS * to.Sub(from).Seconds()
		q := map[string]any{"cost_per_s": p.CostPerS, "rps": p.RPS, "concurrency": p.Concurrency,
			"cost_allowance": allowance}
		if allowance > 0 {
			q["cost_used_pct"] = 100 * u.Totals.CostUnits / allowance
		}
		out["quota"] = q
	}
	writeJSON(w, 200, out)
}

func (s *Server) handleMeShowback(w http.ResponseWriter, r *http.Request) {
	if !s.usageReady(w) {
		return
	}
	t, _ := TenantFrom(r.Context())
	from, to, err := s.timeRange(r)
	if s.badRange(w, err) {
		return
	}
	sb, err := s.Usage.Showback(r.Context(), t.TenantID, from, to)
	if err != nil {
		s.usageErr(w, r, err)
		return
	}
	writeJSON(w, 200, sb)
}

// handleAdminUsage: fleet totals + top spenders; ?tenant= adds that tenant's detail.
func (s *Server) handleAdminUsage(w http.ResponseWriter, r *http.Request) {
	if !s.usageReady(w) {
		return
	}
	from, to, err := s.timeRange(r)
	if s.badRange(w, err) {
		return
	}
	top, _ := strconv.Atoi(r.URL.Query().Get("top"))
	if top <= 0 {
		top = 10
	}
	au, err := s.Usage.Admin(r.Context(), from, to, top)
	if err != nil {
		s.usageErr(w, r, err)
		return
	}
	out := map[string]any{"fleet": au}
	if id := r.URL.Query().Get("tenant"); id != "" {
		u, err := s.Usage.Usage(r.Context(), id, from, to)
		if err != nil {
			s.usageErr(w, r, err)
			return
		}
		sb, err := s.Usage.Showback(r.Context(), id, from, to)
		if err != nil {
			s.usageErr(w, r, err)
			return
		}
		out["tenant"] = map[string]any{"usage": u, "showback": sb}
	}
	writeJSON(w, 200, out)
}
