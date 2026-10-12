package gateway

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"
)

type AuditEntry struct {
	Actor, Action, Target string
	Detail                map[string]any
}

type Auditor interface {
	Record(ctx context.Context, e AuditEntry) error
}

type PGAuditor struct{ Pool *pgxpool.Pool }

func (a PGAuditor) Record(ctx context.Context, e AuditEntry) error {
	d, err := json.Marshal(e.Detail)
	if err != nil || e.Detail == nil {
		d = []byte("{}")
	}
	_, err = a.Pool.Exec(ctx, `INSERT INTO audit_log (actor, action, target, detail) VALUES ($1,$2,$3,$4)`,
		e.Actor, e.Action, e.Target, d)
	return err
}

// MemAuditor keeps entries in memory (tests).
type MemAuditor struct {
	mu      sync.Mutex
	Entries []AuditEntry
}

func (m *MemAuditor) Record(_ context.Context, e AuditEntry) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Entries = append(m.Entries, e)
	return nil
}
