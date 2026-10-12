// Package gateway is the HTTP edge: token exchange, JWT middleware, tenant context,
// admin role, request IDs and structured logs.
package gateway

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bulkhead/platform/internal/admission"
	"github.com/bulkhead/platform/internal/auth"
	"github.com/bulkhead/platform/internal/dispatcher"
	"github.com/bulkhead/platform/internal/metrics"
	"github.com/bulkhead/platform/internal/policy"
	"github.com/bulkhead/platform/internal/throttle"
	"github.com/bulkhead/platform/internal/usage"
)

const (
	TokenTTL       = 15 * time.Minute
	maxBodyBytes   = 1 << 20
	headerAPIKey   = "X-API-Key"
	headerAdminKey = "X-Admin-Key"
)

type PolicyReader interface {
	Get(tenantID string) (policy.Policy, bool)
	Snapshot() map[string]policy.Policy
}

// Invoker runs an admitted request through scheduler → dispatcher → worker.
type Invoker interface {
	Submit(ctx context.Context, r dispatcher.Request) (dispatcher.Result, error)
}

type Deps struct {
	TenantSigner *auth.Signer // JWT_SECRET
	AdminSigner  *auth.Signer // ADMIN_JWT_SECRET (must differ)
	Auth         *auth.Authenticator
	Rotator      KeyRotator // optional; POST /v1/me/key/rotate
	Revoked      *auth.Revocations
	Policies     PolicyReader
	Admit        *admission.Admitter // optional; nil = no admission (tests of earlier prompts)
	Dispatch     Invoker             // optional; nil = echo stub (tests of earlier prompts)
	Audit        Auditor
	Usage        *usage.Reporter     // optional; nil = /me/usage|showback and /admin/usage return 503
	OnReject     func(metrics.Event) // optional; receives admission/queue rejections for metrics + ledger
	Throttle     Throttler           // optional; level header, /me/throttle, pin/unpin, panic
	Events       EventLister         // optional; GET /admin/events
	Hub          *throttle.Hub       // optional; controller events for /admin/stream
	Metrics      MetricsSource       // optional; live metrics in tenants + snapshots
	PolicyStore  PolicyWriter        // optional; PUT /admin/tenants/{id}/policy
	Isolate      Isolation           // optional; POST /admin/isolation
	Scenarios    ScenarioStarter     // optional; POST /admin/scenarios/{name}/run
	Runs         RunStore            // optional; /admin/runs
	// PredictorState returns the predictor's state; nil or error → baseline fallback.
	PredictorState func(context.Context) (map[string]any, error)
	// PredictorSelect switches the sidecar model (baseline|gbm); nil → 501.
	PredictorSelect func(ctx context.Context, model string) error
	CORSOrigins     []string // dashboard origins allowed on /admin/*
	AdminKey        string
	Now             func() time.Time // injected clock for report ranges; default time.Now
	Log             *slog.Logger
}

type Server struct {
	Deps
	Stream       *Stream
	adminKeyHash [32]byte
}

func New(d Deps) *Server {
	if d.Log == nil {
		d.Log = slog.Default()
	}
	if d.Now == nil {
		d.Now = time.Now
	}
	return &Server{Deps: d, Stream: NewStream(), adminKeyHash: sha256.Sum256([]byte(d.AdminKey))}
}

