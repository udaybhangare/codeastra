package auth

import (
	"sync"
	"time"
)

// Revocations is an in-memory deny list: individual jtis, and per-tenant cutoffs
// (every token issued at or before the cutoff is rejected). Entries only need to live
// as long as a token can (the TTL), so jtis are pruned lazily by expiry.
type Revocations struct {
	mu      sync.RWMutex
	jtis    map[string]int64 // jti -> token exp (unix)
	tenants map[string]int64 // tenant -> cutoff iat (unix)
	Now     func() time.Time
}

func NewRevocations(now func() time.Time) *Revocations {
	return &Revocations{jtis: map[string]int64{}, tenants: map[string]int64{}, Now: now}
}

func (r *Revocations) RevokeJTI(jti string, exp int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.Now().Unix()
	for k, e := range r.jtis {
		if e <= now {
			delete(r.jtis, k)
		}
	}
	r.jtis[jti] = exp
}

// RevokeTenant rejects all tokens for the tenant issued up to and including now.
func (r *Revocations) RevokeTenant(tenantID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tenants[tenantID] = r.Now().Unix()
}

func (r *Revocations) Revoked(c Claims) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.jtis[c.JTI]; ok {
		return true
	}
	cut, ok := r.tenants[c.TenantID]
	return ok && c.Iat <= cut
}
