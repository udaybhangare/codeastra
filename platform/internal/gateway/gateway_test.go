package gateway

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/bulkhead/platform/internal/auth"
	"github.com/bulkhead/platform/internal/cost"
	"github.com/bulkhead/platform/internal/policy"
	"github.com/bulkhead/platform/internal/usage"
)

// rowStore is a read-only usage.Store over fixed rows.
type rowStore []usage.Row

func (rowStore) Write(context.Context, []usage.Row, []usage.WindowRow) error { return nil }
func (f rowStore) Rows(_ context.Context, tenant string, from, to time.Time) ([]usage.Row, error) {
	var out []usage.Row
	for _, r := range f {
		if (tenant == "" || r.Tenant == tenant) && !r.Window.Before(from) && r.Window.Before(to) {
			out = append(out, r)
		}
	}
	return out, nil
}

type fakeKeys []auth.KeyRecord

func (f fakeKeys) ByPrefix(context.Context, string) ([]auth.KeyRecord, error) { return f, nil }

type fakePolicies map[string]policy.Policy

func (f fakePolicies) Get(id string) (policy.Policy, bool) { p, ok := f[id]; return p, ok }
func (f fakePolicies) Snapshot() map[string]policy.Policy  { return f }

const (
	keyA = "bk_aaaaaaaaaaaaaaaa"
	keyB = "bk_bbbbbbbbbbbbbbbb"
	keyR = "bk_rrrrrrrrrrrrrrrr"
)

type env struct {
	h     http.Handler
	clock *time.Time
	audit *MemAuditor
}