// Handler builds the full middleware + routing stack.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /v1/auth/token", s.handleToken)

	mux.Handle("POST /v1/invoke/{task}", s.tenantAuth(http.HandlerFunc(s.handleInvoke)))
	mux.Handle("GET /v1/me/usage", s.tenantAuth(http.HandlerFunc(s.handleMeUsage)))
	if s.Throttle != nil {
		mux.Handle("GET /v1/me/throttle", s.tenantAuth(http.HandlerFunc(s.handleMeThrottle)))
	} else {
		mux.Handle("GET /v1/me/throttle", s.tenantAuth(s.me("throttle")))
	}
	mux.Handle("GET /v1/me/showback", s.tenantAuth(http.HandlerFunc(s.handleMeShowback)))
	mux.Handle("GET /v1/me/live", s.tenantAuth(http.HandlerFunc(s.handleMeLive)))
	if s.Rotator != nil {
		mux.Handle("POST /v1/me/key/rotate", s.tenantAuth(http.HandlerFunc(s.handleMeRotate)))
	}

	mux.HandleFunc("POST /admin/auth/token", s.handleAdminToken)
	mux.Handle("GET /admin/usage", s.adminAuth(http.HandlerFunc(s.handleAdminUsage)))
	mux.Handle("GET /admin/tenants", s.adminAuth(http.HandlerFunc(s.handleAdminTenants)))
	mux.Handle("GET /admin/tenants/{id}", s.adminAuth(http.HandlerFunc(s.handleAdminTenant)))
	if s.PolicyStore != nil {
		mux.Handle("PUT /admin/tenants/{id}/policy", s.adminAuth(http.HandlerFunc(s.handlePutPolicy)))
	}
	if s.Isolate != nil {
		mux.Handle("POST /admin/isolation", s.adminAuth(http.HandlerFunc(s.handleIsolation)))
	}
	if s.Runs != nil {
		mux.Handle("GET /admin/runs", s.adminAuth(http.HandlerFunc(s.handleListRuns)))
		mux.Handle("GET /admin/runs/{id}", s.adminAuth(http.HandlerFunc(s.handleGetRun)))
		mux.Handle("POST /admin/runs", s.adminAuth(http.HandlerFunc(s.handleStoreRun)))
		mux.Handle("POST /admin/runs/{id}/progress", s.adminAuth(http.HandlerFunc(s.handleRunProgress)))
		if s.Scenarios != nil {
			mux.Handle("POST /admin/scenarios/{name}/run", s.adminAuth(http.HandlerFunc(s.handleRunScenario)))
		}
	}
	mux.Handle("GET /admin/predictor", s.adminAuth(http.HandlerFunc(s.handlePredictor)))
	mux.Handle("POST /admin/predictor/model", s.adminAuth(http.HandlerFunc(s.handlePredictorModel)))
	mux.Handle("POST /admin/tenants/{id}/revoke-tokens", s.adminAuth(http.HandlerFunc(s.handleRevokeTenant)))
	if s.Throttle != nil {
		mux.Handle("POST /admin/tenants/{id}/level", s.adminAuth(http.HandlerFunc(s.handleSetLevel)))
		mux.Handle("POST /admin/panic", s.adminAuth(http.HandlerFunc(s.handlePanic)))
	}
	if s.Events != nil {
		mux.Handle("GET /admin/events", s.adminAuth(http.HandlerFunc(s.handleEvents)))
	}
	mux.HandleFunc("GET /admin/stream", s.handleStream)

	return s.requestID(s.logging(s.recoverer(s.cors(mux))))
}

// ---- middleware ----

func (s *Server) requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" || len(id) > 64 {
			b := make([]byte, 8)
			_, _ = rand.Read(b)
			id = hex.EncodeToString(b)
		}
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), reqIDKey, id)))
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(c int) { w.status = c; w.ResponseWriter.WriteHeader(c) }

// Unwrap lets http.ResponseController (and WebSocket upgrades) reach the real writer.
func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// Hijack supports WebSocket upgrades through the logging wrapper.
func (w *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return http.NewResponseController(w.ResponseWriter).Hijack()
}

func (s *Server) logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sw := &statusWriter{ResponseWriter: w, status: 200}
		start := time.Now() // log-only latency, not business logic
		next.ServeHTTP(sw, r)
		s.Log.Info("request", "request_id", RequestID(r.Context()), "method", r.Method,
			"path", r.URL.Path, "status", sw.status, "dur_ms", time.Since(start).Milliseconds())
	})
}

