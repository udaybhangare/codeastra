package throttle

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PGStore writes events to the throttle_events table (migration 00001).
type PGStore struct{ Pool *pgxpool.Pool }

func (s PGStore) Insert(ctx context.Context, e Event) error {
	ev := e.Evidence
	evidence, err := json.Marshal(struct {
		Evidence
		Explanation string `json:"explanation"`
	}{ev, e.Explanation})
	if err != nil {
		return err
	}
	actions, err := json.Marshal(e.Actions)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `INSERT INTO throttle_events
		(ts, tenant_id, from_level, to_level, reason, evidence, actions, actor)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		e.TS, e.Tenant, int16(e.From), int16(e.To), e.Reason, evidence, actions, e.Actor)
	return err
}

// Row is a stored throttle_events row (contract ThrottleEvent).
type Row struct {
	ID       int64           `json:"id"`
	TS       time.Time       `json:"ts"`
	Tenant   string          `json:"tenant_id"`
	From     int             `json:"from_level"`
	To       int             `json:"to_level"`
	Reason   string          `json:"reason"`
	Evidence json.RawMessage `json:"evidence"`
	Actions  json.RawMessage `json:"actions"`
	Actor    string          `json:"actor"`
}

// List returns events newer than since, newest first (limit ≤ 1000).
func (s PGStore) List(ctx context.Context, since time.Time, limit int) ([]Row, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	rows, err := s.Pool.Query(ctx, `SELECT id, ts, tenant_id, from_level, to_level, reason, evidence, actions, actor
		FROM throttle_events WHERE ts > $1 ORDER BY ts DESC, id DESC LIMIT $2`, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Row{}
	for rows.Next() {
		var r Row
		var f, t int16
		if err := rows.Scan(&r.ID, &r.TS, &r.Tenant, &f, &t, &r.Reason, &r.Evidence, &r.Actions, &r.Actor); err != nil {
			return nil, err
		}
		r.From, r.To = int(f), int(t)
		out = append(out, r)
	}
	return out, rows.Err()
}
