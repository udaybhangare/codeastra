package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/bulkhead/platform/internal/metrics"
	"github.com/bulkhead/platform/internal/policy"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PolicyWriter persists a policy and refreshes the in-memory cache.
type PolicyWriter interface {
	Put(ctx context.Context, p policy.Policy) error
	Reload(ctx context.Context) error
}

// Isolation is the runtime A/B switch (scheduler swap + cgroup limit mode +
// admission/DB caps + detector enable). Set must not require a restart.
type Isolation interface {
	On() bool
	Set(ctx context.Context, on bool) error
}

// MetricsSource is the live 1 s metrics feed.
type MetricsSource interface{ Latest() metrics.Snapshot }

// ScenarioStarter delegates a scenario run to the load generator.
type ScenarioStarter interface {
	Start(ctx context.Context, runID, scenario string, seed int64, durationS int) error
}

// Run mirrors contracts Run.
type Run struct {
	ID        string         `json:"id"`
	Scenario  string         `json:"scenario"`
	Seed      int64          `json:"seed"`
	Isolation string         `json:"isolation_mode"`
	StartedAt time.Time      `json:"started_at"`
	EndedAt   *time.Time     `json:"ended_at"`
	Summary   map[string]any `json:"summary,omitempty"`
}

// RunStore persists runs (the `runs` table).
type RunStore interface {
	Create(ctx context.Context, r Run) (Run, error)
	Finish(ctx context.Context, id string, ended time.Time, summary map[string]any) (Run, error)
	List(ctx context.Context, limit int) ([]Run, error)
	Get(ctx context.Context, id string) (Run, error)
}

var errRunNotFound = errors.New("run not found")

// MemRunStore keeps runs in memory (tests, and dev without Postgres).
type MemRunStore struct {
	mu   sync.Mutex
	runs []Run
}

func (m *MemRunStore) Create(_ context.Context, r Run) (Run, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r.ID = strconv.Itoa(len(m.runs) + 1)
	m.runs = append(m.runs, r)
	return r, nil
}

func (m *MemRunStore) Finish(_ context.Context, id string, ended time.Time, sum map[string]any) (Run, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.runs {
		if m.runs[i].ID == id {
			m.runs[i].EndedAt, m.runs[i].Summary = &ended, sum
			return m.runs[i], nil
		}
	}
	return Run{}, errRunNotFound
}

func (m *MemRunStore) List(_ context.Context, limit int) ([]Run, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Run, 0, len(m.runs))
	for i := len(m.runs) - 1; i >= 0 && len(out) < limit; i-- {
		out = append(out, m.runs[i])
	}
	return out, nil
}

func (m *MemRunStore) Get(_ context.Context, id string) (Run, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, r := range m.runs {
		if r.ID == id {
			return r, nil
		}
	}
	return Run{}, errRunNotFound
}

// PGRunStore is the Postgres-backed RunStore.
type PGRunStore struct{ Pool *pgxpool.Pool }

const runCols = `id::text, scenario, seed, isolation_mode, started_at, ended_at, COALESCE(summary,'{}'::jsonb)`

type rowScanner interface{ Scan(...any) error }

func scanRun(row rowScanner) (Run, error) {
	var r Run
	var sum []byte
	if err := row.Scan(&r.ID, &r.Scenario, &r.Seed, &r.Isolation, &r.StartedAt, &r.EndedAt, &sum); err != nil {
		return Run{}, err
	}
	_ = json.Unmarshal(sum, &r.Summary)
	return r, nil
}

func (p PGRunStore) Create(ctx context.Context, r Run) (Run, error) {
	return scanRun(p.Pool.QueryRow(ctx, `INSERT INTO runs (scenario, seed, isolation_mode, started_at, ended_at, summary)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING `+runCols,
		r.Scenario, r.Seed, r.Isolation, r.StartedAt, r.EndedAt, nullJSON(r.Summary)))
}

func nullJSON(m map[string]any) any {
	if m == nil {
		return nil
	}
	b, _ := json.Marshal(m)
	return b
}

func (p PGRunStore) Finish(ctx context.Context, id string, ended time.Time, sum map[string]any) (Run, error) {
	n, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		return Run{}, errRunNotFound
	}
	r, err := scanRun(p.Pool.QueryRow(ctx, `UPDATE runs SET ended_at=$2, summary=$3 WHERE id=$1 RETURNING `+runCols,
		n, ended, nullJSON(sum)))
	if err != nil {
		return Run{}, errRunNotFound
	}
	return r, nil
}

