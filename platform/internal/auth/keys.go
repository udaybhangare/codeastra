package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrBadKey = errors.New("invalid api key")

const prefixLen = 8

// KeyRecord is what the store knows about a stored key (never the raw key).
type KeyRecord struct {
	TenantID  string
	Tier      string
	KeyHash   string // sha256 hex of the raw key
	Revoked   bool
	Suspended bool
}

type KeyStore interface {
	// ByPrefix returns all stored keys sharing the prefix (revoked ones included).
	ByPrefix(ctx context.Context, prefix string) ([]KeyRecord, error)
}

// HashKey is how keys are stored. Keys are 192-bit random, so a fast hash is adequate.
func HashKey(key string) string {
	h := sha256.Sum256([]byte(key))
	return hex.EncodeToString(h[:])
}

// Identity is the result of a successful key exchange.
type Identity struct{ TenantID, Tier string }

type Authenticator struct{ Store KeyStore }

// Exchange validates a raw API key: prefix lookup, then constant-time hash compare.
// Every failure returns ErrBadKey so callers cannot distinguish unknown from revoked.
func (a *Authenticator) Exchange(ctx context.Context, raw string) (Identity, error) {
	if len(raw) < prefixLen || len(raw) > 128 {
		return Identity{}, ErrBadKey
	}
	recs, err := a.Store.ByPrefix(ctx, raw[:prefixLen])
	if err != nil {
		return Identity{}, err
	}
	want := []byte(HashKey(raw))
	var found *KeyRecord
	for i := range recs {
		// Compare every candidate; do not exit early on a match.
		if subtle.ConstantTimeCompare(want, []byte(recs[i].KeyHash)) == 1 {
			found = &recs[i]
		}
	}
	if found == nil || found.Revoked || found.Suspended {
		return Identity{}, ErrBadKey
	}
	return Identity{TenantID: found.TenantID, Tier: found.Tier}, nil
}

type PGKeyStore struct{ Pool *pgxpool.Pool }

func (s PGKeyStore) ByPrefix(ctx context.Context, prefix string) ([]KeyRecord, error) {
	rows, err := s.Pool.Query(ctx, `SELECT k.tenant_id, t.tier, k.key_hash,
			k.revoked_at IS NOT NULL, t.status <> 'active'
		FROM api_keys k JOIN tenants t ON t.id = k.tenant_id WHERE k.prefix = $1`, prefix)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []KeyRecord
	for rows.Next() {
		var r KeyRecord
		if err := rows.Scan(&r.TenantID, &r.Tier, &r.KeyHash, &r.Revoked, &r.Suspended); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// NewKey returns a fresh raw API key ("bk_" + 192 random bits) and its stored prefix.
func NewKey() (raw, prefix string, err error) {
	b := make([]byte, 24)
	if _, err = rand.Read(b); err != nil {
		return "", "", err
	}
	raw = "bk_" + hex.EncodeToString(b)
	return raw, raw[:prefixLen], nil
}

// Rotate revokes the tenant's active keys and issues one new key, atomically.
// The raw key is returned once and never stored.
func (s PGKeyStore) Rotate(ctx context.Context, tenantID string) (string, error) {
	raw, prefix, err := NewKey()
	if err != nil {
		return "", err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `UPDATE api_keys SET revoked_at = now()
		WHERE tenant_id=$1 AND revoked_at IS NULL`, tenantID); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO api_keys (tenant_id, key_hash, prefix) VALUES ($1,$2,$3)`,
		tenantID, HashKey(raw), prefix); err != nil {
		return "", err
	}
	return raw, tx.Commit(ctx)
}
