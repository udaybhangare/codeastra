package lg

import (
	"fmt"
	"math"
	"sort"
	"time"
)

type PhaseStats struct {
	Scheduled     int            `json:"scheduled"`
	Sent          int            `json:"sent"`
	OK            int            `json:"ok"`
	Rejected      int            `json:"rejected"`
	Errors        int            `json:"errors"`
	Dropped       int            `json:"dropped"`
	Retries       int            `json:"retries"`
	OfferedRPS    float64        `json:"offered_rps"`
	OKRPS         float64        `json:"ok_rps"`
	P50Ms         float64        `json:"p50_ms"`
	P95Ms         float64        `json:"p95_ms"`
	P99Ms         float64        `json:"p99_ms"`
	QueueWaitP95  float64        `json:"queue_wait_p95_ms"`
	MaxLevel      int            `json:"max_throttle_level"`
	RejectReasons map[string]int `json:"reject_reasons,omitempty"`
}

type TenantReport struct {
	Tenant       string                `json:"tenant"`
	Role         string                `json:"role"`
	Phases       map[string]PhaseStats `json:"phases"`
	P99Inflation float64               `json:"p99_inflation"` // attack p99 / warmup p99
	CooldownInfl float64               `json:"cooldown_inflation"`
}

type AssertResult struct {
	Assertion
	Actual float64 `json:"actual"`
	Pass   bool    `json:"pass"`
	Note   string  `json:"note,omitempty"`
}

type Dispatch struct {
	TargetRPS   float64 `json:"target_rps"`
	AchievedRPS float64 `json:"achieved_rps"`
	MaxLagMs    float64 `json:"max_lag_ms"`
	MeanLagMs   float64 `json:"mean_lag_ms"`
	Dropped     int64   `json:"dropped"`
}

type Report struct {
	Scenario     string             `json:"scenario"`
	Seed         int64              `json:"seed"`
	Mode         string             `json:"isolation_mode"`
	ScheduleHash string             `json:"schedule_hash"`
	StartedAt    time.Time          `json:"started_at"`
	EndedAt      time.Time          `json:"ended_at"`
	Dispatch     Dispatch           `json:"dispatch"`
	Tenants      []TenantReport     `json:"tenants"`
	Metrics      map[string]float64 `json:"metrics"`
	Assertions   []AssertResult     `json:"assertions"`
	Pass         bool               `json:"pass"`
}

const never = 9999.0 // sentinel for "event never observed"

func pct(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	i := int(math.Ceil(p*float64(len(sorted)))) - 1
	return sorted[max(0, min(i, len(sorted)-1))]
}