func (s *Server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				s.Log.Error("panic", "request_id", RequestID(r.Context()), "panic", v)
				writeErr(w, 500, "internal", "internal error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func bearer(r *http.Request) (string, bool) {
	h := r.Header.Get("Authorization")
	if len(h) > 7 && strings.EqualFold(h[:7], "bearer ") {
		return strings.TrimSpace(h[7:]), true
	}
	return "", false
}

// tenantAuth verifies a tenant JWT and stores TenantCtx. Identity comes from claims only.
func (s *Server) tenantAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tok, ok := bearer(r)
		if !ok {
			writeErr(w, 401, "missing_token", "Authorization: Bearer <token> required")
			return
		}
		c, err := s.TenantSigner.Verify(tok)
		switch {
		case errors.Is(err, auth.ErrExpired):
			writeErr(w, 401, "token_expired", "token expired; mint a new one")
			return
		case err != nil || c.Role != auth.RoleTenant || c.TenantID == "":
			writeErr(w, 401, "invalid_token", "invalid token")
			return
		case s.Revoked.Revoked(c):
			writeErr(w, 401, "token_revoked", "token revoked")
			return
		}
		w.Header().Set("X-Tenant", c.TenantID)
		next.ServeHTTP(w, r.WithContext(WithTenant(r.Context(), TenantCtx{c.TenantID, c.Tier, c.JTI})))
	})
}

// adminAuth requires a token signed with the admin secret and role=admin. A tenant token
// fails signature verification here because the secrets differ.
func (s *Server) adminAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tok, ok := bearer(r)
		if !ok {
			writeErr(w, 401, "missing_token", "admin bearer token required")
			return
		}
		c, err := s.AdminSigner.Verify(tok)
		if err != nil || c.Role != auth.RoleAdmin {
			writeErr(w, 403, "forbidden", "admin credential required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ---- handlers ----

func (s *Server) handleToken(w http.ResponseWriter, r *http.Request) {
	id, err := s.Auth.Exchange(r.Context(), r.Header.Get(headerAPIKey))
	if errors.Is(err, auth.ErrBadKey) {
		writeErr(w, 401, "invalid_api_key", "invalid API key")
		return
	}
	if err != nil {
		s.Log.Error("key exchange", "err", err)
		writeErr(w, 503, "unavailable", "auth backend unavailable")
		return
	}
	tok, c, err := s.TenantSigner.Sign(auth.Claims{TenantID: id.TenantID, Tier: id.Tier, Role: auth.RoleTenant}, TokenTTL)
	if err != nil {
		writeErr(w, 500, "internal", "could not sign token")
		return
	}
	writeJSON(w, 200, map[string]any{"token": tok, "token_type": "Bearer",
		"expires_in": int(TokenTTL.Seconds()), "tenant_id": c.TenantID, "tier": c.Tier})
}

func (s *Server) handleInvoke(w http.ResponseWriter, r *http.Request) {
	t, _ := TenantFrom(r.Context())
	var params map[string]any
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(&params); err != nil && !errors.Is(err, errEOF) {
		writeErr(w, 400, "bad_body", "body must be a JSON object")
		return
	}
	task := r.PathValue("task")
	estCost := 0.0
	if s.Admit != nil {
		d := s.Admit.Admit(r.Context(), admission.Request{TenantID: t.TenantID,
			Task: task, Params: params, Bytes: max(r.ContentLength, 0)})
		if !d.Allow {
			s.recordReject(t.TenantID, task, string(d.Reason), admission.Status(d.Reason))
			admission.WriteReject(w, d)
			return
		}
		defer d.Release()
		estCost = d.EstCost
		w.Header().Set("X-Cost-Units", strconv.FormatFloat(d.EstCost, 'f', 1, 64))
	}
	if s.Dispatch == nil {
		// No dispatcher configured: echo (earlier prompts' tests).
		writeJSON(w, 200, map[string]any{"tenant_id": t.TenantID, "task": task,
			"params": params, "stub": true})
		return
	}
	res, err := s.Dispatch.Submit(r.Context(), dispatcher.Request{TenantID: t.TenantID,
		Task: task, Params: params, EstCost: estCost})
	if err != nil {
		if errors.Is(err, dispatcher.ErrQueueFull) {
			s.recordReject(t.TenantID, task, string(admission.ReasonQueueFull), http.StatusServiceUnavailable)
		}
		s.writeDispatchErr(w, r, err)
		return
	}
	h := w.Header()
	h.Set("X-Queue-Wait-Ms", strconv.FormatInt(res.QueueWait.Milliseconds(), 10))
	h.Set("X-Cost-Units", strconv.FormatFloat(res.Cost, 'f', 1, 64)) // actual replaces estimate
	h.Set("X-Throttle-Level", strconv.Itoa(s.throttleLevel(t.TenantID)))
	h.Set("Content-Type", "application/json")
	w.WriteHeader(res.Status)
	_, _ = w.Write(res.Body)
}

func (s *Server) writeDispatchErr(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, dispatcher.ErrQueueFull):
		admission.WriteReject(w, admission.Decision{Reason: admission.ReasonQueueFull, RetryAfter: 250 * time.Millisecond})
	case errors.Is(err, dispatcher.ErrTimeout):
		w.Header().Set("X-Reason", "TIMEOUT")
		writeErr(w, http.StatusGatewayTimeout, "timeout", "worker call timed out")
	case errors.Is(err, dispatcher.ErrNoWorker), errors.Is(err, dispatcher.ErrStopped):
		w.Header().Set("X-Reason", "WORKER_UNAVAILABLE")
		w.Header().Set("Retry-After", "1")
		writeErr(w, http.StatusServiceUnavailable, "worker_unavailable", "no worker available for this tenant")
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		// client went away; nothing to write
	default:
		s.Log.Error("dispatch", "request_id", RequestID(r.Context()), "err", err)
		w.Header().Set("X-Reason", "WORKER_ERROR")
		writeErr(w, http.StatusBadGateway, "worker_error", "worker call failed")
	}
}