func (p PGRunStore) List(ctx context.Context, limit int) ([]Run, error) {
	rows, err := p.Pool.Query(ctx, `SELECT `+runCols+` FROM runs ORDER BY id DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Run{}
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (p PGRunStore) Get(ctx context.Context, id string) (Run, error) {
	n, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		return Run{}, errRunNotFound
	}
	r, err := scanRun(p.Pool.QueryRow(ctx, `SELECT `+runCols+` FROM runs WHERE id=$1`, n))
	if err != nil {
		return Run{}, errRunNotFound
	}
	return r, nil
}

// ---- tenants ----

type tenantView struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Tier      policy.Tier    `json:"tier"`
	Status    string         `json:"status"`
	Policy    policy.Policy  `json:"policy"`
	Metrics   map[string]any `json:"metrics,omitempty"`
	CreatedAt *time.Time     `json:"created_at,omitempty"`
}

func (s *Server) tenantView(p policy.Policy, win map[string]metrics.Window) tenantView {
	v := tenantView{ID: p.TenantID, Name: p.TenantID, Tier: p.Tier, Status: "active", Policy: p}
	m := map[string]any{"tenant_id": p.TenantID, "level": s.throttleLevel(p.TenantID)}
	if w, ok := win[p.TenantID]; ok {
		m["rps"], m["ok_rps"], m["rejected_rps"] = float64(w.Requests), float64(w.OK), float64(w.Rejected)
		m["cost_units_s"], m["queue_depth"], m["inflight"] = w.CostUnit, w.QueueDepth, w.InFlight
		m["p50_ms"], m["p95_ms"], m["p99_ms"], m["queue_wait_p95_ms"] = w.P50, w.P95, w.P99, w.QueueWaitP95
		m["cpu_share"], m["mem_mb"], m["bytes_s"] = clamp01(w.CPUShare), w.MemMB, w.Bytes
	}
	v.Metrics = m
	return v
}

func (s *Server) windows() map[string]metrics.Window {
	out := map[string]metrics.Window{}
	if s.Metrics == nil {
		return out
	}
	for _, w := range s.Metrics.Latest().Windows {
		out[w.Tenant] = w
	}
	return out
}

func (s *Server) handleAdminTenants(w http.ResponseWriter, r *http.Request) {
	win := s.windows()
	snap := s.Policies.Snapshot()
	list := make([]tenantView, 0, len(snap))
	for _, p := range snap {
		list = append(list, s.tenantView(p, win))
	}
	sort.Slice(list, func(i, j int) bool { return list[i].ID < list[j].ID })
	writeJSON(w, 200, list)
}

func (s *Server) handleAdminTenant(w http.ResponseWriter, r *http.Request) {
	p, ok := s.Policies.Get(r.PathValue("id"))
	if !ok {
		writeErr(w, 404, "not_found", "unknown tenant")
		return
	}
	writeJSON(w, 200, s.tenantView(p, s.windows()))
}

// PUT /admin/tenants/{id}/policy — fields omitted from the body keep their
// current value; the merged policy is validated before anything is written.
func (s *Server) handlePutPolicy(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	cur, ok := s.Policies.Get(id)
	if !ok {
		writeErr(w, 404, "not_found", "unknown tenant")
		return
	}
	next := cur
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	if err := dec.Decode(&next); err != nil {
		writeErr(w, 400, "bad_request", "body must be a policy JSON object")
		return
	}
	if next.TenantID != "" && next.TenantID != id {
		writeErr(w, 400, "bad_request", "tenant_id in body does not match path")
		return
	}
	next.TenantID, next.UpdatedAt = id, cur.UpdatedAt
	if err := next.Validate(); err != nil {
		writeErr(w, 422, "invalid_policy", err.Error())
		return
	}
	if err := s.PolicyStore.Put(r.Context(), next); err != nil {
		s.Log.Error("policy put", "tenant", id, "err", err)
		writeErr(w, 500, "internal", "could not save policy")
		return
	}
	if err := s.PolicyStore.Reload(r.Context()); err != nil {
		s.Log.Warn("policy reload", "err", err) // NOTIFY listener will converge
	}
	s.audit(r, "admin", "policy.update", id, map[string]any{"before": cur, "after": next})
	s.emit("admin", id, "policy updated for "+id, map[string]any{"policy": next})
	out, _ := s.Policies.Get(id)
	writeJSON(w, 200, out)
}

// POST /admin/isolation {"mode":"on|off"}
func (s *Server) handleIsolation(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil ||
		(body.Mode != "on" && body.Mode != "off") {
		writeErr(w, 400, "bad_request", `body must be {"mode":"on"|"off"}`)
		return
	}
	if err := s.Isolate.Set(r.Context(), body.Mode == "on"); err != nil {
		s.Log.Error("isolation toggle", "err", err)
		writeErr(w, 500, "internal", "isolation toggle partially failed: "+err.Error())
		return
	}
	s.audit(r, "admin", "isolation.set", "", map[string]any{"mode": body.Mode})
	s.emit("isolation", "", "isolation "+body.Mode, map[string]any{"mode": body.Mode})
	writeJSON(w, 200, map[string]any{"mode": body.Mode})
}

func (s *Server) isolationMode() string {
	if s.Isolate != nil && !s.Isolate.On() {
		return "off"
	}
	return "on"
}

// ---- scenarios & runs ----

func (s *Server) handleRunScenario(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Seed     int64 `json:"seed"`
		Duration int   `json:"duration"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil || body.Duration < 0 {
		writeErr(w, 400, "bad_request", `body must be {"seed": int, "duration": seconds}`)
		return
	}
	name := r.PathValue("name")
	run, err := s.Runs.Create(r.Context(), Run{Scenario: name, Seed: body.Seed,
		Isolation: s.isolationMode(), StartedAt: s.Now().UTC()})
	if err != nil {
		writeErr(w, 500, "internal", "could not create run")
		return
	}
	if err := s.Scenarios.Start(r.Context(), run.ID, name, body.Seed, body.Duration); err != nil {
		now := s.Now().UTC()
		_, _ = s.Runs.Finish(r.Context(), run.ID, now, map[string]any{"error": err.Error()})
		writeErr(w, 502, "loadgen_unavailable", err.Error())
		return
	}
	s.audit(r, "admin", "scenario.run", name, map[string]any{"run_id": run.ID, "seed": body.Seed})
	s.emit("admin", "", "scenario "+name+" started (run "+run.ID+")", map[string]any{"run_id": run.ID})
	writeJSON(w, 202, run)
}

func (s *Server) handleListRuns(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	runs, err := s.Runs.List(r.Context(), limit)
	if err != nil {
		writeErr(w, 500, "internal", "could not list runs")
		return
	}
	writeJSON(w, 200, runs)
}

func (s *Server) handleGetRun(w http.ResponseWriter, r *http.Request) {
	run, err := s.Runs.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, "not_found", "unknown run")
		return
	}
	writeJSON(w, 200, run)
}

