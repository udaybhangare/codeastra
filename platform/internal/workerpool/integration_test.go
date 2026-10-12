//go:build integration

// Needs a local Docker daemon and the image from `make worker-image`.
// Run: cd platform && go test -tags integration -run TestWorkerPool -v ./internal/workerpool/
package workerpool

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

type runResult struct {
	OK     bool    `json:"ok"`
	Error  string  `json:"error"`
	WallMS float64 `json:"wall_ms"`
	CPUMS  float64 `json:"cpu_ms"`
}

func run(t *testing.T, p *Pool, tenant, body string) (runResult, error) {
	t.Helper()
	addr, ok := p.Addr(tenant)
	if !ok {
		t.Fatalf("no addr for %s", tenant)
	}
	c := http.Client{Timeout: 30 * time.Second}
	resp, err := c.Post(addr+"/run", "application/json", bytes.NewBufferString(body))
	if err != nil {
		return runResult{}, err
	}
	defer resp.Body.Close()
	var r runResult
	return r, json.NewDecoder(resp.Body).Decode(&r)
}

// cores runs a CPU burn and returns average cores used (cpu_ms / wall_ms).
func cores(t *testing.T, p *Pool, tenant string, ms, threads int) float64 {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"task": "cpu-burn", "params": map[string]any{"ms": ms, "threads": threads}})
	r, err := run(t, p, tenant, string(body))
	if err != nil || !r.OK {
		t.Fatalf("cpu-burn on %s: %v %+v", tenant, err, r)
	}
	return r.CPUMS / r.WallMS
}

func TestWorkerPool(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	p, err := New(Config{Prefix: "bulkhead-it", Isolation: true})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		c, cl := context.WithTimeout(context.Background(), 30*time.Second)
		defer cl()
		_ = p.Close(c)
	}()
	if err := p.Start(ctx); err != nil {
		t.Fatal(err)
	}
	if err := p.Ensure(ctx, Spec{TenantID: "noisy", CPUs: 0.5, MemoryMB: 128, PidsLimit: 128}); err != nil {
		t.Fatal(err)
	}
	if err := p.Ensure(ctx, Spec{TenantID: "quiet", CPUs: 1, MemoryMB: 256, PidsLimit: 128}); err != nil {
		t.Fatal(err)
	}
	quietID, _ := p.ContainerID("quiet")

	t.Run("cpu limit measured", func(t *testing.T) {
		got := cores(t, p, "noisy", 1000, 2)
		t.Logf("0.5-cpu container used %.2f cores", got)
		if got < 0.4 || got > 0.62 {
			t.Fatalf("want ~0.5 cores, got %.2f", got)
		}
	})

	t.Run("live update halves cpu", func(t *testing.T) {
		if err := p.Update(ctx, "noisy", 0.25, 128); err != nil {
			t.Fatal(err)
		}
		got := cores(t, p, "noisy", 500, 2)
		t.Logf("after update to 0.25: %.2f cores", got)
		if got < 0.18 || got > 0.32 {
			t.Fatalf("want ~0.25 cores, got %.2f", got)
		}
	})

	t.Run("isolation off removes limits, on restores", func(t *testing.T) {
		if err := p.SetIsolation(ctx, false); err != nil {
			t.Fatal(err)
		}
		off := cores(t, p, "noisy", 500, 2)
		t.Logf("isolation off: %.2f cores", off)
		if off < 0.8 {
			t.Fatalf("limits should be gone, got %.2f cores (host needs >= 2 cpus)", off)
		}
		if err := p.SetIsolation(ctx, true); err != nil {
			t.Fatal(err)
		}
		on := cores(t, p, "noisy", 500, 2)
		t.Logf("isolation on again: %.2f cores", on)
		if on > 0.35 {
			t.Fatalf("limit not restored, got %.2f cores", on)
		}
	})

	t.Run("oom is contained and restarted", func(t *testing.T) {
		// 400 MB against a 128 MB limit: the kernel kills the container.
		_, err := run(t, p, "noisy", `{"task":"mem-alloc","params":{"mb":400,"hold_ms":100}}`)
		if err == nil {
			t.Fatal("expected the request to fail because the container was killed")
		}
		deadline := time.After(30 * time.Second)
		var sawOOM, sawRestart bool
		for !(sawOOM && sawRestart) {
			select {
			case ev := <-p.Events():
				if ev.Tenant != "noisy" {
					t.Fatalf("event for the wrong tenant: %+v", ev)
				}
				sawOOM = sawOOM || ev.Kind == EventOOMKilled
				sawRestart = sawRestart || ev.Kind == EventRestarted
			case <-deadline:
				t.Fatalf("timeout: oom=%v restarted=%v", sawOOM, sawRestart)
			}
		}
		// back in service
		for i := 0; ; i++ {
			if r, err := run(t, p, "noisy", `{"task":"echo"}`); err == nil && r.OK {
				break
			}
			if i > 100 {
				t.Fatal("noisy worker did not come back")
			}
			time.Sleep(200 * time.Millisecond)
		}
		// the neighbour was not touched
		if id, _ := p.ContainerID("quiet"); id != quietID || p.Restarts("quiet") != 0 {
			t.Fatalf("quiet tenant disturbed: restarts=%d", p.Restarts("quiet"))
		}
		if r, err := run(t, p, "quiet", `{"task":"echo"}`); err != nil || !r.OK {
			t.Fatalf("quiet tenant not healthy: %v", err)
		}
	})
}
