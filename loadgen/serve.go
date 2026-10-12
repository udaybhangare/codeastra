package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"sync"
	"time"

	"github.com/bulkhead/loadgen/internal/lg"
)

var runIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// cmdServe exposes POST /run so the platform can trigger scenarios from the
// dashboard. One run at a time; results are reported back via /admin/runs.
// Env: LISTEN (default :8089), LOADGEN_TARGET, LOADGEN_KEYS_FILE, LOADGEN_ADMIN_*.
func cmdServe(ctx context.Context) error {
	target, keysFile := os.Getenv("LOADGEN_TARGET"), os.Getenv("LOADGEN_KEYS_FILE")
	if target == "" || keysFile == "" {
		return fmt.Errorf("serve needs LOADGEN_TARGET and LOADGEN_KEYS_FILE")
	}
	listen := os.Getenv("LISTEN")
	if listen == "" {
		listen = ":8089"
	}
	var mu sync.Mutex
	busy := ""

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	mux.HandleFunc("POST /run", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			RunID    string `json:"run_id"`
			Scenario string `json:"scenario"`
			Seed     int64  `json:"seed"`
			Duration int    `json:"duration"` // total seconds; 0 = scenario default
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil ||
			!runIDRe.MatchString(body.RunID) || body.Duration < 0 {
			http.Error(w, "bad request", 400)
			return
		}
		sc, err := loadScenario(body.Scenario, 1, 1)
		if err != nil {
			http.Error(w, "unknown scenario", 404)
			return
		}
		if sc.ID == "S9" {
			http.Error(w, "S9 is heavy; use the CLI with --heavy (or S9-LITE)", 400)
			return
		}
		scale := 1.0
		if body.Duration > 0 {
			scale = float64(body.Duration) / sc.Total().Seconds()
			sc = sc.Scaled(scale)
		}
		seed := body.Seed
		if seed <= 0 {
			seed = sc.DefaultSeed
		}
		mu.Lock()
		if busy != "" {
			mu.Unlock()
			http.Error(w, "busy with run "+busy, 409)
			return
		}
		busy = body.RunID
		mu.Unlock()
		go func() {
			defer func() { mu.Lock(); busy = ""; mu.Unlock() }()
			execRun(ctx, body.RunID, sc, seed, target, keysFile)
		}()
		w.WriteHeader(http.StatusAccepted)
	})
	srv := &http.Server{Addr: listen, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() { <-ctx.Done(); srv.Close() }()
	log.Printf("loadgen serving on %s -> %s", listen, target)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		return err
	}
	return nil
}

func execRun(ctx context.Context, runID string, sc *lg.Scenario, seed int64, target, keysFile string) {
	admin := lg.NewAdmin(target, os.Getenv("LOADGEN_ADMIN_TOKEN"), os.Getenv("LOADGEN_ADMIN_KEY"))
	fail := func(err error) {
		log.Printf("run %s failed: %v", runID, err)
		if e := admin.FailRun(context.Background(), runID, err.Error(), time.Now().UTC()); e != nil {
			log.Printf("run %s: could not report failure: %v", runID, e)
		}
	}
	raw, err := os.ReadFile(keysFile)
	if err != nil {
		fail(err)
		return
	}
	keys := map[string]string{}
	if err := json.Unmarshal(raw, &keys); err != nil {
		fail(fmt.Errorf("keys file: %w", err))
		return
	}
	clock := lg.RealClock{}
	sender := lg.NewHTTPSender(target, keys, clock)
	var names []string
	for _, t := range sc.Tenants {
		names = append(names, t.Tenant)
	}
	if err := sender.Warm(ctx, names); err != nil {
		fail(err)
		return
	}
	total := sc.Total()
	var last time.Time
	cfg := lg.RunConfig{Scenario: sc, Seed: seed, Sender: sender, Clock: clock, Exec: lg.DefaultExecConfig(), Admin: admin,
		Progress: func(phase string, p lg.Progress) {
			if time.Since(last) < 2*time.Second {
				return
			}
			last = time.Now()
			admin.Progress(ctx, runID, phase, p.Elapsed, total)
		}}
	rep, err := lg.Run(ctx, cfg)
	if err != nil {
		fail(err)
		return
	}
	if err := admin.FinishRun(context.Background(), runID, rep); err != nil {
		log.Printf("run %s: could not report result: %v", runID, err)
	}
}
