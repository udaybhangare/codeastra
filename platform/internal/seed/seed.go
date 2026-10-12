// Package seed loads demo tenants, API keys, tier policies and the demo.events table.
// Every step is idempotent.
package seed

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"

	"github.com/bulkhead/platform/internal/policy"
	"github.com/jackc/pgx/v5/pgxpool"
)

const EventRows = 2_000_000

type Tenant struct {
	ID, Name string
	Tier     policy.Tier
}

var Tenants = []Tenant{
	{"acme-shop", "Acme Shop", policy.TierPro},
	{"data-co", "Data Co", policy.TierEnterprise},
	{"bursty-news", "Bursty News", policy.TierFree},
	{"rogue-ml", "Rogue ML", policy.TierFree},
	{"leaky-app", "Leaky App", policy.TierPro},
	// One culprit per resource, used by S10-MARATHON so each climbs the
	// ladder for its own reason (CPU / DB / queue / bandwidth).
	{"cpu-hog", "CPU Hog", policy.TierFree},
	{"db-hog", "DB Hog", policy.TierFree},
	{"queue-storm", "Queue Storm", policy.TierFree},
	{"bw-hog", "Bandwidth Hog", policy.TierFree},
}

// HashKey is how API keys are stored (sha256 hex). Keys are high-entropy random, so a
// fast hash is fine.
func HashKey(key string) string {
	h := sha256.Sum256([]byte(key))
	return hex.EncodeToString(h[:])
}

// Run seeds the database. New API keys (only for tenants without an active key) are
// written to out exactly once; they are not recoverable afterwards.
func Run(ctx context.Context, pool *pgxpool.Pool, out io.Writer) error {
	store := policy.NewPGStore(pool)
	for _, t := range Tenants {
		if _, err := pool.Exec(ctx, `INSERT INTO tenants (id, name, tier) VALUES ($1,$2,$3)
			ON CONFLICT (id) DO NOTHING`, t.ID, t.Name, string(t.Tier)); err != nil {
			return err
		}
		// Keep live-edited policies: only create the preset when none exists.
		if _, err := store.Get(ctx, t.ID); err == policy.ErrNotFound {
			p, _ := policy.Preset(t.Tier)
			p.TenantID = t.ID
			if err := store.Put(ctx, p); err != nil {
				return err
			}
		} else if err != nil {
			return err
		}

		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM api_keys WHERE tenant_id=$1 AND revoked_at IS NULL`,
			t.ID).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			continue
		}
		b := make([]byte, 24)
		if _, err := rand.Read(b); err != nil {
			return err
		}
		key := "bk_" + hex.EncodeToString(b)
		if _, err := pool.Exec(ctx, `INSERT INTO api_keys (tenant_id, key_hash, prefix) VALUES ($1,$2,$3)`,
			t.ID, HashKey(key), key[:8]); err != nil {
			return err
		}
		fmt.Fprintf(out, "API key for %-12s %s   (shown once, save it now)\n", t.ID, key)
	}
	return seedEvents(ctx, pool, out)
}

func seedEvents(ctx context.Context, pool *pgxpool.Pool, out io.Writer) error {
	var n int64
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM demo.events`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	fmt.Fprintf(out, "loading %d rows into demo.events (a few seconds)...\n", EventRows)
	// Deterministic: derived from the row number only, spread over 30 days, 5 tenants.
	_, err := pool.Exec(ctx, `
		INSERT INTO demo.events (tenant_id, user_id, kind, payload, created_at)
		SELECT (ARRAY['acme-shop','data-co','bursty-news','rogue-ml','leaky-app'])[1 + (g % 5)],
		       ((g::bigint * 7919) % 50000)::int,
		       (ARRAY['view','click','purchase','login','export'])[1 + (g % 5)],
		       md5(g::text) || md5((g::bigint * 31)::text),
		       timestamptz '2026-01-01 00:00:00+00' + (g % 2592000) * interval '1 second'
		FROM generate_series(1, $1::int) AS g`, EventRows)
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `ANALYZE demo.events`)
	return err
}
