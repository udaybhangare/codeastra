package scheduler

import (
	"math"
	"math/rand"
	"strconv"
	"testing"
)

func always(string, bool) bool { return true }

func job(t string, c float64) *Job { return &Job{Tenant: t, Cost: c} }

// Property: always-backlogged tenants receive cost shares proportional to weight.
func TestDRRSharesFollowWeights(t *testing.T) {
	for seed := int64(1); seed <= 5; seed++ {
		rng := rand.New(rand.NewSource(seed))
		d := NewDRR(DRRConfig{DefaultQueueCap: 50})
		weights := map[string]float64{"a": 1, "b": 2, "c": 5, "d": 4}
		var totalW float64
		for id, w := range weights {
			d.SetWeight(id, w)
			totalW += w
		}
		// Different tenants use very different job sizes (cpu-burn vs echo).
		sizes := map[string][2]float64{"a": {1, 400}, "b": {5, 50}, "c": {100, 300}, "d": {1, 20}}
		fill := func(id string) {
			for d.Depth(id) < 40 {
				s := sizes[id]
				if err := d.Enqueue(job(id, s[0]+rng.Float64()*(s[1]-s[0]))); err != nil {
					t.Fatal(err)
				}
			}
		}
		got := map[string]float64{}
		var total float64
		for i := 0; i < 60000; i++ {
			for id := range weights {
				fill(id)
			}
			j, ok := d.Next(always)
			if !ok {
				t.Fatal("backlogged scheduler returned nothing")
			}
			got[j.Tenant] += j.Cost
			total += j.Cost
		}
		for id, w := range weights {
			want, have := w/totalW, got[id]/total
			if math.Abs(have-want) > 0.05*want {
				t.Errorf("seed %d tenant %s share %.4f want %.4f (±5%%)", seed, id, have, want)
			}
		}
	}
}

func TestDRRIdleTenantDoesNotHoardCredit(t *testing.T) {
	d := NewDRR(DRRConfig{})
	d.SetWeight("idle", 1)
	d.SetWeight("busy", 1)
	// idle sends one job, then stays quiet while busy runs for a long time.
	_ = d.Enqueue(job("idle", 10))
	for i := 0; i < 1000; i++ {
		_ = d.Enqueue(job("busy", 10))
		if _, ok := d.Next(always); !ok {
			t.Fatal("no job")
		}
	}
	if tq := d.tenant("idle"); tq.deficit != 0 {
		t.Fatalf("idle tenant kept deficit %v", tq.deficit)
	}
	// Both backlogged now: idle must get ~half, not a catch-up burst.
	got := map[string]float64{}
	for i := 0; i < 2000; i++ {
		for _, id := range []string{"idle", "busy"} {
			for d.Depth(id) < 20 {
				_ = d.Enqueue(job(id, 10))
			}
		}
		j, _ := d.Next(always)
		got[j.Tenant] += j.Cost
		if i == 99 && got["idle"] > 0.6*(got["idle"]+got["busy"]) {
			t.Fatalf("idle tenant burst after sleeping: %v", got)
		}
	}
}

func TestDRRSingleTenantGetsEverything(t *testing.T) {
	d := NewDRR(DRRConfig{})
	d.SetWeight("solo", 1)
	d.SetWeight("other", 100) // heavy weight, but idle
	for i := 0; i < 500; i++ {
		_ = d.Enqueue(job("solo", 7))
	}
	for i := 0; i < 500; i++ {
		if _, ok := d.Next(always); !ok {
			t.Fatalf("work conservation violated at dispatch %d", i)
		}
	}
	if _, ok := d.Next(always); ok {
		t.Fatal("expected empty")
	}
}

func TestDRROversizeJobAccumulatesWithoutBlocking(t *testing.T) {
	d := NewDRR(DRRConfig{BaseQuantum: 100})
	_ = d.Enqueue(job("big", 1500)) // 15 quanta
	for i := 0; i < 30; i++ {
		_ = d.Enqueue(job("small", 10))
	}
	smallBefore := 0
	for {
		j, ok := d.Next(always)
		if !ok {
			t.Fatal("ran dry")
		}
		if j.Tenant == "big" {
			break
		}
		smallBefore++
	}
	if smallBefore == 0 {
		t.Fatal("small tenant was blocked behind an oversize job")
	}
}

