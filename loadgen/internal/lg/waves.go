package lg

import (
	"fmt"
	"io"
	"sort"
	"strings"
	"text/tabwriter"
	"time"
)

// WaveTenant is one tenant's outcome inside one wave.
type WaveTenant struct {
	Tenant    string  `json:"tenant"`
	Role      string  `json:"role"`
	Sent      int     `json:"sent"`
	OK        int     `json:"ok"`
	Rejected  int     `json:"rejected"`
	Errors    int     `json:"errors"`
	Throttled int     `json:"throttled"` // requests answered at throttle level >= 1
	MaxLevel  int     `json:"max_throttle_level"`
	P99Ms     float64 `json:"p99_ms"`
}

// WaveReport is the per-attack-kind view of an attack phase.
type WaveReport struct {
	Wave
	Tenants []WaveTenant `json:"tenants"`
}

// BuildWaves buckets first attempts by the wave their intended offset falls in.
// Wave times are relative to the start of the attack phase.
func BuildWaves(sc *Scenario, res []Result) []WaveReport {
	if len(sc.Waves) == 0 {
		return nil
	}
	var atk time.Duration
	for _, w := range sc.Windows() {
		if w.Name == "attack" {
			atk = w.Start
		}
	}
	roleOf := map[string]string{}
	for _, t := range sc.Tenants {
		roleOf[t.Tenant] = t.Role
	}
	type acc struct {
		WaveTenant
		lat []float64
	}
	out := make([]WaveReport, len(sc.Waves))
	accs := make([]map[string]*acc, len(sc.Waves))
	for i, w := range sc.Waves {
		out[i].Wave = w
		accs[i] = map[string]*acc{}
	}
	for _, r := range res {
		if r.Attempt > 0 {
			continue
		}
		for i, w := range sc.Waves {
			lo := atk + time.Duration(w.StartS*float64(time.Second))
			hi := atk + time.Duration(w.EndS*float64(time.Second))
			if r.At < lo || r.At >= hi {
				continue
			}
			a := accs[i][r.Tenant]
			if a == nil {
				a = &acc{WaveTenant: WaveTenant{Tenant: r.Tenant, Role: roleOf[r.Tenant]}}
				accs[i][r.Tenant] = a
			}
			a.Sent++
			if r.Level > a.MaxLevel {
				a.MaxLevel = r.Level
			}
			if r.Level >= 1 {
				a.Throttled++
			}
			switch {
			case r.Dropped:
				a.Errors++
			case r.Status >= 200 && r.Status < 300:
				a.OK++
				a.lat = append(a.lat, r.LatencyMs)
			case r.Status == 429 || r.Status == 503:
				a.Rejected++
			default:
				a.Errors++
			}
		}
	}
	for i := range out {
		for _, a := range accs[i] {
			sort.Float64s(a.lat)
			a.P99Ms = pct(a.lat, .99)
			out[i].Tenants = append(out[i].Tenants, a.WaveTenant)
		}
		sort.Slice(out[i].Tenants, func(x, y int) bool { return out[i].Tenants[x].Tenant < out[i].Tenants[y].Tenant })
	}
	return out
}

// WaveAt names the wave active at elapsed (scenario time), or "".
func WaveAt(sc *Scenario, elapsed time.Duration) string {
	var atk time.Duration
	for _, w := range sc.Windows() {
		if w.Name == "attack" {
			atk = w.Start
		}
	}
	s := (elapsed - atk).Seconds()
	var names []string
	for _, w := range sc.Waves {
		if s >= w.StartS && s < w.EndS {
			names = append(names, w.Name)
		}
	}
	return strings.Join(names, "+")
}

// FormatWaves prints the per-wave table: who was throttled/rejected when.
func FormatWaves(w io.Writer, r *Report) {
	if len(r.Waves) == 0 {
		return
	}
	fmt.Fprintln(w, "\nPER-WAVE (throttle log; THR = requests served at throttle level>=1, LVL = max level)")
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "WAVE\tKIND\tTENANT\tROLE\tSENT\tOK\tREJ\tERR\tTHR\tLVL\tP99ms")
	for _, wv := range r.Waves {
		for _, t := range wv.Tenants {
			fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%d\t%d\t%d\t%d\t%d\t%d\t%.0f\n",
				wv.Name, wv.Kind, t.Tenant, t.Role, t.Sent, t.OK, t.Rejected, t.Errors, t.Throttled, t.MaxLevel, t.P99Ms)
		}
	}
	tw.Flush()
}
