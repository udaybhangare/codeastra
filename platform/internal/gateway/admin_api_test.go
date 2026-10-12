package gateway

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bulkhead/platform/internal/auth"
	"github.com/bulkhead/platform/internal/metrics"
	"github.com/bulkhead/platform/internal/policy"
	"github.com/gorilla/websocket"
)

type fakeWriter struct {
	pols fakePolicies
	last policy.Policy
}

func (f *fakeWriter) Put(_ context.Context, p policy.Policy) error {
	f.last = p
	f.pols[p.TenantID] = p
	return nil
}
func (f *fakeWriter) Reload(context.Context) error { return nil }

type fakeIso struct {
	mu sync.Mutex
	on bool
}

func (f *fakeIso) On() bool { f.mu.Lock(); defer f.mu.Unlock(); return f.on }
func (f *fakeIso) Set(_ context.Context, on bool) error {
	f.mu.Lock()
	f.on = on
	f.mu.Unlock()
	return nil
}

type fakeLoadgen struct{ got []string }

func (f *fakeLoadgen) Start(_ context.Context, id, sc string, _ int64, _ int) error {
	f.got = append(f.got, id+":"+sc)
	return nil
}

type fakeMetrics struct{}

func (fakeMetrics) Latest() metrics.Snapshot {
	return metrics.Snapshot{
		Windows:  []metrics.Window{{Tenant: "tenant-a", Requests: 5, OK: 5, P99: 40, CPUShare: 0.2}},
		Host:     metrics.Host{CPUUtil: 0.3, MemUtil: 0.4},
		Fairness: metrics.Fairness{Jain: 0.98},
	}
}

type adminEnv struct {
	ts    *httptest.Server
	srv   *Server
	admin string
	iso   *fakeIso
	pw    *fakeWriter
	lg    *fakeLoadgen
}