// POST /admin/runs — the load generator reports a finished run. With run_id it
// completes a run started via /admin/scenarios/{name}/run; without, it is stored
// as a new, already-finished run (loadgen CLI mode).
func (s *Server) handleStoreRun(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RunID     string         `json:"run_id"`
		Scenario  string         `json:"scenario"`
		Seed      int64          `json:"seed"`
		Isolation string         `json:"isolation_mode"`
		StartedAt time.Time      `json:"started_at"`
		EndedAt   time.Time      `json:"ended_at"`
		Summary   map[string]any `json:"summary"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&body); err != nil {
		writeErr(w, 400, "bad_request", "invalid run body")
		return
	}
	if body.EndedAt.IsZero() {
		body.EndedAt = s.Now().UTC()
	}
	var run Run
	var err error
	if body.RunID != "" {
		run, err = s.Runs.Finish(r.Context(), body.RunID, body.EndedAt, body.Summary)
		if err != nil {
			writeErr(w, 404, "not_found", "unknown run_id")
			return
		}
	} else {
		if body.Scenario == "" || (body.Isolation != "on" && body.Isolation != "off") {
			writeErr(w, 400, "bad_request", "scenario and isolation_mode (on|off) required")
			return
		}
		if body.StartedAt.IsZero() {
			body.StartedAt = body.EndedAt
		}
		run, err = s.Runs.Create(r.Context(), Run{Scenario: body.Scenario, Seed: body.Seed,
			Isolation: body.Isolation, StartedAt: body.StartedAt, EndedAt: &body.EndedAt, Summary: body.Summary})
		if err != nil {
			writeErr(w, 500, "internal", "could not store run")
			return
		}
	}
	s.Stream.Broadcast(map[string]any{"type": "run_result", "run_id": run.ID, "scenario": run.Scenario,
		"isolation": run.Isolation, "summary": orEmpty(run.Summary)})
	writeJSON(w, 201, run)
}

// POST /admin/runs/{id}/progress {"phase","elapsed_s","total_s"} — loadgen heartbeat.
func (s *Server) handleRunProgress(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Phase    string  `json:"phase"`
		ElapsedS float64 `json:"elapsed_s"`
		TotalS   float64 `json:"total_s"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil ||
		(body.Phase != "warmup" && body.Phase != "attack" && body.Phase != "cooldown") {
		writeErr(w, 400, "bad_request", "phase must be warmup|attack|cooldown")
		return
	}
	run, err := s.Runs.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, "not_found", "unknown run")
		return
	}
	s.Stream.Broadcast(map[string]any{"type": "run_progress", "run_id": run.ID, "scenario": run.Scenario,
		"isolation": run.Isolation, "phase": body.Phase, "elapsed_s": body.ElapsedS, "total_s": body.TotalS})
	w.WriteHeader(http.StatusNoContent)
}

