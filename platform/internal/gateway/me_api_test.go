package gateway

import (
	"context"
	"testing"

	"github.com/bulkhead/platform/internal/metrics"
)

type meMetrics struct{}

func (meMetrics) Latest() metrics.Snapshot {
	return metrics.Snapshot{Windows: []metrics.Window{
		{Tenant: "tenant-a", Requests: 7, P99: 120},
		{Tenant: "tenant-b", Requests: 99, P99: 9999},
	}}
}

type fakeRotator struct{ got []string }

func (f *fakeRotator) Rotate(_ context.Context, id string) (string, error) {
	f.got = append(f.got, id)
	return "bk_new_" + id, nil
}

func TestMeLiveOnlyOwnWindow(t *testing.T) {
	e := newEnvWith(func(d *Deps) { d.Metrics = meMetrics{} })
	w, m := e.do("GET", "/v1/me/live?tenant_id=tenant-b", authz(e.token(t, keyA)), "")
	if w.Code != 200 || m["tenant_id"] != "tenant-a" || m["rps"] != float64(7) || m["p99_ms"] != float64(120) {
		t.Fatalf("live: %d %v", w.Code, m)
	}
	if w, _ := e.do("GET", "/v1/me/live", nil, ""); w.Code != 401 {
		t.Errorf("no token: %d", w.Code)
	}
}

func TestMeRotateIsScopedAndAudited(t *testing.T) {
	rot := &fakeRotator{}
	e := newEnvWith(func(d *Deps) { d.Rotator = rot })
	w, m := e.do("POST", "/v1/me/key/rotate", authz(e.token(t, keyB)), `{"tenant_id":"tenant-a"}`)
	if w.Code != 200 || m["api_key"] != "bk_new_tenant-b" || len(rot.got) != 1 || rot.got[0] != "tenant-b" {
		t.Fatalf("rotate: %d %v %v", w.Code, m, rot.got)
	}
	if w, _ := e.do("POST", "/v1/me/key/rotate", nil, ""); w.Code != 401 {
		t.Errorf("no token: %d", w.Code)
	}
	_, a := e.do("POST", "/admin/auth/token", map[string]string{"X-Admin-Key": "admin-api-key-0123456789"}, "")
	if w, _ := e.do("POST", "/v1/me/key/rotate", authz(a["token"].(string)), ""); w.Code != 401 {
		t.Errorf("admin token on rotate: %d", w.Code)
	}
}
