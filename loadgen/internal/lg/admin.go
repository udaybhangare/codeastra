package lg

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Admin talks to /admin/* (isolation toggle, run storage).
type Admin struct {
	Base   string
	Token  string // bearer admin JWT; if empty, minted from Key
	Key    string // X-Admin-Key
	Client *http.Client
}

func NewAdmin(base, token, key string) *Admin {
	return &Admin{Base: strings.TrimRight(base, "/"), Token: token, Key: key, Client: &http.Client{Timeout: 15 * time.Second}}
}

func (a *Admin) call(ctx context.Context, method, path string, in, out any) (int, error) {
	var rd io.Reader
	if in != nil {
		b, _ := json.Marshal(in)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequestWithContext(ctx, method, a.Base+path, rd)
	req.Header.Set("Content-Type", "application/json")
	if path == "/admin/auth/token" {
		req.Header.Set("X-Admin-Key", a.Key)
	} else {
		req.Header.Set("Authorization", "Bearer "+a.Token)
	}
	resp, err := a.Client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return resp.StatusCode, fmt.Errorf("%s %s: %d %s", method, path, resp.StatusCode, bytes.TrimSpace(b))
	}
	if out != nil {
		_ = json.Unmarshal(b, out)
	}
	return resp.StatusCode, nil
}

func (a *Admin) ensureToken(ctx context.Context) error {
	if a.Token != "" {
		return nil
	}
	if a.Key == "" {
		return fmt.Errorf("admin credentials missing: set LOADGEN_ADMIN_TOKEN or LOADGEN_ADMIN_KEY")
	}
	var tr struct {
		Token string `json:"token"`
	}
	if _, err := a.call(ctx, http.MethodPost, "/admin/auth/token", struct{}{}, &tr); err != nil {
		return err
	}
	a.Token = tr.Token
	return nil
}

// SetIsolation flips ISOLATION=on|off at runtime.
func (a *Admin) SetIsolation(ctx context.Context, mode string) error {
	if err := a.ensureToken(ctx); err != nil {
		return err
	}
	_, err := a.call(ctx, http.MethodPost, "/admin/isolation", map[string]string{"mode": mode}, nil)
	return err
}

// StoreRun best-effort posts a run to /admin/runs. 404/405 (endpoint not
// deployed yet) is reported via the returned error but is not fatal to callers.
func (a *Admin) StoreRun(ctx context.Context, r *Report) error {
	if err := a.ensureToken(ctx); err != nil {
		return err
	}
	_, err := a.call(ctx, http.MethodPost, "/admin/runs", map[string]any{
		"scenario": r.Scenario, "seed": r.Seed, "isolation_mode": r.Mode,
		"started_at": r.StartedAt, "ended_at": r.EndedAt, "summary": r,
	}, nil)
	return err
}

// FinishRun completes a run created by POST /admin/scenarios/{name}/run.
func (a *Admin) FinishRun(ctx context.Context, runID string, r *Report) error {
	if err := a.ensureToken(ctx); err != nil {
		return err
	}
	_, err := a.call(ctx, http.MethodPost, "/admin/runs", map[string]any{
		"run_id": runID, "started_at": r.StartedAt, "ended_at": r.EndedAt, "summary": r,
	}, nil)
	return err
}

// FailRun closes a run with an error summary so the dashboard does not wait forever.
func (a *Admin) FailRun(ctx context.Context, runID, msg string, at time.Time) error {
	if err := a.ensureToken(ctx); err != nil {
		return err
	}
	_, err := a.call(ctx, http.MethodPost, "/admin/runs", map[string]any{
		"run_id": runID, "ended_at": at, "summary": map[string]any{"error": msg},
	}, nil)
	return err
}

// Progress is a best-effort heartbeat (phase warmup|attack|cooldown).
func (a *Admin) Progress(ctx context.Context, runID, phase string, elapsed, total time.Duration) {
	if a.ensureToken(ctx) != nil {
		return
	}
	_, _ = a.call(ctx, http.MethodPost, "/admin/runs/"+runID+"/progress", map[string]any{
		"phase": phase, "elapsed_s": elapsed.Seconds(), "total_s": total.Seconds(),
	}, nil)
}
