package lg

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"math"
	"math/rand/v2"
	"sort"
	"strings"
	"time"
)

// Request is one scheduled arrival. The schedule is a pure function of
// (scenario, seed): same inputs => byte-identical Canonical output.
type Request struct {
	Seq          int
	Offset       time.Duration // from scenario start
	Tenant       string
	Phase        string
	Task         string
	Params       map[string]any
	PayloadBytes int
	IgnoreRetry  bool // retry-storm profile: retry 429/503 immediately, ignoring Retry-After
}

type seg struct{ t0, t1, r0, r1 float64 } // seconds within the phase, rps

// segments turns an arrival spec into piecewise-linear rate segments.
func segments(a Arrival, durS float64) []seg {
	switch a.Process {
	case "ramp":
		end := a.RPSEnd
		return []seg{{0, durS, a.RPS, end}}
	case "burst":
		mult := a.BurstMultiplier
		if mult < 1 {
			mult = 10
		}
		bd := a.BurstDurationS
		if bd <= 0 || bd > durS {
			bd = math.Min(durS, 20)
		}
		b0 := (durS - bd) / 2 // burst is centred in the phase
		b1 := b0 + bd
		out := []seg{}
		if b0 > 0 {
			out = append(out, seg{0, b0, a.RPS, a.RPS})
		}
		out = append(out, seg{b0, b1, a.RPS * mult, a.RPS * mult})
		if b1 < durS {
			out = append(out, seg{b1, durS, a.RPS, a.RPS})
		}
		return out
	default:
		return []seg{{0, durS, a.RPS, a.RPS}}
	}
}

// advance consumes `mass` units of integrated rate starting at time t and
// returns the new time, or ok=false if the segments run out first.
func advance(segs []seg, t, mass float64) (float64, bool) {
	for _, s := range segs {
		if t >= s.t1 {
			continue
		}
		if t < s.t0 {
			t = s.t0
		}
		L := s.t1 - s.t0
		k := (s.r1 - s.r0) / L
		rc := s.r0 + k*(t-s.t0)
		rem := s.t1 - t
		avail := rc*rem + k*rem*rem/2
		if avail <= 0 {
			t = s.t1
			continue
		}
		if mass <= avail {
			d := rc*rc + 2*k*mass
			if d < 0 {
				d = 0
			}
			den := rc + math.Sqrt(d)
			if den <= 0 {
				t = s.t1
				continue
			}
			return t + 2*mass/den, true
		}
		mass -= avail
		t = s.t1
	}
	return t, false
}

func stream(seed int64, parts ...string) *rand.Rand {
	h := fnv.New64a()
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{0})
	}
	return rand.New(rand.NewPCG(uint64(seed), h.Sum64()))
}

func pickMix(r *rand.Rand, mix []TaskMix, total float64) TaskMix {
	x := r.Float64() * total
	for _, m := range mix {
		if x < m.Weight {
			return m
		}
		x -= m.Weight
	}
	return mix[len(mix)-1]
}

// BuildSchedule generates the full deterministic request schedule.
func BuildSchedule(sc *Scenario, seed int64) []Request {
	var reqs []Request
	win := map[string]PhaseWindow{}
	for _, w := range sc.Windows() {
		win[w.Name] = w
	}
	for _, ts := range sc.Tenants {
		for _, a := range ts.Arrivals {
			w, ok := win[a.Phase]
			if !ok || a.RPS == 0 && a.RPSEnd == 0 {
				continue
			}
			durS := (w.End - w.Start).Seconds()
			segs := segments(a, durS)
			arr := stream(seed, ts.Tenant, a.Phase, "arrivals")
			mixr := stream(seed, ts.Tenant, a.Phase, "mix")
			mix := a.TaskMix
			if len(mix) == 0 {
				mix = []TaskMix{{Task: "echo", Weight: 1}}
			}
			total := 0.0
			for _, m := range mix {
				total += m.Weight
			}
			t := 0.0
			for {
				e := 1.0
				if a.Process != "constant" {
					e = arr.ExpFloat64()
				}
				var ok bool
				if t, ok = advance(segs, t, e); !ok || t >= durS {
					break
				}
				m := pickMix(mixr, mix, total)
				reqs = append(reqs, Request{
					Offset: w.Start + time.Duration(math.Round(t*1e9)),
					Tenant: ts.Tenant, Phase: a.Phase, Task: m.Task,
					Params: m.Params, PayloadBytes: m.PayloadBytes,
					IgnoreRetry: a.RetryWithoutBackoff,
				})
			}
		}
	}
	order := map[string]int{}
	for i, ts := range sc.Tenants {
		order[ts.Tenant] = i
	}
	sort.SliceStable(reqs, func(i, j int) bool {
		if reqs[i].Offset != reqs[j].Offset {
			return reqs[i].Offset < reqs[j].Offset
		}
		return order[reqs[i].Tenant] < order[reqs[j].Tenant]
	})
	for i := range reqs {
		reqs[i].Seq = i
	}
	return reqs
}

// Canonical serialises the schedule to stable bytes (for hashing/diffing).
func Canonical(reqs []Request) []byte {
	var b strings.Builder
	for _, r := range reqs {
		p, _ := json.Marshal(r.Params) // map keys are sorted
		fmt.Fprintf(&b, "%d\t%d\t%s\t%s\t%s\t%d\t%t\t%s\n",
			r.Seq, r.Offset.Nanoseconds(), r.Tenant, r.Phase, r.Task, r.PayloadBytes, r.IgnoreRetry, p)
	}
	return []byte(b.String())
}

func ScheduleHash(reqs []Request) string {
	h := sha256.Sum256(Canonical(reqs))
	return hex.EncodeToString(h[:])
}
