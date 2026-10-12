package lg

import (
	"testing"
	"time"
)

func TestArrivalWindowAndWaves(t *testing.T) {
	sc := &Scenario{Name: "w", Phases: []Phase{{"warmup", 2}, {"attack", 20}, {"cooldown", 2}},
		Tenants: []TenantSpec{{Tenant: "a", Role: "culprit", Arrivals: []Arrival{
			{Phase: "attack", Process: "constant", RPS: 10, StartS: 5, EndS: 10}}}},
		Waves: []Wave{{Name: "w1", Kind: "cpu", StartS: 5, EndS: 10}}}
	if err := sc.Validate(); err != nil {
		t.Fatal(err)
	}
	reqs := BuildSchedule(sc, 1)
	if len(reqs) < 45 || len(reqs) > 55 {
		t.Fatalf("want ~50 requests in a 5 s window at 10 rps, got %d", len(reqs))
	}
	for _, r := range reqs {
		if r.Offset < 7*time.Second || r.Offset > 12*time.Second {
			t.Fatalf("offset %v outside window", r.Offset)
		}
	}
	var res []Result
	in := 0
	for _, r := range reqs {
		if r.Offset < 12*time.Second {
			in++
		}
		res = append(res, Result{Tenant: r.Tenant, At: r.Offset, Status: 429, Level: 2})
	}
	w := BuildWaves(sc, res)
	if len(w) != 1 || w[0].Tenants[0].Rejected != in || w[0].Tenants[0].MaxLevel != 2 {
		t.Fatalf("bad wave report: %+v", w)
	}
	if WaveAt(sc, 8*time.Second) != "w1" || WaveAt(sc, 3*time.Second) != "" {
		t.Fatal("WaveAt wrong")
	}
}
