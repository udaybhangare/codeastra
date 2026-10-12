package gateway

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/bulkhead/platform/internal/auth"
	"github.com/bulkhead/platform/internal/policy"
	"github.com/bulkhead/platform/internal/throttle"
	"github.com/gorilla/websocket"
)

func TestThrottleAdminAPI(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	nowFn := func() time.Time { return now }
	pols := fakePolicies{
		"tenant-a": {TenantID: "tenant-a", Tier: policy.TierPro, Weight: 4, ReserveCPU: 0.5, LimitCPU: 1, LimitMemMB: 512, DBConns: 4},
		"tenant-b": {TenantID: "tenant-b", Tier: policy.TierFree, Weight: 1, ReserveCPU: 0.1, LimitCPU: 0.5, LimitMemMB: 256, DBConns: 2},
	}
	hub := throttle.NewHub()
	ctl := throttle.New(throttle.Config{}, throttle.Deps{
		Policy: pols.Get, List: pols.Snapshot, Publisher: hub, Now: nowFn,
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	srv := New(Deps{
		TenantSigner: auth.NewSigner("tenant-secret-0123456789", nowFn),
		AdminSigner:  auth.NewSigner("admin-secret-0123456789", nowFn),
		Auth:         &auth.Authenticator{Store: fakeKeys{{TenantID: "tenant-a", Tier: "pro", KeyHash: auth.HashKey(keyA)}}},
		Revoked:      auth.NewRevocations(nowFn), Policies: pols, Audit: &MemAuditor{}, Now: nowFn,
		Throttle: ctl, Hub: hub, AdminKey: "admin-api-key-0123456789",
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	do := func(method, path, tok, body string) (int, string) {
		req, _ := http.NewRequest(method, ts.URL+path, strings.NewReader(body))
		if tok != "" {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(b)
	}
	admin, _, _ := srv.AdminSigner.Sign(auth.Claims{Sub: "admin", Role: auth.RoleAdmin}, time.Hour)
	var tenant string
	{
		req, _ := http.NewRequest("POST", ts.URL+"/v1/auth/token", nil)
		req.Header.Set("X-API-Key", keyA)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(res.Body)
		res.Body.Close()
		i := strings.Index(string(b), `"token":"`) + 9
		tenant = string(b)[i : i+strings.Index(string(b)[i:], `"`)]
	}

	// a live stream subscriber sees the pin
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/admin/stream?token=" + admin
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(ts.URL, "http")+"/admin/stream?token="+tenant, nil); err == nil {
		t.Error("tenant token must not open the admin stream")
	}

	if c, _ := do("POST", "/admin/tenants/tenant-a/level", tenant, `{"level":3}`); c != 403 {
		t.Errorf("tenant pin: %d", c)
	}
	if c, b := do("POST", "/admin/tenants/tenant-a/level", admin, `{"level":3,"reason":"demo"}`); c != 200 || !strings.Contains(b, `"level":3`) {
		t.Fatalf("pin: %d %s", c, b)
	}
	if c, _ := do("POST", "/admin/tenants/tenant-a/level", admin, `{"level":9}`); c != 400 {
		t.Errorf("bad level: %d", c)
	}
	if c, _ := do("POST", "/admin/tenants/ghost/level", admin, `{"level":1}`); c != 404 {
		t.Errorf("unknown tenant: %d", c)
	}
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var msg map[string]any
	if err := conn.ReadJSON(&msg); err != nil || msg["kind"] != "throttle" || msg["tenant_id"] != "tenant-a" || msg["to_level"] != float64(3) {
		t.Fatalf("stream: %v %v", msg, err)
	}
	if c, b := do("GET", "/v1/me/throttle", tenant, ""); c != 200 || !strings.Contains(b, `"level":3`) || strings.Contains(b, "finding") {
		t.Errorf("me/throttle: %d %s", c, b)
	}
	if c, b := do("POST", "/admin/tenants/tenant-a/level", admin, `{"level":null}`); c != 200 || !strings.Contains(b, `"pinned":false`) {
		t.Errorf("unpin: %d %s", c, b)
	}
	if c, _ := do("POST", "/admin/panic", admin, `{"on":true}`); c != 200 || ctl.Level("tenant-b") != throttle.Hard {
		t.Errorf("panic: free tenant level %v", ctl.Level("tenant-b"))
	}
	if strings.Contains(ctl.State("tenant-a").Explanation, "panic") {
		t.Errorf("paying tenant must not be shed: %s", ctl.State("tenant-a").Explanation)
	}
}
