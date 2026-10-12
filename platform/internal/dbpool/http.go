package dbpool

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/bulkhead/platform/internal/policy"
)

// WorkerSecret derives the per-worker secret from the platform master secret.
func WorkerSecret(master, tenant string) string {
	m := hmac.New(sha256.New, []byte(master))
	m.Write([]byte(tenant))
	return hex.EncodeToString(m.Sum(nil))
}

// PolicySource is satisfied by *policy.Cache.
type PolicySource interface {
	Get(tenantID string) (policy.Policy, bool)
}

// Handler serves POST /internal/db for tenant workers. The caller's identity comes from the
// body's tenant, proven by the X-Worker-Secret header.
func Handler(p *Pool, pols PolicySource, master string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Tenant string  `json:"tenant"`
			Kind   string  `json:"kind"`
			N      float64 `json:"n"`
		}
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		want := WorkerSecret(master, body.Tenant)
		if master == "" || subtle.ConstantTimeCompare([]byte(want), []byte(r.Header.Get("X-Worker-Secret"))) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		pol, ok := pols.Get(body.Tenant)
		if !ok {
			http.Error(w, "unknown tenant", http.StatusNotFound)
			return
		}
		res, err := p.Do(r.Context(), pol, Request{Tenant: body.Tenant, Kind: Kind(body.Kind), N: body.N})
		w.Header().Set("Content-Type", "application/json")
		switch {
		case errors.Is(err, ErrDBConns):
			w.Header().Set("X-Reason", "DB_CONNS")
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
		case errors.Is(err, ErrTimeout):
			w.Header().Set("X-Reason", "DB_TIMEOUT")
			w.WriteHeader(http.StatusGatewayTimeout)
		case errors.Is(err, ErrKind):
			w.WriteHeader(http.StatusBadRequest)
		case err != nil:
			w.WriteHeader(http.StatusBadGateway)
		}
		_ = json.NewEncoder(w).Encode(res)
	})
}