func orEmpty(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

// GET /admin/predictor
func (s *Server) handlePredictor(w http.ResponseWriter, r *http.Request) {
	if s.PredictorState != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if st, err := s.PredictorState(ctx); err == nil {
			writeJSON(w, 200, st)
			return
		}
	}
	// Predictor down: the detector's in-process baseline is in charge (docs/02).
	writeJSON(w, 200, map[string]any{"model": "baseline", "healthy": false, "accuracy": map[string]any{}})
}

// POST /admin/predictor/model {"model":"baseline"|"gbm"} — feature flag for the ML challenger.
func (s *Server) handlePredictorModel(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Model string `json:"model"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil ||
		(body.Model != "baseline" && body.Model != "gbm") {
		writeErr(w, 400, "bad_request", `body must be {"model":"baseline"|"gbm"}`)
		return
	}
	if s.PredictorSelect == nil {
		writeErr(w, 501, "not_implemented", "predictor sidecar not configured")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := s.PredictorSelect(ctx, body.Model); err != nil {
		writeErr(w, 409, "model_unavailable", err.Error())
		return
	}
	s.audit(r, "admin", "predictor.model", "", map[string]any{"model": body.Model})
	writeJSON(w, 200, map[string]any{"model": body.Model})
}

// emit broadcasts an `event` message for admin-side actions.
func (s *Server) emit(kind, tenant, message string, evidence map[string]any) {
	if s.Stream == nil {
		return
	}
	s.Stream.Broadcast(map[string]any{"type": "event", "ts": s.Now().UTC().Format(time.RFC3339),
		"kind": kind, "tenant_id": tenant, "message": message, "evidence": evidence, "actor": "admin"})
}

// ---- CORS ----

func (s *Server) originAllowed(o string) bool {
	for _, a := range s.CORSOrigins {
		if a == o {
			return true
		}
	}
	return false
}

// cors answers preflights and adds CORS headers on /admin/* for the configured
// dashboard origins only (no wildcard: admin routes carry bearer tokens).
func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o := r.Header.Get("Origin")
		if o != "" && (strings.HasPrefix(r.URL.Path, "/admin") || strings.HasPrefix(r.URL.Path, "/v1/me") ||
			r.URL.Path == "/v1/auth/token") && s.originAllowed(o) {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", o)
			h.Add("Vary", "Origin")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Admin-Key, X-API-Key")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
			h.Set("Access-Control-Max-Age", "600")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// RunStream feeds the WebSocket hub (1 Hz snapshots + controller events) until ctx ends.
func (s *Server) RunStream(ctx context.Context) {
	snap := func() map[string]any {
		var ms metrics.Snapshot
		if s.Metrics != nil {
			ms = s.Metrics.Latest()
		}
		return BuildSnapshot(s.Now(), ms, s.isolationMode() == "on",
			func(id string) string { p, _ := s.Policies.Get(id); return string(p.Tier) },
			s.throttleLevel)
	}
	s.Stream.Run(ctx, time.Second, snap, s.Hub)
}