func TestDRRQueueBoundedAndCapLive(t *testing.T) {
	d := NewDRR(DRRConfig{})
	d.SetQueueCap("x", 3)
	for i := 0; i < 3; i++ {
		if err := d.Enqueue(job("x", 1)); err != nil {
			t.Fatal(err)
		}
	}
	if err := d.Enqueue(job("x", 1)); err != ErrQueueFull {
		t.Fatalf("want ErrQueueFull, got %v", err)
	}
	if d.Depth("x") != 3 {
		t.Fatalf("depth %d", d.Depth("x"))
	}
	d.SetQueueCap("x", 4)
	if err := d.Enqueue(job("x", 1)); err != nil {
		t.Fatal(err)
	}
}

func TestDRRSkipsIneligibleTenant(t *testing.T) {
	d := NewDRR(DRRConfig{})
	_ = d.Enqueue(job("capped", 1))
	_ = d.Enqueue(job("free", 1))
	j, ok := d.Next(func(tn string, _ bool) bool { return tn != "capped" })
	if !ok || j.Tenant != "free" {
		t.Fatalf("got %v %v", j, ok)
	}
	if _, ok := d.Next(func(tn string, _ bool) bool { return tn != "capped" }); ok {
		t.Fatal("capped tenant should not run")
	}
	if j, ok := d.Next(always); !ok || j.Tenant != "capped" {
		t.Fatal("capped tenant lost its job")
	}
}

func TestQuarantineLaneIsLowWeightButNotStarved(t *testing.T) {
	d := NewDRR(DRRConfig{BaseQuantum: 100, QuarantineEvery: 4})
	d.SetWeight("good", 4)
	d.SetWeight("bad", 4)
	d.SetQuarantine("bad", true)
	got := map[string]float64{}
	for i := 0; i < 5000; i++ {
		for _, id := range []string{"good", "bad"} {
			for d.Depth(id) < 10 {
				_ = d.Enqueue(job(id, 10))
			}
		}
		j, _ := d.Next(always)
		got[j.Tenant] += j.Cost
	}
	if got["bad"] == 0 {
		t.Fatal("quarantined tenant starved")
	}
	if got["bad"] > 0.4*got["good"] {
		t.Fatalf("quarantine lane too generous: %v", got)
	}
	// Eligible gets lane info so the dispatcher can cap quarantine slots.
	sawQuar := false
	_ = d.Enqueue(job("bad", 1))
	d.Next(func(_ string, q bool) bool { sawQuar = sawQuar || q; return true })
}

func TestQuarantineLaneSlotCapViaEligible(t *testing.T) {
	d := NewDRR(DRRConfig{})
	d.SetQuarantine("bad", true)
	_ = d.Enqueue(job("bad", 1))
	_ = d.Enqueue(job("good", 1))
	for i := 0; i < 2; i++ {
		j, ok := d.Next(func(_ string, q bool) bool { return !q })
		if i == 0 && (!ok || j.Tenant != "good") {
			t.Fatalf("want good, got %v", j)
		}
		if i == 1 && ok {
			t.Fatal("quarantine slots exhausted: bad must wait")
		}
	}
}

func TestSetQuarantineMovesQueuedTenant(t *testing.T) {
	d := NewDRR(DRRConfig{})
	for i := 0; i < 5; i++ {
		_ = d.Enqueue(job("t", 1))
	}
	if _, ok := d.Next(always); !ok { // t now in main ring
		t.Fatal()
	}
	d.SetQuarantine("t", true)
	var lanes []bool
	for i := 0; i < 4; i++ {
		d.Next(func(_ string, q bool) bool { lanes = append(lanes, q); return true })
	}
	if len(lanes) == 0 || !lanes[len(lanes)-1] {
		t.Fatalf("tenant not served from quarantine lane: %v", lanes)
	}
}

// ---- victim queue-wait: virtual-time simulation, one worker slot ----

type simResult struct{ maxVictimWait float64 }

