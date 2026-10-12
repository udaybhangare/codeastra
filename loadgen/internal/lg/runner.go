package lg

import (
	"context"
	"fmt"
	"io"
	"sort"
	"strings"
	"text/tabwriter"
	"time"
)

// RunConfig describes one scenario execution.
type RunConfig struct {
	Scenario *Scenario
	Seed     int64
	Mode     string // "on" | "off" | "" (leave server as is)
	Sender   Sender
	Clock    Clock
	Exec     ExecConfig
	Admin    *Admin // optional; required to flip Mode
	Progress func(phase string, p Progress)
}

// Run executes warm-up/attack/cool-down open-loop and returns the report.
func Run(ctx context.Context, cfg RunConfig) (*Report, error) {
	sc := cfg.Scenario
	if cfg.Mode != "" && cfg.Admin != nil {
		if err := cfg.Admin.SetIsolation(ctx, cfg.Mode); err != nil {
			return nil, fmt.Errorf("set isolation %s: %w", cfg.Mode, err)
		}
	}
	reqs := BuildSchedule(sc, cfg.Seed)
	wins := sc.Windows()
	ex := &Executor{Clock: cfg.Clock, Sender: cfg.Sender, Cfg: cfg.Exec}
	if cfg.Progress != nil {
		ex.Progress = func(p Progress) {
			name := wins[len(wins)-1].Name
			for _, w := range wins {
				if p.Elapsed < w.End {
					name = w.Name
					break
				}
			}
			cfg.Progress(name, p)
		}
	}
	started := cfg.Clock.Now()
	res, st := ex.Run(ctx, reqs)
	ended := cfg.Clock.Now()
	mode := cfg.Mode
	if mode == "" {
		mode = "unknown"
	}
	return BuildReport(sc, reqs, res, st, cfg.Seed, mode, started, ended), nil
}

// FormatReport prints per-tenant phase stats and assertions.
func FormatReport(w io.Writer, r *Report) {
	fmt.Fprintf(w, "scenario %s  seed %d  isolation=%s  schedule=%s\n", r.Scenario, r.Seed, r.Mode, r.ScheduleHash[:12])
	fmt.Fprintf(w, "dispatch: achieved %.1f rps (target avg %.1f), max lag %.1f ms, dropped %d\n",
		r.Dispatch.AchievedRPS, r.Dispatch.TargetRPS, r.Dispatch.MaxLagMs, r.Dispatch.Dropped)
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "TENANT\tROLE\tPHASE\tSENT\tOK\tREJ\tERR\tP50ms\tP95ms\tP99ms\tINFL")
	for _, t := range r.Tenants {
		for _, ph := range []string{"warmup", "attack", "cooldown"} {
			p, ok := t.Phases[ph]
			if !ok {
				continue
			}
			infl := ""
			if ph == "attack" && t.P99Inflation > 0 {
				infl = fmt.Sprintf("%.2fx", t.P99Inflation)
			} else if ph == "cooldown" && t.CooldownInfl > 0 {
				infl = fmt.Sprintf("%.2fx", t.CooldownInfl)
			}
			fmt.Fprintf(tw, "%s\t%s\t%s\t%d\t%d\t%d\t%d\t%.0f\t%.0f\t%.0f\t%s\n",
				t.Tenant, t.Role, ph, p.Sent, p.OK, p.Rejected, p.Errors, p.P50Ms, p.P95Ms, p.P99Ms, infl)
		}
	}
	tw.Flush()
	FormatWaves(w, r)
	formatAssertions(w, r)
}

func formatAssertions(w io.Writer, r *Report) {
	for _, a := range r.Assertions {
		s := "PASS"
		if !a.Pass {
			s = "FAIL"
		}
		fmt.Fprintf(w, "  [%s] %s %s %g (actual %.3g)%s %s\n", s, a.Metric, a.Op, a.Value, a.Actual,
			map[bool]string{true: " @" + a.AppliesTo}[a.AppliesTo != ""], a.Note)
	}
}

// FormatAB prints OFF vs ON side by side.
func FormatAB(w io.Writer, off, on *Report) {
	fmt.Fprintf(w, "A/B  scenario %s  seed %d  schedule %s (identical: %t)\n\n",
		on.Scenario, on.Seed, on.ScheduleHash[:12], off.ScheduleHash == on.ScheduleHash)
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "TENANT\tROLE\tATTACK p99 OFF\tATTACK p99 ON\tINFL OFF\tINFL ON\tOK/SENT OFF\tOK/SENT ON\tREJ OFF\tREJ ON")
	for i, t := range on.Tenants {
		o := off.Tenants[i]
		a, b := o.Phases["attack"], t.Phases["attack"]
		fmt.Fprintf(tw, "%s\t%s\t%.0f ms\t%.0f ms\t%.2fx\t%.2fx\t%d/%d\t%d/%d\t%d\t%d\n",
			t.Tenant, t.Role, a.P99Ms, b.P99Ms, o.P99Inflation, t.P99Inflation, a.OK, a.Sent, b.OK, b.Sent, a.Rejected, b.Rejected)
	}
	tw.Flush()
	fmt.Fprintln(w)
	tw = tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "METRIC\tOFF\tON")
	keys := make([]string, 0, len(on.Metrics))
	for k := range on.Metrics {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		fmt.Fprintf(tw, "%s\t%.3g\t%.3g\n", k, off.Metrics[k], on.Metrics[k])
	}
	tw.Flush()
	fmt.Fprintln(w, "\nassertions (ON):")
	formatAssertions(w, on)
	fmt.Fprintf(w, "assertions (OFF, informational — expected to fail without isolation): %s\n", passSummary(off))
}

func passSummary(r *Report) string {
	var p []string
	for _, a := range r.Assertions {
		s := "pass"
		if !a.Pass {
			s = "fail"
		}
		p = append(p, a.Metric+"="+s)
	}
	return strings.Join(p, " ")
}

// AB runs OFF then ON with the same seed, sleeping `settle` between runs.
func AB(ctx context.Context, cfg RunConfig, settle time.Duration) (off, on *Report, err error) {
	cfg.Mode = "off"
	if off, err = Run(ctx, cfg); err != nil {
		return nil, nil, err
	}
	if settle > 0 {
		if err = cfg.Clock.SleepUntil(ctx, cfg.Clock.Now().Add(settle)); err != nil {
			return nil, nil, err
		}
	}
	cfg.Mode = "on"
	on, err = Run(ctx, cfg)
	return off, on, err
}
