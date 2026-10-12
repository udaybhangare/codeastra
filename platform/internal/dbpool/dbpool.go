// Package dbpool is the platform-owned proxy to the shared Postgres. Workers never connect
// directly: they call POST /internal/db and the proxy enforces a global connection cap, a
// per-tenant connection semaphore and a per-tier statement_timeout (docs/03 §3.5).
package dbpool

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/bulkhead/platform/internal/policy"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Kind is a named query the proxy is willing to run.
type Kind string

const (
	KindPoint  Kind = "point"  // fast single-row lookup
	KindReport Kind = "report" // heavy sort/aggregation
	KindSlow   Kind = "slow"   // pg_sleep(N)
	KindHog    Kind = "hog"    // holds its connection for N seconds inside a transaction
)

var (
	// ErrDBConns is returned when the tenant could not get a connection in time (reason DB_CONNS).
	ErrDBConns = errors.New("DB_CONNS: no database connection available")
	// ErrTimeout is returned when the statement exceeded its tier's statement_timeout.
	ErrTimeout = errors.New("DB_TIMEOUT: statement timeout")
	// ErrKind is returned for an unknown query kind.
	ErrKind = errors.New("unknown query kind")
)

// Request is one proxied query.
type Request struct {
	Tenant string
	Kind   Kind
	N      float64 // seconds for slow/hog, thousands of rows for report; 0 = default
}

// Result carries the per-tenant measurements recorded for every query.
type Result struct {
	DBMS       float64 `json:"db_ms"`
	ConnWaitMS float64 `json:"conn_wait_ms"`
}

// Config tunes the pool. Zero values get sensible defaults.
type Config struct {
	MaxConns       int32
	AcquireTimeout time.Duration                 // how long a query may wait for a connection
	Timeouts       map[policy.Tier]time.Duration // statement_timeout per tier
}

// DefaultTimeouts are the statement_timeout values per tier.
var DefaultTimeouts = map[policy.Tier]time.Duration{
	policy.TierFree: 2 * time.Second, policy.TierPro: 5 * time.Second, policy.TierEnterprise: 10 * time.Second,
}

// Pool is safe for concurrent use.
type Pool struct {
	pg      *pgxpool.Pool
	cfg     Config
	off     atomic.Bool
	mu      sync.Mutex
	sems    map[string]*sem
	stats   map[string]*tenantStats
	started func() time.Time

	// ConnCap, if set, returns a throttle-imposed connection cap for a tenant (0 = none).
	ConnCap func(tenant string) int
}

// New connects to Postgres. now is the injected clock used for timing.
func New(ctx context.Context, dsn string, cfg Config, now func() time.Time) (*Pool, error) {
	if cfg.MaxConns <= 0 {
		cfg.MaxConns = 20
	}
	if cfg.AcquireTimeout <= 0 {
		cfg.AcquireTimeout = 2 * time.Second
	}
	if cfg.Timeouts == nil {
		cfg.Timeouts = DefaultTimeouts
	}
	pc, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	pc.MaxConns = cfg.MaxConns
	pc.MinConns = 0
	pg, err := pgxpool.NewWithConfig(ctx, pc)
	if err != nil {
		return nil, err
	}
	return &Pool{pg: pg, cfg: cfg, sems: map[string]*sem{}, stats: map[string]*tenantStats{}, started: now}, nil
}

func (p *Pool) Close() { p.pg.Close() }

// SetIsolation toggles on/off. OFF = no per-tenant semaphore and no per-tenant timeout;
// everything contends for the global pool.
func (p *Pool) SetIsolation(on bool) { p.off.Store(!on) }

// Held returns how many connections the tenant currently holds (isolation ON accounting).
func (p *Pool) Held(tenant string) int { return p.tenantStats(tenant).heldNow() }

func (p *Pool) semFor(tenant string) *sem {
	p.mu.Lock()
	defer p.mu.Unlock()
	s, ok := p.sems[tenant]
	if !ok {
		s = &sem{}
		p.sems[tenant] = s
	}
	return s
}

// Do runs one query for a tenant under its policy.
func (p *Pool) Do(ctx context.Context, pol policy.Policy, r Request) (Result, error) {
	sql, args, err := build(r)
	if err != nil {
		return Result{}, err
	}
	st := p.tenantStats(r.Tenant)
	iso := !p.off.Load()

	wctx, cancel := context.WithTimeout(ctx, p.cfg.AcquireTimeout)
	defer cancel()
	t0 := p.started()

	if iso {
		limit := pol.DBConns
		if p.ConnCap != nil {
			if c := p.ConnCap(r.Tenant); c > 0 && c < limit {
				limit = c // throttle controller override (prompt 10)
			}
		}
		if err := p.semFor(r.Tenant).acquire(wctx, limit); err != nil {
			st.record(Result{ConnWaitMS: ms(p.started().Sub(t0))}, true)
			return Result{ConnWaitMS: ms(p.started().Sub(t0))}, ErrDBConns
		}
		defer p.semFor(r.Tenant).release()
	}
	conn, err := p.pg.Acquire(wctx)
	wait := ms(p.started().Sub(t0))
	if err != nil {
		st.record(Result{ConnWaitMS: wait}, true)
		return Result{ConnWaitMS: wait}, ErrDBConns
	}
	defer conn.Release()
	st.hold()
	defer st.unhold()

	t1 := p.started()
	res := Result{ConnWaitMS: wait}
	err = p.run(ctx, conn.Conn(), pol, r, iso, sql, args)
	res.DBMS = ms(p.started().Sub(t1))
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "57014" {
		err = ErrTimeout
	}
	st.record(res, false)
	return res, err
}

func (p *Pool) run(ctx context.Context, c *pgx.Conn, pol policy.Policy, r Request, iso bool, sql string, args []any) error {
	tx, err := c.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if _, err := tx.Exec(ctx, `SELECT set_config('application_name', $1, true)`, "tenant:"+r.Tenant); err != nil {
		return err
	}
	if iso {
		d := p.cfg.Timeouts[pol.Tier]
		if d > 0 {
			if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL statement_timeout = %d", d.Milliseconds())); err != nil {
				return err
			}
		}
	}
	rows, err := tx.Query(ctx, sql, args...)
	if err != nil {
		return err
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func build(r Request) (string, []any, error) {
	clamp := func(v, def, max float64) float64 {
		if v <= 0 {
			return def
		}
		if v > max {
			return max
		}
		return v
	}
	switch r.Kind {
	case KindPoint:
		return `SELECT 1`, nil, nil
	case KindReport:
		rows := int(clamp(r.N, 200, 2000) * 1000)
		return `SELECT count(*), max(m) FROM (SELECT md5(g::text) AS m FROM generate_series(1, $1::int) g ORDER BY 1) t`,
			[]any{rows}, nil
	case KindSlow:
		return `SELECT pg_sleep($1::float8)`, []any{clamp(r.N, 1, 30)}, nil
	case KindHog:
		return `SELECT pg_sleep($1::float8)`, []any{clamp(r.N, 5, 30)}, nil
	}
	return "", nil, fmt.Errorf("%w: %q", ErrKind, r.Kind)
}

func ms(d time.Duration) float64 { return float64(d) / float64(time.Millisecond) }