func simulate(s Scheduler) simResult {
	const (
		abuserJobs  = 200
		abuserCost  = 100.0
		victimEvery = 50.0
		victimCost  = 1.0
		horizon     = 3000.0
	)
	for i := 0; i < abuserJobs; i++ {
		_ = s.Enqueue(&Job{Tenant: "abuser", Cost: abuserCost})
	}
	var res simResult
	now, nextVictim := 0.0, 10.0
	arrivals := map[*Job]float64{}
	for now < horizon {
		for nextVictim <= now {
			j := &Job{Tenant: "victim", Cost: victimCost}
			arrivals[j] = nextVictim
			_ = s.Enqueue(j)
			nextVictim += victimEvery
		}
		j, ok := s.Next(always)
		if !ok {
			now = nextVictim
			continue
		}
		if a, isV := arrivals[j]; isV {
			res.maxVictimWait = math.Max(res.maxVictimWait, now-a)
			delete(arrivals, j)
		}
		now += j.Cost // service time = cost units
	}
	for _, a := range arrivals { // still queued at the horizon: they waited at least this long
		res.maxVictimWait = math.Max(res.maxVictimWait, now-a)
	}
	return res
}

func TestVictimWaitBoundedUnderDRRButNotFIFO(t *testing.T) {
	drr := NewDRR(DRRConfig{BaseQuantum: 100, DefaultQueueCap: 1000})
	fifo := NewFIFO(1000)
	d, f := simulate(drr), simulate(fifo)
	t.Logf("max victim wait: DRR=%.0f FIFO=%.0f", d.maxVictimWait, f.maxVictimWait)
	if d.maxVictimWait > 3*100 {
		t.Errorf("DRR victim wait %.0f exceeds bound 300", d.maxVictimWait)
	}
	if f.maxVictimWait < 10*d.maxVictimWait || f.maxVictimWait < 2000 {
		t.Errorf("FIFO should show head-of-line blocking, got %.0f", f.maxVictimWait)
	}
}

func TestSwitchPreservesQueuedJobs(t *testing.T) {
	s := NewSwitch(DRRConfig{DefaultQueueCap: 100}, 100)
	s.SetWeight("a", 3)
	var order []string
	for i := 0; i < 5; i++ {
		_ = s.Enqueue(job("a", 1))
		_ = s.Enqueue(job("b", 1))
	}
	s.Use(false)
	if s.IsDRR() || s.Depth("a") != 5 || s.Depth("b") != 5 {
		t.Fatalf("after FIFO swap: drr=%v a=%d b=%d", s.IsDRR(), s.Depth("a"), s.Depth("b"))
	}
	s.Use(true)
	if s.Depth("a") != 5 || s.Depth("b") != 5 {
		t.Fatal("jobs lost on swap back")
	}
	for {
		j, ok := s.Next(always)
		if !ok {
			break
		}
		order = append(order, j.Tenant)
	}
	if len(order) != 10 {
		t.Fatalf("drained %d jobs, want 10", len(order))
	}
}

func TestSwapDropsOverflowViaOnDrop(t *testing.T) {
	s := NewSwitch(DRRConfig{DefaultQueueCap: 100}, 2)
	dropped := 0
	for i := 0; i < 5; i++ {
		_ = s.Enqueue(&Job{Tenant: "a", Cost: 1, OnDrop: func(error) { dropped++ }})
	}
	s.Use(false) // FIFO cap 2
	if dropped != 3 || s.Depth("a") != 2 {
		t.Fatalf("dropped=%d depth=%d", dropped, s.Depth("a"))
	}
}

func TestConcurrentEnqueueWithSwap(t *testing.T) {
	s := NewSwitch(DRRConfig{DefaultQueueCap: 100000}, 100000)
	done := make(chan struct{})
	const n, per = 8, 2000
	for g := 0; g < n; g++ {
		go func(g int) {
			for i := 0; i < per; i++ {
				_ = s.Enqueue(job("t"+strconv.Itoa(g), 1))
			}
			done <- struct{}{}
		}(g)
	}
	for i := 0; i < 20; i++ {
		s.Use(i%2 == 1)
	}
	for g := 0; g < n; g++ {
		<-done
	}
	got := 0
	for {
		if _, ok := s.Next(always); !ok {
			break
		}
		got++
	}
	if got != n*per {
		t.Fatalf("lost jobs: got %d want %d", got, n*per)
	}
}
