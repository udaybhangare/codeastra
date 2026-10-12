// Command mockstream emits realistic snapshot/event WebSocket messages on
// /admin/stream so the dashboard can be built without the backend.
//
//	go run ./cmd/mockstream            # serve ws://localhost:8081/admin/stream
//	go run ./cmd/mockstream -print 5   # print 5 seconds of messages as JSON lines
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/websocket"
)

type tenantSpec struct {
	id, tier string
	baseRPS  float64
	baseP99  float64
}

var cast = []tenantSpec{
	{"acme-shop", "pro", 30, 45},
	{"data-co", "enterprise", 18, 80},
	{"bursty-news", "free", 6, 40},
	{"rogue-ml", "free", 5, 60},
	{"leaky-app", "pro", 10, 55},
}

// gen produces deterministic messages from a seed and a tick counter.
type gen struct {
	rng   *rand.Rand
	start time.Time
	level map[string]int
}

func newGen(seed int64, start time.Time) *gen {
	return &gen{rng: rand.New(rand.NewSource(seed)), start: start, level: map[string]int{}}
}

func clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

// step returns the messages for second t (snapshot always; event on level changes).
// Story loop (90s): rogue-ml floods from t=20, is throttled to L2 at ~26 and L3 at ~32,
// recovers after t=60; bursty-news has a legit flash crowd t=70..80 and is NOT throttled.
func (g *gen) step(t int) []map[string]any {
	ts := g.start.Add(time.Duration(t) * time.Second).UTC().Format(time.RFC3339)
	ph := t % 90
	var msgs []map[string]any
	var tenants []map[string]any
	totalCPU := 0.0
	for _, c := range cast {
		rps, p99, cpu := c.baseRPS, c.baseP99, 0.05
		lvl := 0
		switch c.id {
		case "rogue-ml":
			if ph >= 20 && ph < 60 {
				rps = 20
				cpu = 0.55
				p99 = 2400
				switch {
				case ph >= 32:
					lvl, cpu, rps = 3, 0.2, 6
				case ph >= 26:
					lvl, cpu, rps = 2, 0.35, 12
				default:
					lvl = 1
				}
			}
		case "acme-shop", "data-co":
			if ph >= 20 && ph < 32 {
				infl := 1 + 2.5*math.Min(1, float64(ph-20)/6)
				if ph >= 26 {
					infl = 3.5 - 2.4*math.Min(1, float64(ph-26)/6)
				}
				p99 *= infl
			}
		case "bursty-news":
			if ph >= 70 && ph < 80 {
				rps *= 10
				cpu = 0.15
				p99 *= 1.3
			}
		case "leaky-app":
			cpu = 0.07
		}
		rps = math.Max(0, rps+g.rng.NormFloat64()*rps*0.05)
		p99 = math.Max(1, p99*(1+g.rng.NormFloat64()*0.04))
		rej := 0.0
		if lvl >= 2 {
			rej = rps * 0.4
		}
		totalCPU += cpu
		mem := 120.0
		if c.id == "leaky-app" {
			mem = 120 + float64(t%300)*1.5
		}
		tenants = append(tenants, map[string]any{
			"tenant_id": c.id, "tier": c.tier, "level": lvl,
			"rps": round(rps), "ok_rps": round(rps - rej), "rejected_rps": round(rej),
			"cost_units_s": round(rps * 1.5), "queue_depth": int(rps / 5),
			"inflight": int(rps / 8), "p50_ms": round(p99 * 0.35), "p95_ms": round(p99 * 0.7),
			"p99_ms": round(p99), "queue_wait_p95_ms": round(p99 * 0.1),
			"cpu_share": round(clamp(cpu, 0, 1)), "mem_mb": round(mem),
			"db_conns": int(2 + rps/10), "bytes_s": round(rps * 800),
			"p_overload": round(clamp(float64(lvl)*0.25+g.rng.Float64()*0.05, 0, 1)),
		})
		if prev, ok := g.level[c.id]; ok && prev != lvl {
			msgs = append(msgs, map[string]any{
				"type": "event", "ts": ts, "kind": "throttle", "tenant_id": c.id,
				"from_level": prev, "to_level": lvl, "actor": "detector",
				"message":  fmt.Sprintf("%s moved L%d -> L%d", c.id, prev, lvl),
				"evidence": map[string]any{"victim_p99_inflation": 2.8, "cpu_share": round(cpu)},
				"actions":  []map[string]any{{"type": "set_weight", "value": 0.25}},
			})
		}
		g.level[c.id] = lvl
	}
	pov := clamp(totalCPU-0.4, 0, 1)
	snap := map[string]any{
		"type": "snapshot", "ts": ts, "isolation": "on",
		"host":     map[string]any{"cpu_util": round(clamp(totalCPU, 0, 1)), "mem_util": 0.42, "db_conn_util": 0.3, "p_overload": round(pov)},
		"fairness": map[string]any{"jain": round(clamp(1-pov*0.3, 0, 1)), "victim_inflation": round(1 + pov*2)},
		"tenants":  tenants,
	}
	return append([]map[string]any{snap}, msgs...)
}

func round(v float64) float64 { return math.Round(v*1000) / 1000 }

func main() {
	addr := flag.String("addr", ":8081", "listen address")
	printN := flag.Int("print", 0, "print N seconds of messages as JSON lines and exit")
	seed := flag.Int64("seed", 42, "PRNG seed")
	flag.Parse()

	if *printN > 0 {
		g := newGen(*seed, time.Unix(1_700_000_000, 0))
		enc := json.NewEncoder(os.Stdout)
		// start inside the attack window so events appear in a short print
		for t := 18; t < 18+*printN; t++ {
			for _, m := range g.step(t) {
				_ = enc.Encode(m)
			}
		}
		return
	}

	up := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	http.HandleFunc("/admin/stream", func(w http.ResponseWriter, r *http.Request) {
		conn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		g := newGen(*seed, time.Now())
		tk := time.NewTicker(time.Second)
		defer tk.Stop()
		for t := 0; ; t++ {
			for _, m := range g.step(t) {
				if err := conn.WriteJSON(m); err != nil {
					return
				}
			}
			<-tk.C
		}
	})
	log.Printf("mockstream listening on %s (ws://localhost%s/admin/stream)", *addr, *addr)
	log.Fatal(http.ListenAndServe(*addr, nil))
}