func newEnv() *env {
	now := time.Unix(1_700_000_000, 0)
	e := &env{clock: &now, audit: &MemAuditor{}}
	nowFn := func() time.Time { return *e.clock }
	s := New(Deps{
		TenantSigner: auth.NewSigner("tenant-secret-0123456789", nowFn),
		AdminSigner:  auth.NewSigner("admin-secret-0123456789", nowFn),
		Auth: &auth.Authenticator{Store: fakeKeys{
			{TenantID: "tenant-a", Tier: "pro", KeyHash: auth.HashKey(keyA)},
			{TenantID: "tenant-b", Tier: "free", KeyHash: auth.HashKey(keyB)},
			{TenantID: "tenant-a", Tier: "pro", KeyHash: auth.HashKey(keyR), Revoked: true},
		}},
		Revoked:  auth.NewRevocations(nowFn),
		Policies: fakePolicies{"tenant-a": {TenantID: "tenant-a", Tier: "pro"}, "tenant-b": {TenantID: "tenant-b", Tier: "free"}},
		Audit:    e.audit,
		Now:      nowFn,
		Usage: &usage.Reporter{Card: usage.DefaultRateCard(), Weights: cost.DefaultWeights,
			Store: rowStore{
				{Tenant: "tenant-a", Window: now.Add(-time.Minute), Task: "cpu-burn", Req: 3, OK: 3, CPUms: 900, CostUnits: 900},
				{Tenant: "tenant-b", Window: now.Add(-time.Minute), Task: "echo", Req: 1, OK: 1, CPUms: 1, CostUnits: 1},
			}, Tier: func(id string) string { return map[string]string{"tenant-a": "pro", "tenant-b": "free"}[id] }},
		AdminKey: "admin-api-key-0123456789",
		Log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	e.h = s.Handler()
	return e
}

func (e *env) do(method, path string, hdr map[string]string, body string) (*httptest.ResponseRecorder, map[string]any) {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	for k, v := range hdr {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	e.h.ServeHTTP(w, r)
	var m map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &m)
	return w, m
}

func (e *env) token(t *testing.T, key string) string {
	t.Helper()
	w, m := e.do("POST", "/v1/auth/token", map[string]string{"X-API-Key": key}, "")
	if w.Code != 200 {
		t.Fatalf("token: %d %s", w.Code, w.Body)
	}
	return m["token"].(string)
}

func authz(tok string) map[string]string { return map[string]string{"Authorization": "Bearer " + tok} }

func TestTokenExchange(t *testing.T) {
	e := newEnv()
	for name, key := range map[string]string{"invalid": "bk_nope000000000000", "revoked": keyR, "missing": ""} {
		if w, _ := e.do("POST", "/v1/auth/token", map[string]string{"X-API-Key": key}, ""); w.Code != 401 {
			t.Errorf("%s key: got %d", name, w.Code)
		}
	}
	w, m := e.do("POST", "/v1/auth/token", map[string]string{"X-API-Key": keyA}, "")
	if w.Code != 200 || m["tenant_id"] != "tenant-a" || m["expires_in"].(float64) != 900 {
		t.Fatalf("%d %v", w.Code, m)
	}
	if w.Header().Get("X-Request-ID") == "" {
		t.Error("missing request id")
	}
}

func TestExpiredAndMissingToken(t *testing.T) {
	e := newEnv()
	tok := e.token(t, keyA)
	if w, _ := e.do("GET", "/v1/me/usage", nil, ""); w.Code != 401 {
		t.Errorf("missing: %d", w.Code)
	}
	if w, _ := e.do("GET", "/v1/me/usage", authz("garbage"), ""); w.Code != 401 {
		t.Errorf("garbage: %d", w.Code)
	}
	*e.clock = e.clock.Add(TokenTTL + time.Second)
	w, m := e.do("GET", "/v1/me/usage", authz(tok), "")
	if w.Code != 401 || m["error"] != "token_expired" {
		t.Errorf("expired: %d %v", w.Code, m)
	}
}

func TestTenantIsolationOnMe(t *testing.T) {
	e := newEnv()
	ta, tb := e.token(t, keyA), e.token(t, keyB)
	// Try every way a caller might smuggle another tenant's id in.
	hdr := authz(ta)
	hdr["X-Tenant"] = "tenant-b"
	w, m := e.do("GET", "/v1/me/usage?tenant_id=tenant-b", hdr, `{"tenant_id":"tenant-b"}`)
	if w.Code != 200 || m["tenant_id"] != "tenant-a" || w.Header().Get("X-Tenant") != "tenant-a" {
		t.Fatalf("A saw %v (%s)", m["tenant_id"], w.Header().Get("X-Tenant"))
	}
	_, m = e.do("GET", "/v1/me/throttle", authz(tb), "")
	if m["tenant_id"] != "tenant-b" {
		t.Fatalf("B saw %v", m["tenant_id"])
	}
	// invoke echo uses claims, not body
	_, m = e.do("POST", "/v1/invoke/cpu", authz(ta), `{"tenant_id":"tenant-b","n":1}`)
	if m["tenant_id"] != "tenant-a" || m["task"] != "cpu" {
		t.Fatalf("invoke: %v", m)
	}
}

func TestRevokedToken(t *testing.T) {
	e := newEnv()
	ta, tb := e.token(t, keyA), e.token(t, keyB)
	_, m := e.do("POST", "/admin/auth/token", map[string]string{"X-Admin-Key": "admin-api-key-0123456789"}, "")
	admin := m["token"].(string)
	if w, _ := e.do("POST", "/admin/tenants/tenant-a/revoke-tokens", authz(admin), ""); w.Code != 200 {
		t.Fatalf("revoke: %d", w.Code)
	}
	w, m := e.do("GET", "/v1/me/usage", authz(ta), "")
	if w.Code != 401 || m["error"] != "token_revoked" {
		t.Errorf("revoked A: %d %v", w.Code, m)
	}
	if w, _ := e.do("GET", "/v1/me/usage", authz(tb), ""); w.Code != 200 {
		t.Errorf("B affected: %d", w.Code)
	}
}

func TestAdminEndpoints(t *testing.T) {
	e := newEnv()
	tenantTok := e.token(t, keyA)
	if w, _ := e.do("GET", "/admin/tenants", authz(tenantTok), ""); w.Code != 403 {
		t.Errorf("tenant token on admin: %d", w.Code)
	}
	if w, _ := e.do("GET", "/admin/tenants", nil, ""); w.Code != 401 {
		t.Errorf("no token on admin: %d", w.Code)
	}
	if w, _ := e.do("POST", "/admin/auth/token", map[string]string{"X-Admin-Key": "wrong"}, ""); w.Code != 401 {
		t.Errorf("bad admin key: %d", w.Code)
	}
	// tenant API key is not an admin key
	if w, _ := e.do("POST", "/admin/auth/token", map[string]string{"X-Admin-Key": keyA}, ""); w.Code != 401 {
		t.Errorf("tenant key as admin key: %d", w.Code)
	}
	_, m := e.do("POST", "/admin/auth/token", map[string]string{"X-Admin-Key": "admin-api-key-0123456789"}, "")
	admin := m["token"].(string)
	if w, _ := e.do("GET", "/admin/tenants", authz(admin), ""); w.Code != 200 {
		t.Errorf("admin: %d", w.Code)
	}
	// admin token is not a tenant token
	if w, _ := e.do("GET", "/v1/me/usage", authz(admin), ""); w.Code != 401 {
		t.Errorf("admin token on tenant API: %d", w.Code)
	}
	e.do("POST", "/admin/tenants/tenant-b/revoke-tokens", authz(admin), "")
	var actions []string
	for _, a := range e.audit.Entries {
		actions = append(actions, a.Action+":"+a.Target)
	}
	want := "admin.token.issue: tenant.revoke_tokens:tenant-b"
	if strings.Join(actions[len(actions)-2:], " ") != want {
		t.Errorf("audit = %v", actions)
	}
}

func TestHealthz(t *testing.T) {
	if w, _ := newEnv().do("GET", "/healthz", nil, ""); w.Code != 200 {
		t.Fatal(w.Code)
	}
}

func TestUsageEndpoints(t *testing.T) {
	e := newEnv()
	ta := e.token(t, keyA)
	w, m := e.do("GET", "/v1/me/usage?tenant_id=tenant-b", authz(ta), "")
	if w.Code != 200 {
		t.Fatalf("usage: %d %v", w.Code, m)
	}
	u := m["usage"].(map[string]any)["totals"].(map[string]any)
	if u["cost_units"] != 900.0 || m["tenant_id"] != "tenant-a" {
		t.Fatalf("A must see only its own usage: %v", m)
	}
	w, m = e.do("GET", "/v1/me/showback", authz(ta), "")
	if w.Code != 200 || m["currency"] != "USD (demo)" || m["disclaimer"] == "" {
		t.Fatalf("showback: %d %v", w.Code, m)
	}
	if w, _ := e.do("GET", "/v1/me/usage?range=48h", authz(ta), ""); w.Code != 400 {
		t.Fatalf("range cap: %d", w.Code)
	}
	if w, _ := e.do("GET", "/admin/usage", authz(ta), ""); w.Code != 401 && w.Code != 403 {
		t.Fatalf("tenant token on admin route: %d", w.Code)
	}
	_, m = e.do("POST", "/admin/auth/token", map[string]string{"X-Admin-Key": "admin-api-key-0123456789"}, "")
	w, m = e.do("GET", "/admin/usage?top=5&tenant=tenant-a", authz(m["token"].(string)), "")
	top := m["fleet"].(map[string]any)["top_spenders"].([]any)
	if w.Code != 200 || len(top) != 2 || top[0].(map[string]any)["tenant_id"] != "tenant-a" {
		t.Fatalf("admin usage: %d %v", w.Code, m)
	}
}
