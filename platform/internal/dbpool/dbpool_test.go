package dbpool

import (
	"context"
	"os"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/bulkhead/platform/internal/policy"
)

func TestSemCapAndFIFO(t *testing.T) {
	var s sem
	ctx := context.Background()
	if err := s.acquire(ctx, 1); err != nil {
		t.Fatal(err)
	}
	tctx, cancel := context.WithTimeout(ctx, 20*time.Millisecond)
	defer cancel()
	if err := s.acquire(tctx, 1); err == nil {
		t.Fatal("second acquire should time out at cap 1")
	}
	done := make(chan error, 1)
	go func() { done <- s.acquire(ctx, 1) }()
	time.Sleep(10 * time.Millisecond)
	s.release() // hand-off to the waiter
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	s.release()
	if s.held != 0 {
		t.Fatalf("held=%d want 0", s.held)
	}
}

func TestBuildKinds(t *testing.T) {
	for _, k := range []Kind{KindPoint, KindReport, KindSlow, KindHog} {
		if _, _, err := build(Request{Kind: k}); err != nil {
			t.Errorf("%s: %v", k, err)
		}
	}
	if _, _, err := build(Request{Kind: "drop"}); err == nil {
		t.Error("unknown kind accepted")
	}
	if _, a, _ := build(Request{Kind: KindSlow, N: 9999}); a[0].(float64) != 30 {
		t.Error("slow N not clamped")
	}
}

func TestWorkerSecretPerTenant(t *testing.T) {
	if WorkerSecret("m", "a") == WorkerSecret("m", "b") || WorkerSecret("m", "a") != WorkerSecret("m", "a") {
		t.Fatal("secret must be deterministic and per tenant")
	}
}

// contention runs the S3 scenario: rogue (2-conn cap) fires 50 hogs while victim runs point
// queries. Needs DATABASE_URL (the dev postgres); skipped otherwise.
func contention(t *testing.T, iso bool) (rogueMaxHeld int, victimP99 float64, victimRejects int64) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	p, err := New(context.Background(), dsn, Config{MaxConns: 6, AcquireTimeout: 3 * time.Second}, time.Now)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	defer p.Close()
	p.SetIsolation(iso)
	rogue := policy.Policy{TenantID: "rogue", Tier: policy.TierFree, DBConns: 2}
	victim := policy.Policy{TenantID: "victim", Tier: policy.TierPro, DBConns: 4}
	ctx := context.Background()

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = p.Do(ctx, rogue, Request{Tenant: "rogue", Kind: KindHog, N: 0.4})
		}()
	}
	time.Sleep(100 * time.Millisecond) // let the hogs queue up
	var lat []float64
	for i := 0; i < 20; i++ {
		r, err := p.Do(ctx, victim, Request{Tenant: "victim", Kind: KindPoint})
		if err == nil {
			lat = append(lat, r.DBMS+r.ConnWaitMS)
		}
		time.Sleep(20 * time.Millisecond)
	}
	wg.Wait()
	sort.Float64s(lat)
	if len(lat) > 0 {
		victimP99 = lat[len(lat)-1]
	} else {
		victimP99 = 1e9
	}
	return p.Stats("rogue").PeakHeld, victimP99, p.Stats("victim").Rejects
}

func TestHogCappedAndVictimProtected(t *testing.T) {
	held, p99, rej := contention(t, true)
	if held > 2 {
		t.Fatalf("rogue held %d conns, cap is 2", held)
	}
	if p99 > 200 {
		t.Fatalf("victim p99 %.0fms with isolation ON; want near baseline", p99)
	}
	t.Logf("ON: rogue peak=%d victim p99=%.1fms rejects=%d", held, p99, rej)
}

func TestHogStarvesVictimWhenOff(t *testing.T) {
	held, p99, rej := contention(t, false)
	if held <= 2 {
		t.Fatalf("rogue peak %d: expected it to exceed 2 with isolation OFF", held)
	}
	if p99 < 200 && rej == 0 {
		t.Fatalf("victim not starved with isolation OFF (p99 %.0fms)", p99)
	}
	t.Logf("OFF: rogue peak=%d victim p99=%.1fms rejects=%d", held, p99, rej)
}