// BuildReport aggregates raw attempts into per-phase per-tenant stats, run
// metrics and assertion results.
func BuildReport(sc *Scenario, reqs []Request, res []Result, st ExecStats, seed int64, mode string, startedAt, endedAt time.Time) *Report {
	wins := map[string]PhaseWindow{}
	for _, w := range sc.Windows() {
		wins[w.Name] = w
	}
	type key struct{ tenant, phase string }
	type acc struct {
		PhaseStats
		lat, qw []float64
	}
	accs := map[key]*acc{}
	get := func(t, p string) *acc {
		a := accs[key{t, p}]
		if a == nil {
			a = &acc{}
			a.RejectReasons = map[string]int{}
			a.MaxLevel = -1
			accs[key{t, p}] = a
		}
		return a
	}
	for _, r := range reqs {
		get(r.Tenant, r.Phase).Scheduled++
	}
	for _, r := range res {
		a := get(r.Tenant, r.Phase)
		if r.Level > a.MaxLevel {
			a.MaxLevel = r.Level
		}
		if r.Attempt > 0 {
			a.Retries++
			continue
		}
		a.Sent++
		switch {
		case r.Dropped:
			a.Dropped++
			a.Errors++
		case r.Status >= 200 && r.Status < 300:
			a.OK++
			a.lat = append(a.lat, r.LatencyMs)
			a.qw = append(a.qw, r.QueueWaitMs)
		case r.Status == 429 || r.Status == 503:
			a.Rejected++
			reason := r.Reason
			if reason == "" {
				reason = fmt.Sprint(r.Status)
			}
			a.RejectReasons[reason]++
		default:
			a.Errors++
		}
	}
	rep := &Report{Scenario: sc.Name, Seed: seed, Mode: mode, ScheduleHash: ScheduleHash(reqs),
		StartedAt: startedAt, EndedAt: endedAt, Metrics: map[string]float64{}}

	for _, ts := range sc.Tenants {
		tr := TenantReport{Tenant: ts.Tenant, Role: ts.Role, Phases: map[string]PhaseStats{}}
		for _, w := range sc.Windows() {
			a := accs[key{ts.Tenant, w.Name}]
			if a == nil {
				continue
			}
			sort.Float64s(a.lat)
			sort.Float64s(a.qw)
			dur := (w.End - w.Start).Seconds()
			a.P50Ms, a.P95Ms, a.P99Ms = pct(a.lat, .5), pct(a.lat, .95), pct(a.lat, .99)
			a.QueueWaitP95 = pct(a.qw, .95)
			a.OfferedRPS = float64(a.Sent) / dur
			a.OKRPS = float64(a.OK) / dur
			if len(a.RejectReasons) == 0 {
				a.RejectReasons = nil
			}
			tr.Phases[w.Name] = a.PhaseStats
		}
		if base := tr.Phases["warmup"].P99Ms; base > 0 {
			tr.P99Inflation = tr.Phases["attack"].P99Ms / base
			tr.CooldownInfl = tr.Phases["cooldown"].P99Ms / base
		}
		rep.Tenants = append(rep.Tenants, tr)
	}

	// dispatch accuracy: achieved send rate over the active span
	if st.Sent > 1 && st.LastSend > st.FirstSend {
		rep.Dispatch.AchievedRPS = float64(st.Sent-1) / (st.LastSend - st.FirstSend).Seconds()
	}
	if span := sc.Total().Seconds(); span > 0 {
		rep.Dispatch.TargetRPS = float64(len(reqs)) / span
	}
	rep.Dispatch.MaxLagMs = float64(st.MaxLag) / float64(time.Millisecond)
	if st.Sent > 0 {
		rep.Dispatch.MeanLagMs = float64(st.SumLag) / float64(st.Sent) / float64(time.Millisecond)
	}
	rep.Dispatch.Dropped = st.Dropped

	// run metrics
	roleOf := map[string]string{}
	for _, ts := range sc.Tenants {
		roleOf[ts.Tenant] = ts.Role
	}
	m := rep.Metrics
	m["victim_p99_inflation"] = 0
	m["victim_errors"] = 0
	m["victim_queue_wait_p95_ms"] = 0
	m["victim_throughput_ratio"] = math.Inf(1)
	var sat []float64
	for _, t := range rep.Tenants {
		att := t.Phases["attack"]
		switch t.Role {
		case "victim":
			m["victim_p99_inflation"] = math.Max(m["victim_p99_inflation"], t.P99Inflation)
			m["victim_errors"] += float64(att.Rejected + att.Errors)
			m["victim_queue_wait_p95_ms"] = math.Max(m["victim_queue_wait_p95_ms"], att.QueueWaitP95)
			if w := t.Phases["warmup"].OKRPS; w > 0 {
				m["victim_throughput_ratio"] = math.Min(m["victim_throughput_ratio"], att.OKRPS/w)
			}
		case "culprit":
			m["abuser_goodput_rps"] += att.OKRPS
			m["culprit_rejected"] += float64(att.Rejected)
		case "false_positive_probe":
			for _, p := range t.Phases {
				if p.MaxLevel >= 4 {
					m["false_positive_count"]++
					break
				}
			}
		}
		if t.Role != "culprit" && att.Sent > 0 {
			sat = append(sat, float64(att.OK)/float64(att.Sent))
		}
	}
	if math.IsInf(m["victim_throughput_ratio"], 1) {
		m["victim_throughput_ratio"] = 0
	}
	m["jain"] = jain(sat)
	m["time_to_detect_s"], m["time_to_mitigate_s"] = never, never
	if aw, ok := wins["attack"]; ok {
		for _, r := range res {
			if roleOf[r.Tenant] != "culprit" || r.Attempt > 0 || r.At < aw.Start {
				continue
			}
			s := (r.At - aw.Start).Seconds()
			if r.Level >= 2 && s < m["time_to_detect_s"] {
				m["time_to_detect_s"] = s
			}
			if r.Level >= 3 && s < m["time_to_mitigate_s"] {
				m["time_to_mitigate_s"] = s
			}
		}
	}

	rep.Pass = true
	for _, a := range sc.Assertions {
		ar := Evaluate(a, rep, roleOf)
		rep.Assertions = append(rep.Assertions, ar)
		rep.Pass = rep.Pass && ar.Pass
	}
	return rep
}

func jain(x []float64) float64 {
	var s, s2 float64
	for _, v := range x {
		s += v
		s2 += v * v
	}
	if len(x) == 0 || s2 == 0 {
		return 1
	}
	return s * s / (float64(len(x)) * s2)
}

// Evaluate checks one assertion. With applies_to set, victim_* metrics and
// p99_inflation/errors are restricted to that tenant.
func Evaluate(a Assertion, rep *Report, roleOf map[string]string) AssertResult {
	ar := AssertResult{Assertion: a}
	val, ok := rep.Metrics[a.Metric]
	if a.AppliesTo != "" {
		for _, t := range rep.Tenants {
			if t.Tenant != a.AppliesTo {
				continue
			}
			att := t.Phases["attack"]
			switch a.Metric {
			case "p99_inflation", "victim_p99_inflation":
				val, ok = t.P99Inflation, true
			case "errors", "victim_errors":
				val, ok = float64(att.Rejected+att.Errors), true
			case "queue_wait_p95_ms", "victim_queue_wait_p95_ms":
				val, ok = att.QueueWaitP95, true
			case "p99_ms":
				val, ok = att.P99Ms, true
			}
		}
	}
	if !ok {
		ar.Note = "unknown metric"
		return ar
	}
	ar.Actual = val
	switch a.Op {
	case "<=":
		ar.Pass = val <= a.Value
	case ">=":
		ar.Pass = val >= a.Value
	case "==":
		ar.Pass = val == a.Value
	case "<":
		ar.Pass = val < a.Value
	case ">":
		ar.Pass = val > a.Value
	}
	return ar
}
