package policy

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const cols = `tenant_id, tier, weight, reserve_cpu, limit_cpu, limit_mem_mb, rps, burst,
	cost_per_s, concurrency, queue_depth, db_conns, bandwidth_bps, updated_at`

// PGStore is the Postgres-backed Store.
type PGStore struct{ pool *pgxpool.Pool }

func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

func scan(row pgx.Row) (Policy, error) {
	var p Policy
	var tier string
	err := row.Scan(&p.TenantID, &tier, &p.Weight, &p.ReserveCPU, &p.LimitCPU, &p.LimitMemMB,
		&p.RPS, &p.Burst, &p.CostPerS, &p.Concurrency, &p.QueueDepth, &p.DBConns,
		&p.BandwidthBps, &p.UpdatedAt)
	p.Tier = Tier(tier)
	return p, err
}

func (s *PGStore) List(ctx context.Context) ([]Policy, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+cols+` FROM policies ORDER BY tenant_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Policy
	for rows.Next() {
		p, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *PGStore) Get(ctx context.Context, tenantID string) (Policy, error) {
	p, err := scan(s.pool.QueryRow(ctx, `SELECT `+cols+` FROM policies WHERE tenant_id=$1`, tenantID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Policy{}, ErrNotFound
	}
	return p, err
}

func (s *PGStore) Put(ctx context.Context, p Policy) error {
	if err := p.Validate(); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO policies (tenant_id, tier, weight, reserve_cpu, limit_cpu, limit_mem_mb, rps,
			burst, cost_per_s, concurrency, queue_depth, db_conns, bandwidth_bps)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT (tenant_id) DO UPDATE SET
			tier=EXCLUDED.tier, weight=EXCLUDED.weight, reserve_cpu=EXCLUDED.reserve_cpu,
			limit_cpu=EXCLUDED.limit_cpu, limit_mem_mb=EXCLUDED.limit_mem_mb, rps=EXCLUDED.rps,
			burst=EXCLUDED.burst, cost_per_s=EXCLUDED.cost_per_s, concurrency=EXCLUDED.concurrency,
			queue_depth=EXCLUDED.queue_depth, db_conns=EXCLUDED.db_conns,
			bandwidth_bps=EXCLUDED.bandwidth_bps, updated_at=now()`,
		p.TenantID, string(p.Tier), p.Weight, p.ReserveCPU, p.LimitCPU, p.LimitMemMB, p.RPS,
		p.Burst, p.CostPerS, p.Concurrency, p.QueueDepth, p.DBConns, p.BandwidthBps)
	return err
}
