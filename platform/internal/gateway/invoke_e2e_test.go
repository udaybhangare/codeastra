package gateway

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/bulkhead/platform/internal/auth"
	"github.com/bulkhead/platform/internal/cost"
	"github.com/bulkhead/platform/internal/dispatcher"
	"github.com/bulkhead/platform/internal/scheduler"
)

type staticBackend string

func (b staticBackend) Addr(string) (string, bool) { return string(b), true }

// startRealWorker builds and runs the real worker binary on a free local port.
func startRealWorker(t *testing.T) string {
	t.Helper()
	bin := filepath.Join(t.TempDir(), "worker")
	build := exec.Command("go", "build", "-o", bin, ".")
	build.Dir = "../../../worker"
	if out, err := build.CombinedOutput(); err != nil {
		t.Skipf("cannot build worker: %v\n%s", err, out)
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close()
	cmd := exec.Command(bin, "-addr", addr)
	cmd.Env = append(os.Environ(), "TENANT_ID=tenant-a")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	for i := 0; i < 50; i++ {
		if r, err := http.Get("http://" + addr + "/healthz"); err == nil {
			r.Body.Close()
			return "http://" + addr
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("worker did not become ready")
	return ""
}

func TestInvokeEndToEndThroughRealWorker(t *testing.T) {
	workerURL := startRealWorker(t)
	nowFn := time.Now
	pols := fakePolicies{"tenant-a": {TenantID: "tenant-a", Tier: "pro", Weight: 4, Concurrency: 4, QueueDepth: 10}}
	est := cost.NewEstimator(cost.DefaultWeights)
	sw := scheduler.NewSwitch(scheduler.DRRConfig{}, 100)
	disp := dispatcher.New(dispatcher.Config{Now: nowFn, GlobalSlots: 4}, sw, staticBackend(workerURL), pols, est)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go disp.Run(ctx)

	s := New(Deps{
		TenantSigner: auth.NewSigner("tenant-secret-0123456789", nowFn),
		AdminSigner:  auth.NewSigner("admin-secret-0123456789", nowFn),
		Auth: &auth.Authenticator{Store: fakeKeys{
			{TenantID: "tenant-a", Tier: "pro", KeyHash: auth.HashKey(keyA)}}},
		Revoked: auth.NewRevocations(nowFn), Policies: pols, Dispatch: disp,
		Audit: &MemAuditor{}, AdminKey: "admin-api-key-0123456789",
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()

	post := func(path, hdrKey, hdrVal, body string) (*http.Response, string) {
		req, _ := http.NewRequest("POST", srv.URL+path, strings.NewReader(body))
		req.Header.Set(hdrKey, hdrVal)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp, string(b)
	}
	resp, body := post("/v1/auth/token", "X-API-Key", keyA, "")
	if resp.StatusCode != 200 {
		t.Fatalf("token: %d %s", resp.StatusCode, body)
	}
	tok := body[strings.Index(body, `"token":"`)+9:]
	tok = tok[:strings.Index(tok, `"`)]

	for _, tc := range []struct{ task, params string }{
		{"echo", `{}`},
		{"cpu-burn", `{"ms": 30}`},
	} {
		resp, body := post("/v1/invoke/"+tc.task, "Authorization", "Bearer "+tok, tc.params)
		if resp.StatusCode != 200 || !strings.Contains(body, `"ok":true`) {
			t.Fatalf("%s: %d %s", tc.task, resp.StatusCode, body)
		}
		for _, h := range []string{"X-Tenant", "X-Queue-Wait-Ms", "X-Cost-Units", "X-Throttle-Level"} {
			if resp.Header.Get(h) == "" {
				t.Errorf("%s: missing header %s", tc.task, h)
			}
		}
		if tc.task == "cpu-burn" {
			c, _ := strconv.ParseFloat(resp.Header.Get("X-Cost-Units"), 64)
			if c < 20 {
				t.Errorf("cpu-burn 30ms actual cost %v looks too small", c)
			}
		}
		fmt.Printf("e2e %s -> cost=%s wait=%sms\n", tc.task, resp.Header.Get("X-Cost-Units"), resp.Header.Get("X-Queue-Wait-Ms"))
	}
}
