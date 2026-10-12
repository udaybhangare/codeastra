// Package detector finds noisy neighbours: it decides who is being hurt
// (victims) and whose consumption explains it (culprits), per docs/06 steps 1–2.
// It only reports findings; acting on them is the throttle controller's job.
package detector

import "time"

// Config holds every tunable of the detector (docs/06).
type Config struct {
	Window time.Duration // length of one metrics window (default 1s)

	// Step 1 — victim detection.
	K                 float64 // victim if p99 > K × baseline p99 (default 2.5)
	N                 int     // consecutive degraded windows required (default 3)
	QueueWaitMinMs    float64 // absolute queue-wait p95 floor for "degraded" (default 100)
	QuotaSlack        float64 // tenant is "within quota" while usage ≤ slack × entitlement (default 1.1)
	MinCompletions    int     // completions needed for a window to be judged (default 5)
	BaselineMinWindow int     // calm windows before a baseline is trusted (default 5)
	BaselineAlpha     float64 // EWMA weight of a calm window (default 0.1)

	// Step 2 — culprit attribution.
	History     int     // windows of history for correlation (default 30)
	MaxLagWin   int     // max lag between culprit usage and victim latency (default 2)
	MinCorrPts  int     // minimum paired points for a correlation (default 8)
	DiffCorr    bool    // correlate first differences instead of levels (default false; lower recall)
	Tau         float64 // score threshold τ (default 0.05)
	ExcessAvgN  int     // windows averaged for excess share (default = N)
	Weights     Weights // per-resource weights w_r
	Capacity    Capacity
	FallbackEnt float64 // entitlement used when a tenant's is unknown; 0 = 1/tenants
}

// Weights are the per-resource weights w_r in the attribution score.
type Weights struct{ CPU, DB, Queue, Bytes float64 }

// Capacity converts raw per-window usage into a share of the host.
type Capacity struct {
	DBMsPerSec  float64 // DB busy-ms the shared DB can serve per second (default 4000)
	BytesPerSec float64 // egress bytes/s (default 50e6)
	QueueSlots  float64 // total queue+in-flight slots (default 256)
}

// DefaultConfig returns the doc 06 defaults.
func DefaultConfig() Config {
	return Config{
		Window: time.Second,
		K:      2.5, N: 3, QueueWaitMinMs: 100, QuotaSlack: 1.1,
		MinCompletions: 5, BaselineMinWindow: 5, BaselineAlpha: 0.1,
		History: 30, MaxLagWin: 2, MinCorrPts: 8, Tau: 0.05,
		Weights:  Weights{CPU: 0.4, DB: 0.3, Queue: 0.2, Bytes: 0.1},
		Capacity: Capacity{DBMsPerSec: 4000, BytesPerSec: 50e6, QueueSlots: 256},
	}
}

func (c *Config) fill() {
	d := DefaultConfig()
	if c.Window <= 0 {
		c.Window = d.Window
	}
	if c.K <= 0 {
		c.K = d.K
	}
	if c.N <= 0 {
		c.N = d.N
	}
	if c.QueueWaitMinMs <= 0 {
		c.QueueWaitMinMs = d.QueueWaitMinMs
	}
	if c.QuotaSlack <= 0 {
		c.QuotaSlack = d.QuotaSlack
	}
	if c.MinCompletions <= 0 {
		c.MinCompletions = d.MinCompletions
	}
	if c.BaselineMinWindow <= 0 {
		c.BaselineMinWindow = d.BaselineMinWindow
	}
	if c.BaselineAlpha <= 0 {
		c.BaselineAlpha = d.BaselineAlpha
	}
	if c.History <= 0 {
		c.History = d.History
	}
	if c.MaxLagWin < 0 {
		c.MaxLagWin = 0
	}
	if c.MinCorrPts <= 0 {
		c.MinCorrPts = d.MinCorrPts
	}
	if c.Tau <= 0 {
		c.Tau = d.Tau
	}
	if c.ExcessAvgN <= 0 {
		c.ExcessAvgN = c.N
	}
	if c.Weights == (Weights{}) {
		c.Weights = d.Weights
	}
	if c.Capacity.DBMsPerSec <= 0 {
		c.Capacity.DBMsPerSec = d.Capacity.DBMsPerSec
	}
	if c.Capacity.BytesPerSec <= 0 {
		c.Capacity.BytesPerSec = d.Capacity.BytesPerSec
	}
	if c.Capacity.QueueSlots <= 0 {
		c.Capacity.QueueSlots = d.Capacity.QueueSlots
	}
}
