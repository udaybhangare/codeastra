package lg

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// HTTPSender invokes tasks over the public API with per-tenant API keys and
// automatically refreshed 15-minute JWTs.
type HTTPSender struct {
	Base   string // e.g. https://bulkhead.udaybhangare.com
	Keys   map[string]string
	Client *http.Client
	Clock  Clock

	mu   sync.Mutex
	toks map[string]*tokenState
}

type tokenState struct {
	mu      sync.Mutex
	token   string
	refresh time.Time // refresh at ~80% of lifetime
}

func NewHTTPSender(base string, keys map[string]string, clock Clock) *HTTPSender {
	tr := &http.Transport{
		MaxIdleConns: 2048, MaxIdleConnsPerHost: 2048, MaxConnsPerHost: 0,
		IdleConnTimeout: 90 * time.Second, ForceAttemptHTTP2: false,
	}
	return &HTTPSender{
		Base: strings.TrimRight(base, "/"), Keys: keys, Clock: clock,
		Client: &http.Client{Transport: tr, Timeout: 60 * time.Second},
		toks:   map[string]*tokenState{},
	}
}

func (s *HTTPSender) state(tenant string) *tokenState {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.toks[tenant]
	if st == nil {
		st = &tokenState{}
		s.toks[tenant] = st
	}
	return st
}

func (s *HTTPSender) token(ctx context.Context, tenant string, force bool) (string, error) {
	st := s.state(tenant)
	st.mu.Lock()
	defer st.mu.Unlock()
	if !force && st.token != "" && s.Clock.Now().Before(st.refresh) {
		return st.token, nil
	}
	key := s.Keys[tenant]
	if key == "" {
		return "", fmt.Errorf("no API key for tenant %q", tenant)
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, s.Base+"/v1/auth/token", nil)
	req.Header.Set("X-API-Key", key)
	resp, err := s.Client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("token mint %d: %s", resp.StatusCode, bytes.TrimSpace(b))
	}
	var tr struct {
		Token     string `json:"token"`
		ExpiresIn int    `json:"expires_in"`
	}
	if err := json.Unmarshal(b, &tr); err != nil || tr.Token == "" {
		return "", fmt.Errorf("token mint: bad response")
	}
	life := time.Duration(tr.ExpiresIn) * time.Second
	if life <= 0 {
		life = 15 * time.Minute
	}
	st.token = tr.Token
	st.refresh = s.Clock.Now().Add(life * 8 / 10)
	return st.token, nil
}

// Warm mints tokens for all tenants up front so minting is not on the clock.
func (s *HTTPSender) Warm(ctx context.Context, tenants []string) error {
	for _, t := range tenants {
		if _, err := s.token(ctx, t, true); err != nil {
			return fmt.Errorf("tenant %s: %w", t, err)
		}
	}
	return nil
}

func body(r Request) []byte {
	m := make(map[string]any, len(r.Params)+2)
	for k, v := range r.Params {
		m[k] = v
	}
	if r.PayloadBytes > 0 {
		m["pad"] = strings.Repeat("x", r.PayloadBytes)
		if r.Task == "payload" {
			if _, ok := m["kb"]; !ok {
				m["kb"] = (r.PayloadBytes + 1023) / 1024
			}
		}
	}
	b, _ := json.Marshal(m)
	return b
}

func (s *HTTPSender) Do(ctx context.Context, r Request) Outcome {
	for try := 0; try < 2; try++ {
		tok, err := s.token(ctx, r.Tenant, try > 0)
		if err != nil {
			return Outcome{Level: -1, Err: err.Error()}
		}
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, s.Base+"/v1/invoke/"+r.Task, bytes.NewReader(body(r)))
		req.Header.Set("Authorization", "Bearer "+tok)
		req.Header.Set("Content-Type", "application/json")
		resp, err := s.Client.Do(req)
		if err != nil {
			return Outcome{Level: -1, Err: err.Error()}
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode == 401 && try == 0 {
			continue // expired/revoked token: refresh once
		}
		o := Outcome{Status: resp.StatusCode, Level: -1, Reason: resp.Header.Get("X-Reason")}
		if v := resp.Header.Get("Retry-After"); v != "" {
			if n, err := strconv.ParseFloat(v, 64); err == nil {
				o.RetryAfter = time.Duration(n * float64(time.Second))
			}
		}
		if v := resp.Header.Get("X-Throttle-Level"); v != "" {
			if n, err := strconv.Atoi(v); err == nil {
				o.Level = n
			}
		}
		if v := resp.Header.Get("X-Queue-Wait-Ms"); v != "" {
			o.QueueWaitMs, _ = strconv.ParseFloat(v, 64)
		}
		return o
	}
	return Outcome{Status: 401, Level: -1}
}
