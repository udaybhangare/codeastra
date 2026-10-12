package usage

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PGStore keeps the ledger in Postgres (usage_ledger, usage_ledger_task).
type PGStore struct{ Pool *pgxpool.Pool }

const upsertTask = `
INSERT INTO usage_ledger_task (tenant_id, window_start, task, req, ok, rejected, cpu_ms, mem_mb_ms, db_ms, bytes, cost_units)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
ON CONFLICT (tenant_id, window_start, task) DO UPDATE SET
  req=EXCLUDED.req, ok=EXCLUDED.ok, rejected=EXCLUDED.rejected, cpu_ms=EXCLUDED.cpu_ms,
  mem_mb_ms=EXCLUDED.mem_mb_ms, db_ms=EXCLUDED.db_ms, bytes=EXCLUDED.bytes, cost_units=EXCLUDED.cost_units`

const upsertWindow = `
INSERT INTO usage_ledger (tenant_id, window_start, req, ok, rejected, cpu_ms, mem_mb_s, db_ms, bytes, cost_units, p99_ms)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
ON CONFLICT (tenant_id, window_start) DO UPDATE SET
  req=EXCLUDED.req, ok=EXCLUDED.ok, rejected=EXCLUDED.rejected, cpu_ms=EXCLUDED.cpu_ms,
  mem_mb_s=EXCLUDED.mem_mb_s, db_ms=EXCLUDED.db_ms, bytes=EXCLUDED.bytes,
  cost_units=EXCLUDED.cost_units, p99_ms=EXCLUDED.p99_ms`

// Write upserts all rows in one batch. Rows for tenants missing from `tenants`
// (foreign-key violation) are skipped so one bad tenant can't wedge the ledger.
func (s PGStore) Write(ctx context.Context, rows []Row, wins []WindowRow) error {
	b := &pgx.Batch{}
	for _, r := range rows {
		b.Queue(upsertTask, r.Tenant, r.Window, r.Task, r.Req, r.OK, r.Rejected, r.CPUms, r.MemMBms, r.DBms, r.Bytes, r.CostUnits)
	}
	for _, w := range wins {
		b.Queue(upsertWindow, w.Tenant, w.Window, w.Req, w.OK, w.Rejected, w.CPUms, w.MemMBms/1000, w.DBms, w.Bytes, w.CostUnits, w.P99ms)
	}
	br := s.Pool.SendBatch(ctx, b)
	defer br.Close()
	for i := 0; i < b.Len(); i++ {
		if _, err := br.Exec(); err != nil {
			var pe *pgconn.PgError
			if errors.As(err, &pe) && pe.Code == "23503" {
				continue
			}
			return err
		}
	}
	return nil
}

func (s PGStore) Rows(ctx context.Context, tenant string, from, to time.Time) ([]Row, error) {
	const q = `
SELECT tenant_id, window_start, task, req, ok, rejected, cpu_ms, mem_mb_ms, db_ms, bytes, cost_units
FROM usage_ledger_task
WHERE window_start >= $1 AND window_start < $2 AND ($3 = '' OR tenant_id = $3)
ORDER BY window_start, tenant_id, task`
	rs, err := s.Pool.Query(ctx, q, from, to, tenant)
	if err != nil {
		return nil, err
	}
	defer rs.Close()
	var out []Row
	for rs.Next() {
		var r Row
		if err := rs.Scan(&r.Tenant, &r.Window, &r.Task, &r.Req, &r.OK, &r.Rejected,
			&r.CPUms, &r.MemMBms, &r.DBms, &r.Bytes, &r.CostUnits); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rs.Err()
}
