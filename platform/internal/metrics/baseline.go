package metrics

import "sync"

// Baseline is a tenant's calm-state latency reference (ms).
type Baseline struct {
	P95, P99, QueueWaitP95 float64
	Samples                int
}

// BaselineConfig tunes the calm baseline tracker.
type BaselineConfig struct {
	Alpha      float64 // EWMA weight of a new calm window (default 0.1)
	K          float64 // window is "calm" while p99 <= K*baseline p99 (default 2.5)
	MinSamples int     // completions needed for a window to count (default 5)
}

// Baselines tracks per-tenant EWMA baselines over calm windows only. The value
// freezes while a tenant is degraded (p99 above K×baseline) or explicitly
// frozen by the detector, so an attack cannot teach the baseline that slow is
// normal. Shared by the aggregator (inflation) and the detector (victims).
type Baselines struct {
	cfg    BaselineConfig
	mu     sync.RWMutex
	m      map[string]*Baseline
	frozen map[string]bool
}

func NewBaselines(cfg BaselineConfig) *Baselines {
	if cfg.Alpha <= 0 {
		cfg.Alpha = 0.1
	}
	if cfg.K <= 0 {
		cfg.K = 2.5
	}
	if cfg.MinSamples <= 0 {
		cfg.MinSamples = 5
	}
	return &Baselines{cfg: cfg, m: map[string]*Baseline{}, frozen: map[string]bool{}}
}

// Get returns the baseline and whether one has been established.
func (b *Baselines) Get(tenant string) (Baseline, bool) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if v, ok := b.m[tenant]; ok {
		return *v, true
	}
	return Baseline{}, false
}

// Freeze pins or releases a tenant's baseline (detector calls it on victims).
func (b *Baselines) Freeze(tenant string, on bool) {
	b.mu.Lock()
	b.frozen[tenant] = on
	b.mu.Unlock()
}

// Observe folds a closed window in; it returns the p99 inflation relative to
// the baseline *before* this window (0 when there is no baseline yet).
func (b *Baselines) Observe(w *Window, completions int) float64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	cur, ok := b.m[w.Tenant]
	if completions < b.cfg.MinSamples {
		if ok && cur.P99 > 0 {
			return w.P99 / cur.P99
		}
		return 0
	}
	if !ok {
		b.m[w.Tenant] = &Baseline{P95: w.P95, P99: w.P99, QueueWaitP95: w.QueueWaitP95, Samples: 1}
		return 1
	}
	infl := 0.0
	if cur.P99 > 0 {
		infl = w.P99 / cur.P99
	}
	calm := !b.frozen[w.Tenant] && w.P99 <= b.cfg.K*cur.P99
	if calm {
		a := b.cfg.Alpha
		cur.P95 += a * (w.P95 - cur.P95)
		cur.P99 += a * (w.P99 - cur.P99)
		cur.QueueWaitP95 += a * (w.QueueWaitP95 - cur.QueueWaitP95)
		cur.Samples++
	}
	return infl
}