// me serves /v1/me/*. The tenant is always the token's tenant; query/body are ignored.
func (s *Server) me(kind string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t, _ := TenantFrom(r.Context())
		out := map[string]any{"tenant_id": t.TenantID, "tier": t.Tier, "kind": kind}
		if p, ok := s.Policies.Get(t.TenantID); ok {
			out["policy"] = p
		}
		writeJSON(w, 200, out)
	})
}

func (s *Server) handleAdminToken(w http.ResponseWriter, r *http.Request) {
	got := sha256.Sum256([]byte(r.Header.Get(headerAdminKey)))
	if s.AdminKey == "" || subtle.ConstantTimeCompare(got[:], s.adminKeyHash[:]) != 1 {
		writeErr(w, 401, "invalid_admin_key", "invalid admin key")
		return
	}
	tok, c, err := s.AdminSigner.Sign(auth.Claims{Sub: "admin", Role: auth.RoleAdmin}, TokenTTL)
	if err != nil {
		writeErr(w, 500, "internal", "could not sign token")
		return
	}
	s.audit(r, "admin", "admin.token.issue", "", map[string]any{"jti": c.JTI})
	writeJSON(w, 200, map[string]any{"token": tok, "token_type": "Bearer", "expires_in": int(TokenTTL.Seconds())})
}

func (s *Server) handleRevokeTenant(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.Revoked.RevokeTenant(id)
	s.audit(r, "admin", "tenant.revoke_tokens", id, nil)
	writeJSON(w, 200, map[string]any{"tenant_id": id, "revoked": true})
}

func (s *Server) audit(r *http.Request, actor, action, target string, detail map[string]any) {
	if detail == nil {
		detail = map[string]any{}
	}
	detail["request_id"] = RequestID(r.Context())
	if err := s.Audit.Record(r.Context(), AuditEntry{actor, action, target, detail}); err != nil {
		s.Log.Error("audit write failed", "action", action, "err", err)
	}
}

// ---- helpers ----

var errEOF = io.EOF

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, errCode, msg string) {
	writeJSON(w, code, map[string]string{"error": errCode, "message": msg})
}

func (s *Server) recordReject(tenant, task, reason string, status int) {
	if s.OnReject != nil {
		s.OnReject(metrics.Event{Tenant: tenant, Task: task, Status: status, Reason: reason})
	}
}
