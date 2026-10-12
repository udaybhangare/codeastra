// Command loadgen is the deterministic open-loop load generator and scenario
// runner (docs/09). Subcommands: list, schedule, run, ab.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/bulkhead/loadgen/internal/lg"
	"github.com/bulkhead/loadgen/scenarios"
)

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	var err error
	switch os.Args[1] {
	case "list":
		err = list()
	case "schedule":
		err = cmdSchedule(os.Args[2:])
	case "run":
		err = cmdRun(ctx, os.Args[2:], false)
	case "ab":
		err = cmdRun(ctx, os.Args[2:], true)
	case "serve":
		err = cmdServe(ctx)
	default:
		usage()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "loadgen:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `usage:
  loadgen list
  loadgen schedule <S1..S9|file.json> [--seed N] [--scale F]      print schedule hash/summary
  loadgen run <scenario> [--seed N] [--mode on|off] [flags]
  loadgen ab  <scenario> [--seed N] [flags]                       OFF then ON, same seed
  loadgen serve                                                   HTTP trigger: POST /run (env LISTEN, default :8089)
flags: --target URL (LOADGEN_TARGET) --keys file.json (LOADGEN_KEYS_FILE; {"tenant":"api-key"})
       --scale F (shrink phase durations) --out DIR --json --settle 5s
env:   LOADGEN_ADMIN_TOKEN | LOADGEN_ADMIN_KEY   (isolation toggle + run storage)`)
	os.Exit(2)
}

func loadScenario(ref string, scale, load float64) (*lg.Scenario, error) {
	var sc *lg.Scenario
	var err error
	if strings.HasSuffix(ref, ".json") {
		sc, err = lg.LoadScenarioFile(ref)
	} else {
		var b []byte
		if b, err = fs.ReadFile(scenarios.FS, strings.ToUpper(ref)+".json"); err == nil {
			sc, err = lg.ParseScenario(b)
		}
	}
	if err != nil {
		return nil, err
	}
	return sc.Scaled(scale).WithLoad(load), nil
}

func list() error {
	ents, _ := fs.ReadDir(scenarios.FS, ".")
	for _, e := range ents {
		if filepath.Ext(e.Name()) != ".json" {
			continue
		}
		b, _ := fs.ReadFile(scenarios.FS, e.Name())
		sc, err := lg.ParseScenario(b)
		if err != nil {
			return err
		}
		fmt.Printf("%-3s %-20s %s\n", sc.ID, sc.Name, sc.Description)
	}
	return nil
}

type common struct {
	fs                *flag.FlagSet
	seed              *int64
	scale, load       *float64
	heavy             *bool
	target, keys, out *string
	mode              *string
	asJSON            *bool
	settle            *time.Duration
	maxInflight       *int
}

func newFlags(name string) *common {
	f := flag.NewFlagSet(name, flag.ExitOnError)
	return &common{fs: f,
		seed:        f.Int64("seed", -1, "PRNG seed (default: scenario default_seed)"),
		scale:       f.Float64("scale", 1, "multiply phase durations (smoke runs)"),
		load:        f.Float64("load", 1, "multiply every arrival rate (e.g. 0.2 = 20% of the requests/s); task sizes unchanged"),
		heavy:       f.Bool("heavy", false, "allow full S9, which needs ~16 GB RAM / 60+ cores of demand (use S9-LITE on a laptop)"),
		target:      f.String("target", os.Getenv("LOADGEN_TARGET"), "platform base URL"),
		keys:        f.String("keys", os.Getenv("LOADGEN_KEYS_FILE"), "JSON map tenant -> API key"),
		out:         f.String("out", "runs", "directory for result JSON ('' to skip)"),
		mode:        f.String("mode", "", "isolation mode for run: on|off (default: leave as is)"),
		asJSON:      f.Bool("json", false, "print report JSON instead of tables"),
		settle:      f.Duration("settle", 5*time.Second, "pause between OFF and ON runs"),
		maxInflight: f.Int("max-inflight", 20000, "client concurrency cap (excess counted as dropped)"),
	}
}

// split lets the scenario positional arg come before or after flags.
func split(args []string) (string, []string) {
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		return args[0], args[1:]
	}
	return "", args
}

func cmdSchedule(args []string) error {
	ref, rest := split(args)
	c := newFlags("schedule")
	c.fs.Parse(rest)
	if ref == "" && c.fs.NArg() > 0 {
		ref = c.fs.Arg(0)
	}
	sc, err := loadScenario(ref, *c.scale, *c.load)
	if err != nil {
		return err
	}
	seed := *c.seed
	if seed < 0 {
		seed = sc.DefaultSeed
	}
	reqs := lg.BuildSchedule(sc, seed)
	per := map[string]int{}
	for _, r := range reqs {
		per[r.Tenant+"/"+r.Phase]++
	}
	keys := make([]string, 0, len(per))
	for k := range per {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	fmt.Printf("%s seed=%d requests=%d hash=%s\n", sc.Name, seed, len(reqs), lg.ScheduleHash(reqs))
	for _, k := range keys {
		fmt.Printf("  %-28s %d\n", k, per[k])
	}
	return nil
}

func cmdRun(ctx context.Context, args []string, ab bool) error {
	ref, rest := split(args)
	c := newFlags("run")
	c.fs.Parse(rest)
	if ref == "" && c.fs.NArg() > 0 {
		ref = c.fs.Arg(0)
	}
	if ref == "" || *c.target == "" || *c.keys == "" {
		usage()
	}
	if strings.EqualFold(strings.TrimSuffix(ref, ".json"), "S9") && !*c.heavy {
		return fmt.Errorf("S9 demands ~16 GB RAM and 60+ cores and can crash a laptop: run S9-LITE, or pass --heavy on the AWS box")
	}
	sc, err := loadScenario(ref, *c.scale, *c.load)
	if err != nil {
		return err
	}
	seed := *c.seed
	if seed < 0 {
		seed = sc.DefaultSeed
	}
	raw, err := os.ReadFile(*c.keys)
	if err != nil {
		return err
	}
	keys := map[string]string{}
	if err := json.Unmarshal(raw, &keys); err != nil {
		return fmt.Errorf("keys file: %w", err)
	}
	clock := lg.RealClock{}
	sender := lg.NewHTTPSender(*c.target, keys, clock)
	var names []string
	for _, t := range sc.Tenants {
		names = append(names, t.Tenant)
	}
	if err := sender.Warm(ctx, names); err != nil {
		return err
	}
	admin := lg.NewAdmin(*c.target, os.Getenv("LOADGEN_ADMIN_TOKEN"), os.Getenv("LOADGEN_ADMIN_KEY"))
	ec := lg.DefaultExecConfig()
	ec.MaxInflight = *c.maxInflight
	cfg := lg.RunConfig{Scenario: sc, Seed: seed, Sender: sender, Clock: clock, Exec: ec, Admin: admin, Mode: *c.mode,
		Progress: func(phase string, p lg.Progress) {
			if w := lg.WaveAt(sc, p.Elapsed); w != "" {
				phase += ":" + w
			}
			fmt.Fprintf(os.Stderr, "[%4.0fs %-34s] sent=%d ok=%d rej=%d err=%d drop=%d\n",
				p.Elapsed.Seconds(), phase, p.Sent, p.OK, p.Rejected, p.Errors, p.Dropped)
		}}

	var reports []*lg.Report
	var off, on *lg.Report
	if ab {
		if off, on, err = lg.AB(ctx, cfg, *c.settle); err != nil {
			return err
		}
		reports = []*lg.Report{off, on}
	} else {
		r, err := lg.Run(ctx, cfg)
		if err != nil {
			return err
		}
		reports = []*lg.Report{r}
	}
	for _, r := range reports {
		if *c.out != "" {
			_ = os.MkdirAll(*c.out, 0o755)
			p := filepath.Join(*c.out, fmt.Sprintf("%s-seed%d-%s.json", r.Scenario, r.Seed, r.Mode))
			b, _ := json.MarshalIndent(r, "", "  ")
			if err := os.WriteFile(p, b, 0o644); err != nil {
				return err
			}
			fmt.Fprintln(os.Stderr, "wrote", p)
		}
		if admin.Token != "" || admin.Key != "" {
			if err := admin.StoreRun(ctx, r); err != nil {
				fmt.Fprintln(os.Stderr, "note: run not stored server-side:", err)
			}
		}
	}
	switch {
	case *c.asJSON:
		json.NewEncoder(os.Stdout).Encode(reports)
	case ab:
		lg.FormatAB(os.Stdout, off, on)
	default:
		lg.FormatReport(os.Stdout, reports[0])
	}
	if !reports[len(reports)-1].Pass {
		os.Exit(3)
	}
	return nil
}
