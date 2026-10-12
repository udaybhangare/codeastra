// Package policy holds per-tenant quotas: validation, tier presets, a Postgres
// store and an in-memory snapshot cache that is the only thing the hot path reads.
package policy

import (
	"context"
	"errors"
	"fmt"
	"time"
)

type Tier string

const (
	TierFree       Tier = "free"
	TierPro        Tier = "pro"
	TierEnterprise Tier = "enterprise"
)

// Policy mirrors a row of the `policies` table (docs/04).
type Policy struct {
	TenantID     string    `json:"tenant_id"`
	Tier         Tier      `json:"tier"`
	Weight       int       `json:"weight"`        // DRR weight (relative share under contention)
	ReserveCPU   float64   `json:"reserve_cpu"`   // guaranteed cores
	LimitCPU     float64   `json:"limit_cpu"`     // hard ceiling, cores
	LimitMemMB   int       `json:"limit_mem_mb"`  // cgroup memory.max
	RPS          float64   `json:"rps"`           // token-bucket refill rate
	Burst        int       `json:"burst"`         // token-bucket capacity
	CostPerS     float64   `json:"cost_per_s"`    // cost units/s budget
	Concurrency  int       `json:"concurrency"`   // max in-flight
	QueueDepth   int       `json:"queue_depth"`   // max queued
	DBConns      int       `json:"db_conns"`      // max DB connections
	BandwidthBps int64     `json:"bandwidth_bps"` // egress cap
	UpdatedAt    time.Time `json:"updated_at"`
}

// Validate returns a joined error listing every violated rule.
func (p Policy) Validate() error {
	var errs []error
	bad := func(format string, a ...any) { errs = append(errs, fmt.Errorf(format, a...)) }

	if p.TenantID == "" {
		bad("tenant_id is required")
	}
	switch p.Tier {
	case TierFree, TierPro, TierEnterprise:
	default:
		bad("tier %q must be free, pro or enterprise", p.Tier)
	}
	if p.Weight <= 0 {
		bad("weight must be > 0")
	}
	if p.ReserveCPU < 0 {
		bad("reserve_cpu must be >= 0")
	}
	if p.LimitCPU <= 0 {
		bad("limit_cpu must be > 0")
	}
	if p.ReserveCPU > p.LimitCPU {
		bad("reserve_cpu (%g) must be <= limit_cpu (%g)", p.ReserveCPU, p.LimitCPU)
	}
	if p.LimitMemMB <= 0 {
		bad("limit_mem_mb must be > 0")
	}
	if p.RPS <= 0 {
		bad("rps must be > 0")
	}
	if p.Burst < 1 {
		bad("burst must be >= 1")
	}
	if p.CostPerS <= 0 {
		bad("cost_per_s must be > 0")
	}
	if p.Concurrency < 1 {
		bad("concurrency must be >= 1")
	}
	if p.QueueDepth < 0 {
		bad("queue_depth must be >= 0")
	}
	if p.DBConns < 1 {
		bad("db_conns must be >= 1")
	}
	if p.BandwidthBps <= 0 {
		bad("bandwidth_bps must be > 0")
	}
	return errors.Join(errs...)
}

// Preset returns the default policy for a tier (tenant_id left empty).
func Preset(t Tier) (Policy, bool) {
	switch t {
	case TierFree:
		return Policy{Tier: t, Weight: 1, ReserveCPU: 0.1, LimitCPU: 0.5, LimitMemMB: 256,
			RPS: 10, Burst: 20, CostPerS: 50, Concurrency: 4, QueueDepth: 50, DBConns: 2,
			BandwidthBps: 1 << 20}, true
	case TierPro:
		return Policy{Tier: t, Weight: 4, ReserveCPU: 0.5, LimitCPU: 1.5, LimitMemMB: 1024,
			RPS: 50, Burst: 100, CostPerS: 300, Concurrency: 16, QueueDepth: 200, DBConns: 8,
			BandwidthBps: 8 << 20}, true
	case TierEnterprise:
		return Policy{Tier: t, Weight: 10, ReserveCPU: 1.0, LimitCPU: 3.0, LimitMemMB: 2048,
			RPS: 150, Burst: 300, CostPerS: 1000, Concurrency: 32, QueueDepth: 500, DBConns: 20,
			BandwidthBps: 32 << 20}, true
	}
	return Policy{}, false
}

// Store is the persistence side of policies. Never call it on the request hot path;
// use Cache.
type Store interface {
	List(ctx context.Context) ([]Policy, error)
	Get(ctx context.Context, tenantID string) (Policy, error)
	// Put validates, then upserts. Invalid policies return a validation error and write nothing.
	Put(ctx context.Context, p Policy) error
}

var ErrNotFound = errors.New("policy not found")