func newAdminEnv(t *testing.T) *adminEnv {
	t.Helper()
	nowFn := func() time.Time { return time.Unix(1_700_000_000, 0) }
	pols := fakePolicies{"tenant-a": {TenantID: "tenant-a", Tier: policy.TierPro, Weight: 4, ReserveCPU: 0.5,
		LimitCPU: 1, LimitMemMB: 512, RPS: 50, Burst: 100, CostPerS: 300, Concurrency: 16, QueueDepth: 200,
		DBConns: 8, BandwidthBps: 1 << 20}}
	e := &adminEnv{iso: &fakeIso{on: true}, pw: &fakeWriter{pols: pols}, lg: &fakeLoadgen{}}
	e.srv = New(Deps{
		TenantSigner: auth.NewSigner("tenant-secret-0123456789", nowFn),
		AdminSigner:  auth.NewSigner("admin-secret-0123456789", nowFn),
		Auth:         &auth.Authenticator{Store: fakeKeys{}},
		Revoked:      auth.NewRevocations(nowFn), Policies: pols, Audit: &MemAuditor{}, Now: nowFn,
		Metrics: fakeMetrics{}, PolicyStore: e.pw, Isolate: e.iso, Scenarios: e.lg, Runs: &MemRunStore{},
		CORSOrigins: []string{"http://dash.example"}, AdminKey: "admin-api-key-0123456789",
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	e.ts = httptest.NewServer(e.srv.Handler())
	t.Cleanup(e.ts.Close)
	e.admin, _, _ = e.srv.AdminSigner.Sign(auth.Claims{Sub: "admin", Role: auth.RoleAdmin}, time.Hour)
	return e
}

func (e *adminEnv) do(t *testing.T, method, path, tok, body string, hdr ...string) (int, string, http.Header) {
	t.Helper()
	req, _ := http.NewRequest(method, e.ts.URL+path, strings.NewReader(body))
	if tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(b), res.Header
}

func TestAdminRoutesNeedAdminRole(t *testing.T) {
	e := newAdminEnv(t)
	tenantTok, _, _ := e.srv.TenantSigner.Sign(auth.Claims{TenantID: "tenant-a", Tier: "pro", Role: auth.RoleTenant}, time.Hour)
	for _, rt := range [][2]string{{"GET", "/admin/tenants"}, {"GET", "/admin/tenants/tenant-a"},
		{"PUT", "/admin/tenants/tenant-a/policy"}, {"POST", "/admin/isolation"}, {"GET", "/admin/runs"},
		{"POST", "/admin/scenarios/S1/run"}, {"GET", "/admin/predictor"}, {"POST", "/admin/predictor/model"}, {"POST", "/admin/runs"}} {
		if c, _, _ := e.do(t, rt[0], rt[1], "", "{}"); c != 401 {
			t.Errorf("%v no token: %d", rt, c)
		}
		if c, _, _ := e.do(t, rt[0], rt[1], tenantTok, "{}"); c != 403 {
			t.Errorf("%v tenant token: %d", rt, c)
		}
	}
}

func TestTenantsPolicyIsolationRuns(t *testing.T) {
	e := newAdminEnv(t)

	c, b, _ := e.do(t, "GET", "/admin/tenants", e.admin, "")
	var list []map[string]any
	if c != 200 || json.Unmarshal([]byte(b), &list) != nil || len(list) != 1 ||
		list[0]["metrics"].(map[string]any)["p99_ms"] != float64(40) {
		t.Fatalf("list: %d %s", c, b)
	}
	if c, _, _ := e.do(t, "GET", "/admin/tenants/ghost", e.admin, ""); c != 404 {
		t.Errorf("unknown tenant: %d", c)
	}

	// partial update merges; invalid is rejected and writes nothing
	if c, b, _ := e.do(t, "PUT", "/admin/tenants/tenant-a/policy", e.admin, `{"rps": 5}`); c != 200 || e.pw.last.RPS != 5 || e.pw.last.Weight != 4 {
		t.Fatalf("put: %d %s %+v", c, b, e.pw.last)
	}
	e.pw.last = policy.Policy{}
	if c, _, _ := e.do(t, "PUT", "/admin/tenants/tenant-a/policy", e.admin, `{"rps": -1}`); c != 422 || e.pw.last.TenantID != "" {
		t.Errorf("invalid put: %d", c)
	}
	if c, _, _ := e.do(t, "PUT", "/admin/tenants/tenant-a/policy", e.admin, `{"tenant_id":"other"}`); c != 400 {
		t.Errorf("mismatched id: %d", c)
	}
	if entries := e.srv.Audit.(*MemAuditor).Entries; len(entries) != 1 || entries[0].Action != "policy.update" {
		t.Errorf("audit: %+v", entries)
	}

	// isolation toggles at runtime
	if c, _, _ := e.do(t, "POST", "/admin/isolation", e.admin, `{"mode":"off"}`); c != 200 || e.iso.On() {
		t.Errorf("isolation off: %d on=%v", c, e.iso.On())
	}
	if c, _, _ := e.do(t, "POST", "/admin/isolation", e.admin, `{"mode":"maybe"}`); c != 400 {
		t.Errorf("bad mode: %d", c)
	}

	// scenario run -> run row records current mode; loadgen reports result
	c, b, _ = e.do(t, "POST", "/admin/scenarios/S1/run", e.admin, `{"seed":7,"duration":30}`)
	var run Run
	if c != 202 || json.Unmarshal([]byte(b), &run) != nil || run.Isolation != "off" || run.Seed != 7 ||
		len(e.lg.got) != 1 || e.lg.got[0] != run.ID+":S1" {
		t.Fatalf("run: %d %s %v", c, b, e.lg.got)
	}
	if c, _, _ := e.do(t, "POST", "/admin/runs", e.admin, `{"run_id":"`+run.ID+`","summary":{"jain":0.9}}`); c != 201 {
		t.Errorf("store: %d", c)
	}
	if c, b, _ := e.do(t, "GET", "/admin/runs/"+run.ID, e.admin, ""); c != 200 || !strings.Contains(b, `"jain":0.9`) {
		t.Errorf("get run: %d %s", c, b)
	}
	if c, _, _ := e.do(t, "GET", "/admin/runs/999", e.admin, ""); c != 404 {
		t.Errorf("missing run: %d", c)
	}

	// predictor falls back to baseline when unreachable
	if c, b, _ := e.do(t, "GET", "/admin/predictor", e.admin, ""); c != 200 || !strings.Contains(b, `"model":"baseline"`) {
		t.Errorf("predictor: %d %s", c, b)
	}
	// ML flag: validates body, 501 when no sidecar configured
	if c, _, _ := e.do(t, "POST", "/admin/predictor/model", e.admin, `{"model":"xgb"}`); c != 400 {
		t.Errorf("bad model: %d", c)
	}
	if c, _, _ := e.do(t, "POST", "/admin/predictor/model", e.admin, `{"model":"gbm"}`); c != 501 {
		t.Errorf("no sidecar: %d", c)
	}
}

func TestCORS(t *testing.T) {
	e := newAdminEnv(t)
	c, _, h := e.do(t, "OPTIONS", "/admin/tenants", "", "", "Origin", "http://dash.example")
	if c != 204 || h.Get("Access-Control-Allow-Origin") != "http://dash.example" {
		t.Errorf("preflight: %d %v", c, h)
	}
	if _, _, h := e.do(t, "GET", "/admin/tenants", e.admin, "", "Origin", "http://evil.example"); h.Get("Access-Control-Allow-Origin") != "" {
		t.Error("foreign origin must not be allowed")
	}
}

func dialStream(t *testing.T, e *adminEnv) *websocket.Conn {
	t.Helper()
	u := "ws" + strings.TrimPrefix(e.ts.URL, "http") + "/admin/stream?token=" + e.admin
	c, _, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	return c
}

func TestStreamSnapshotWithinBudgetAndContract(t *testing.T) {
	e := newAdminEnv(t)
	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	go e.srv.RunStream(ctx)
	conn := dialStream(t, e)
	_ = conn.SetReadDeadline(time.Now().Add(1200 * time.Millisecond))
	var m map[string]any
	if err := conn.ReadJSON(&m); err != nil || m["type"] != "snapshot" {
		t.Fatalf("no snapshot within 1.2s: %v %v", m, err)
	}
	// contract: only schema-listed keys on snapshot + tenants
	raw, err := os.ReadFile("../../../contracts/ws-messages.schema.json")
	if err != nil {
		t.Skip("contracts not found")
	}
	var sch struct {
		Defs map[string]struct {
			Properties map[string]json.RawMessage `json:"properties"`
			Required   []string                   `json:"required"`
		} `json:"$defs"`
	}
	_ = json.Unmarshal(raw, &sch)
	check := func(def string, v map[string]any) {
		d := sch.Defs[def]
		for _, k := range d.Required {
			if _, ok := v[k]; !ok {
				t.Errorf("%s missing %q", def, k)
			}
		}
		for k := range v {
			if _, ok := d.Properties[k]; !ok {
				t.Errorf("%s has undeclared %q", def, k)
			}
		}
	}
	check("snapshot", m)
	check("tenantMetrics", m["tenants"].([]any)[0].(map[string]any))
}

func TestReconnectGetsFullSnapshotAndEvents(t *testing.T) {
	e := newAdminEnv(t)
	e.srv.Stream.Broadcast(BuildSnapshot(time.Unix(1, 0), fakeMetrics{}.Latest(), true,
		func(string) string { return "pro" }, func(string) int { return 0 }))
	conn := dialStream(t, e) // connects after the snapshot was produced
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	var m map[string]any
	if err := conn.ReadJSON(&m); err != nil || m["type"] != "snapshot" {
		t.Fatalf("initial snapshot: %v %v", m, err)
	}
	e.do(t, "POST", "/admin/isolation", e.admin, `{"mode":"off"}`)
	if err := conn.ReadJSON(&m); err != nil || m["type"] != "event" || m["kind"] != "isolation" {
		t.Fatalf("event: %v %v", m, err)
	}
}

func TestSlowClientDoesNotBlockOthers(t *testing.T) {
	s := NewStream()
	slow, fast := newClient(), newClient() // slow never pops
	s.add(slow)
	s.add(fast)
	done := make(chan struct{})
	go func() {
		for i := 0; i < 1000; i++ {
			s.Broadcast(map[string]any{"type": "snapshot", "n": i})
			if _, ok := fast.pop(); !ok {
				t.Error("fast client starved")
			}
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("broadcast blocked by slow client")
	}
	if len(slow.q) != clientQueue {
		t.Errorf("slow queue not bounded: %d", len(slow.q))
	}
	// oldest dropped: the newest snapshot (n=999) survives
	last := slow.q[len(slow.q)-1]
	if !strings.Contains(string(last.data), `"n":999`) {
		t.Errorf("newest snapshot lost: %s", last.data)
	}
}
