// Command bulkheadd is the Bulkhead platform binary. Prompt 02: gateway + auth only.
package main

import (
	"context"
	"errors"
	"github.com/bulkhead/platform/internal/admission"
	"github.com/bulkhead/platform/internal/cost"
	"github.com/bulkhead/platform/internal/dbpool"
	"github.com/bulkhead/platform/internal/detector"
	"github.com/bulkhead/platform/internal/dispatcher"
	"github.com/bulkhead/platform/internal/metrics"
	"github.com/bulkhead/platform/internal/ratelimit"
	"github.com/bulkhead/platform/internal/scheduler"
	"github.com/bulkhead/platform/internal/throttle"
	"github.com/bulkhead/platform/internal/usage"
	"github.com/bulkhead/platform/internal/workerpool"
	"github.com/redis/go-redis/v9"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"strconv"
	"syscall"
	"time"

	"github.com/bulkhead/platform/internal/auth"
	"github.com/bulkhead/platform/internal/gateway"
	"github.com/bulkhead/platform/internal/policy"
	"github.com/jackc/pgx/v5/pgxpool"
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	if n, err := strconv.Atoi(os.Getenv(k)); err == nil && n > 0 {
		return n
	}
	return def
}

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	jwtSecret := os.Getenv("JWT_SECRET")
	adminSecret := os.Getenv("ADMIN_JWT_SECRET")
	adminKey := os.Getenv("ADMIN_API_KEY")
	if len(jwtSecret) < 16 || len(adminSecret) < 16 || len(adminKey) < 16 {
		return errors.New("JWT_SECRET, ADMIN_JWT_SECRET and ADMIN_API_KEY must each be set (>=16 chars)")
	}
	if jwtSecret == adminSecret {
		return errors.New("JWT_SECRET and ADMIN_JWT_SECRET must differ")
	}

	dsn := env("DATABASE_URL", "postgres://bulkhead:bulkhead@localhost:5432/bulkhead?sslmode=disable")
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return err
	}
	defer pool.Close()

	cache := policy.NewCache(policy.NewPGStore(pool), policy.PGNotifier{DSN: dsn})
	go func() { _ = cache.Run(ctx) }()

	now := time.Now // the single place the wall clock is injected

	var limiter ratelimit.Limiter = ratelimit.NewMemory(now)
	if u := os.Getenv("REDIS_URL"); u != "" {
		opt, err := redis.ParseURL(u)
		if err != nil {
			return err
		}
		limiter = ratelimit.NewRedis(redis.NewClient(opt), now, log)
	}
	est := cost.NewEstimator(cost.DefaultWeights)
	adm := admission.New(cache, limiter, est)
	isoOn := env("ISOLATION", "on") != "off"
	adm.SetIsolation(isoOn)

	workerSecret := env("WORKER_SECRET", jwtSecret)
	dbp, err := dbpool.New(ctx, dsn, dbpool.Config{MaxConns: int32(envInt("DB_PROXY_MAX_CONNS", 20))}, now)
	if err != nil {
		return err
	}
	defer dbp.Close()
	dbp.SetIsolation(isoOn)

	wp, err := workerpool.New(workerpool.Config{Isolation: isoOn, Log: log,
		Env: []string{"DB_PROXY_URL=" + env("DB_PROXY_URL", "http://bulkheadd:8080/internal/db")},
		TenantEnv: func(t string) []string {
			return []string{"DB_PROXY_SECRET=" + dbpool.WorkerSecret(workerSecret, t)}
		},
		AttachContainer: os.Getenv("ATTACH_CONTAINER")})
	if err != nil {
		return err
	}
	sw := scheduler.NewSwitch(scheduler.DRRConfig{}, 10000)
	cores := float64(runtime.NumCPU())
	agg := metrics.New(metrics.Config{
		Now: now, Cores: cores,
		Entitlement: func(t string) float64 {
			if p, ok := cache.Get(t); ok {
				return p.ReserveCPU
			}
			return 0
		},
		Sampler: &metrics.HostSampler{Now: now, Containers: wp},
	})
	go agg.Run(ctx)

	// Throttle ladder: detector findings → controller → actuators (docs/06 step 3).
	limits := throttle.NewLimits()
	hub := throttle.NewHub()
	adm.Scale = limits
	dbp.ConnCap = limits.ConnCap
	ctl := throttle.New(throttle.Config{PredictiveEnabled: env("PREDICTIVE_THROTTLE", "off") == "on"}, throttle.Deps{
		Policy: cache.Get, List: cache.Snapshot,
		Publisher: hub,
		Act:       throttle.Actuators{Scheduler: sw, Buckets: limits, Cgroup: wp, DB: limits},
		Store:     throttle.PGStore{Pool: pool},
		Now:       now, Log: log,
	})
	snaps := make(chan metrics.Snapshot, 8)
	agg.SubscribeSnapshots(snaps)
	det := &detector.Runner{D: detector.New(detector.Config{}), Enabled: adm.IsolationOn,
		Emit: func(at time.Time, f []detector.Finding) { ctl.Observe(at, f) }}
	go det.Run(ctx, snaps)
	ledger := usage.NewWriter(usage.PGStore{Pool: pool}, now, log)
	agg.Subscribe(ledger.WindowSink())
	go ledger.Run(ctx)
	record := func(ev metrics.Event) { // one event → live metrics + usage ledger
		agg.Record(ev)
		ledger.Record(ev)
	}
	disp := dispatcher.New(dispatcher.Config{Now: now, OnComplete: func(c dispatcher.Completion) {
		status := c.Result.Status
		if status == 0 && c.Err != nil {
			status = 500
		}
		// MemPeakMB is expressed so that MemPeakMB × Exec(ms) == the cost vector's MB·ms.
		var memPeak float64
		if ems := float64(c.Result.Exec.Milliseconds()); ems > 0 {
			memPeak = c.Result.Vector.MemMBms / ems
		}
		record(metrics.Event{
			Tenant: c.Tenant, Task: c.Task, Status: status,
			QueueWait: c.Result.QueueWait, Exec: c.Result.Exec, Total: c.Result.QueueWait + c.Result.Exec,
			CPUms: c.Result.Vector.CPUms, DBms: c.Result.Vector.DBms, Bytes: int64(c.Result.Vector.Bytes),
			MemPeakMB: memPeak, Cost: c.Result.Cost,
		})
	}}, sw, wp, cache, est)
	if !isoOn {
		disp.SetIsolation(false)
	}
	adm.Queue = disp
	go disp.Run(ctx)
	if err := wp.Start(ctx); err != nil {
		log.Warn("worker pool events unavailable (is Docker running?)", "err", err)
	}
	go reconcileWorkers(ctx, log, wp, cache)
	srv := gateway.New(gateway.Deps{
		TenantSigner: auth.NewSigner(jwtSecret, now),
		AdminSigner:  auth.NewSigner(adminSecret, now),
		Auth:         &auth.Authenticator{Store: auth.PGKeyStore{Pool: pool}},
		Revoked:      auth.NewRevocations(now),
		Policies:     cache,
		Admit:        adm,
		Dispatch:     disp,
		Audit:        gateway.PGAuditor{Pool: pool},
		OnReject:     record,
		Throttle:     ctl,
		Events:       throttle.PGStore{Pool: pool},
		Hub:          hub,
		Now:          now,
		Usage: &usage.Reporter{Store: usage.PGStore{Pool: pool}, Card: usage.DefaultRateCard(),
			Weights: est.W, Tier: func(id string) string {
				p, _ := cache.Get(id)
				return string(p.Tier)
			}},
		AdminKey: adminKey,
		Log:      log,
	})

	root := http.NewServeMux()
	root.Handle("GET /metrics", agg.Handler())
	root.Handle("POST /internal/db", dbpool.Handler(dbp, cache, workerSecret))
	root.Handle("/", srv.Handler())
	hs := &http.Server{Addr: env("HTTP_ADDR", ":8080"), Handler: root,
		ReadHeaderTimeout: 5 * time.Second}
	errc := make(chan error, 1)
	go func() { errc <- hs.ListenAndServe() }()
	log.Info("listening", "addr", hs.Addr)

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	log.Info("shutting down")
	sctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return hs.Shutdown(sctx)
}

// reconcileWorkers makes sure every tenant in the policy snapshot has a worker
// container sized to its policy, re-applying limits live when the policy changes.
func reconcileWorkers(ctx context.Context, log *slog.Logger, wp *workerpool.Pool, c *policy.Cache) {
	const pidsLimit = 256
	applied := map[string]time.Time{}
	t := time.NewTicker(3 * time.Second)
	defer t.Stop()
	for {
		for id, p := range c.Snapshot() {
			if at, ok := applied[id]; ok && at.Equal(p.UpdatedAt) {
				continue
			}
			ectx, cancel := context.WithTimeout(ctx, 30*time.Second)
			err := wp.Ensure(ectx, workerpool.SpecFromPolicy(p, pidsLimit))
			cancel()
			if err != nil {
				log.Warn("ensure worker", "tenant", id, "err", err)
				continue
			}
			applied[id] = p.UpdatedAt
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
