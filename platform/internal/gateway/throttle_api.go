package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/bulkhead/platform/internal/throttle"
)

// Throttler is the slice of the throttle controller the HTTP layer needs.
type Throttler interface {
	Level(tenant string) throttle.Level
	State(tenant string) throttle.State
	Pin(tenant string, lvl throttle.Level, actor string) error
	Unpin(tenant, actor string) error
	SetPanic(on bool, actor string)
}

// EventLister reads the decision log (throttle_events).
type EventLister interface {
	List(ctx context.Context, since time.Time, limit int) ([]throttle.Row, error)
}

func (s *Server) throttleLevel(tenant string) int {
	if s.Throttle == nil {
		return 0
	}
	return int(s.Throttle.Level(tenant))
}

func (s *Server) handleMeThrottle(w http.ResponseWriter, r *http.Request) {
	t, _ := TenantFrom(r.Context())
	st := s.Throttle.State(t.TenantID)
	// A tenant sees its level and a plain explanation, not other tenants' names:
	// strip the culprit evidence (victims/findings) from the tenant-facing view.
	writeJSON(w, 200, map[string]any{"tenant_id": t.TenantID, "tier": t.Tier, "level": st.Level,
		"since": st.Since, "explanation": st.Explanation, "actions": st.Actions})
}

// POST /admin/tenants/{id}/level  {"level": 0..4 | null, "reason": "..."}
func (s *Server) handleSetLevel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok := s.Policies.Get(id); !ok {
		writeErr(w, 404, "not_found", "unknown tenant")
		return
	}
	var body struct {
		Level  *int   `json:"level"`
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil {
		writeErr(w, 400, "bad_request", "body must be {\"level\": 0-4|null, \"reason\": \"...\"}")
		return
	}
	if body.Level == nil {
		if err := s.Throttle.Unpin(id, "admin"); err != nil {
			writeErr(w, 409, "not_pinned", err.Error())
			return
		}
		s.audit(r, "admin", "throttle.unpin", id, map[string]any{"reason": body.Reason})
	} else {
		if *body.Level < 0 || *body.Level > int(throttle.Quarantine) {
			writeErr(w, 400, "bad_request", "level must be 0-4 or null")
			return
		}
		if err := s.Throttle.Pin(id, throttle.Level(*body.Level), "admin"); err != nil {
			writeErr(w, 400, "bad_request", err.Error())
			return
		}
		s.audit(r, "admin", "throttle.pin", id, map[string]any{"level": *body.Level, "reason": body.Reason})
	}
	writeJSON(w, 200, s.Throttle.State(id))
}

// POST /admin/panic {"on": true}: shed free tier first.
func (s *Server) handlePanic(w http.ResponseWriter, r *http.Request) {
	var body struct {
		On     bool   `json:"on"`
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil {
		writeErr(w, 400, "bad_request", "body must be {\"on\": true|false}")
		return
	}
	s.Throttle.SetPanic(body.On, "admin")
	s.audit(r, "admin", "throttle.panic", "", map[string]any{"on": body.On, "reason": body.Reason})
	writeJSON(w, 200, map[string]any{"panic": body.On})
}

// GET /admin/events?since=RFC3339&limit=N
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	since := time.Now().Add(-time.Hour)
	if v := r.URL.Query().Get("since"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			writeErr(w, 400, "bad_request", "since must be RFC3339")
			return
		}
		since = t
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	rows, err := s.Events.List(r.Context(), since, limit)
	if err != nil {
		writeErr(w, 500, "internal", "could not read events")
		return
	}
	writeJSON(w, 200, rows)
}
