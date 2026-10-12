package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// LoadgenClient delegates scenario runs to the load generator's HTTP trigger
// (POST {Base}/run). The generator reports back via /admin/runs/{id}/progress
// and POST /admin/runs {run_id,...}.
type LoadgenClient struct {
	Base   string
	Client *http.Client
}

func (l LoadgenClient) Start(ctx context.Context, runID, scenario string, seed int64, durationS int) error {
	if l.Base == "" {
		return fmt.Errorf("loadgen not configured (set LOADGEN_URL)")
	}
	c := l.Client
	if c == nil {
		c = &http.Client{Timeout: 10 * time.Second}
	}
	b, _ := json.Marshal(map[string]any{"run_id": runID, "scenario": scenario, "seed": seed, "duration": durationS})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(l.Base, "/")+"/run", bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := c.Do(req)
	if err != nil {
		return fmt.Errorf("loadgen unreachable: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode/100 != 2 {
		return fmt.Errorf("loadgen returned %d", res.StatusCode)
	}
	return nil
}

// PredictorHTTP fetches {Base}/state from the predictor sidecar.
func PredictorHTTP(base string) func(context.Context) (map[string]any, error) {
	c := &http.Client{Timeout: 2 * time.Second}
	return func(ctx context.Context) (map[string]any, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(base, "/")+"/state", nil)
		if err != nil {
			return nil, err
		}
		res, err := c.Do(req)
		if err != nil {
			return nil, err
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			return nil, fmt.Errorf("predictor %d", res.StatusCode)
		}
		var out map[string]any
		return out, json.NewDecoder(res.Body).Decode(&out)
	}
}

// PredictorSelectHTTP returns a func that POSTs {"model":m} to the sidecar's /model/select.
func PredictorSelectHTTP(base string) func(context.Context, string) error {
	c := &http.Client{Timeout: 3 * time.Second}
	return func(ctx context.Context, model string) error {
		b, _ := json.Marshal(map[string]string{"model": model})
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+"/model/select", bytes.NewReader(b))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		res, err := c.Do(req)
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			return fmt.Errorf("predictor %d", res.StatusCode)
		}
		return nil
	}
}
