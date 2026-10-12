package policy

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bulkhead/platform/migrations"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
)

func TestPresetsAreValid(t *testing.T) {
	for _, tier := range []Tier{TierFree, TierPro, TierEnterprise} {
		p, ok := Preset(tier)
		if !ok {
			t.Fatalf("no preset for %s", tier)
		}
		p.TenantID = "x"
		if err := p.Validate(); err != nil {
			t.Errorf("%s preset invalid: %v", tier, err)
		}
	}
}

func TestValidateRejects(t *testing.T) {
	base, _ := Preset(TierPro)
	base.TenantID = "x"
	cases := map[string]func(p *Policy){
		"reserve_cpu": func(p *Policy) { p.ReserveCPU = p.LimitCPU + 1 },
		"tier":        func(p *Policy) { p.Tier = "gold" },
		"weight":      func(p *Policy) { p.Weight = 0 },
		"rps":         func(p *Policy) { p.RPS = 0 },
		"tenant_id":   func(p *Policy) { p.TenantID = "" },
		"db_conns":    func(p *Policy) { p.DBConns = 0 },
	}
	for want, mutate := range cases {
		p := base
		mutate(&p)
		err := p.Validate()
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: want error mentioning it, got %v", want, err)
		}
	}
}

func dsn() string {
	if v := os.Getenv("DATABASE_URL"); v != "" {
		return v
	}
	return "postgres://bulkhead:bulkhead@localhost:5432/bulkhead?sslmode=disable"
}

// Needs the dev Postgres (`make dev`); skipped when unreachable.
func TestCacheLiveReload(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn())
	if err != nil {
		t.Skip(err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		t.Skip("postgres unavailable:", err)
	}
	if err := migrations.Up(ctx, stdlib.OpenDBFromPool(pool)); err != nil {
		t.Fatal(err)
	}
	const id = "test-policy-tenant"
	cleanup := func() {
		pool.Exec(ctx, `DELETE FROM policies WHERE tenant_id=$1`, id)
		pool.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, id)
	}
	cleanup()
	defer cleanup()
	if _, err := pool.Exec(ctx, `INSERT INTO tenants (id,name,tier) VALUES ($1,'t','free')`, id); err != nil {
		t.Fatal(err)
	}

	store := NewPGStore(pool)
	cache := NewCache(store, PGNotifier{DSN: dsn()})
	go cache.Run(ctx)

	p, _ := Preset(TierFree)
	p.TenantID = id
	waitFor := func(desc string, cond func() bool) {
		t.Helper()
		deadline := time.Now().Add(time.Second)
		for time.Now().Before(deadline) {
			if cond() {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatalf("cache did not reflect %s within 1s", desc)
	}

	time.Sleep(200 * time.Millisecond) // let LISTEN attach
	if err := store.Put(ctx, p); err != nil {
		t.Fatal(err)
	}
	waitFor("insert", func() bool { _, ok := cache.Get(id); return ok })

	p.RPS = 77
	if err := store.Put(ctx, p); err != nil {
		t.Fatal(err)
	}
	waitFor("update", func() bool { got, _ := cache.Get(id); return got.RPS == 77 })

	// Invalid policy: rejected, nothing written, cache unchanged.
	bad := p
	bad.ReserveCPU = bad.LimitCPU + 1
	if err := store.Put(ctx, bad); err == nil {
		t.Fatal("invalid policy accepted")
	}
	// Even bypassing Go validation, the DB CHECK constraint rejects it.
	if _, err := pool.Exec(ctx, `UPDATE policies SET reserve_cpu=limit_cpu+1 WHERE tenant_id=$1`, id); err == nil {
		t.Fatal("DB accepted reserve > limit")
	}
	if got, _ := cache.Get(id); got.RPS != 77 {
		t.Fatalf("cache changed after rejected write: %+v", got)
	}
}
