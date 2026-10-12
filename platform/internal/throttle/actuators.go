package throttle

import (
	"context"
	"sync"
	"time"

	"github.com/bulkhead/platform/internal/detector"
)

// Actuators are injected so the controller is testable without Docker/Redis.
// scheduler.Scheduler (and dispatcher.Dispatcher) satisfy SchedulerActuator;
// *workerpool.Pool satisfies CgroupActuator.

// SchedulerActuator changes a tenant's DRR weight and quarantine-lane membership.
type SchedulerActuator interface {
	SetWeight(tenant string, w float64)
	SetQuarantine(tenant string, on bool)
}

// BucketActuator scales the tenant's rate and cost buckets; burstOn=false
// disables burst (bucket capacity collapses to one second of rate).
type BucketActuator interface {
	SetBuckets(tenant string, rateMult float64, burstOn bool)
}

// CgroupActuator updates a tenant container's CPU/memory limits live.
type CgroupActuator interface {
	Update(ctx context.Context, tenant string, cpus float64, memMB int64) error
}

// DBActuator caps a tenant's DB connections; n ≤ 0 removes the override.
type DBActuator interface {
	SetConnCap(tenant string, n int)
}

// Actuators bundles the four actuators; nil members are skipped.
type Actuators struct {
	Scheduler SchedulerActuator
	Buckets   BucketActuator
	Cgroup    CgroupActuator
	DB        DBActuator
}

// Store persists a throttle_events row; Publisher pushes the live WS event.
type Store interface {
	Insert(ctx context.Context, e Event) error
}
type Publisher interface{ Publish(e Event) }

// Event is one ladder transition or recovery step, with its evidence.
type Event struct {
	TS          time.Time `json:"ts"`
	Tenant      string    `json:"tenant_id"`
	From        Level     `json:"from_level"`
	To          Level     `json:"to_level"`
	Reason      string    `json:"reason"`
	Actor       string    `json:"actor"`
	Evidence    Evidence  `json:"evidence"`
	Actions     []Action  `json:"actions"`
	Explanation string    `json:"explanation"`
}

// Reasons recorded in throttle_events.reason.
const (
	ReasonDetected    = "DETECTED"     // first harm → Observe
	ReasonSustained   = "SUSTAINED"    // score>τ₂ sustained → Soft
	ReasonPersisted   = "PERSISTED"    // harm persisted at level → next level
	ReasonReoffense   = "REOFFENSE"    // harm returned within 60 s of recovery
	ReasonLimitBreach = "LIMIT_BREACH" // OOM / limit-breach loop → Quarantine
	ReasonPredicted   = "PREDICTED"    // predictor forecast, no reactive trigger yet
	ReasonRecovered   = "RECOVERED"    // calm long enough → one level down
	ReasonRecovering  = "RECOVERING"   // AIMD limit ramp step (same level)
	ReasonPin         = "MANUAL_PIN"
	ReasonUnpin       = "MANUAL_UNPIN"
	ReasonPanic       = "PANIC"       // global shed of free tier
	ReasonPanicClear  = "PANIC_CLEAR" // panic mode switched off
)

// Action is one concrete limit change that was applied.
type Action struct {
	Kind  string  `json:"kind"` // scheduler.weight, scheduler.quarantine, bucket.rate_mult, bucket.burst, cgroup.cpus, db.conn_cap
	Value float64 `json:"value"`
}

// Evidence explains why the controller acted: the detector's finding plus
// the thresholds and timers that were crossed.
type Evidence struct {
	Finding   *detector.Finding  `json:"finding,omitempty"`
	Score     float64            `json:"score"`
	Thresh    map[string]float64 `json:"thresholds,omitempty"`
	Timers    map[string]float64 `json:"timers_s,omitempty"`
	Predicted *float64           `json:"predictor_score,omitempty"`
	Note      string             `json:"note,omitempty"`
}

// Limits is a thread-safe BucketActuator + DBActuator that admission and the
// DB pool read on their hot paths.
type Limits struct {
	mu   sync.RWMutex
	rate map[string]rateState
	db   map[string]int
}

type rateState struct {
	mult    float64
	burstOn bool
}

func NewLimits() *Limits { return &Limits{rate: map[string]rateState{}, db: map[string]int{}} }

func (l *Limits) SetBuckets(t string, mult float64, burstOn bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if mult >= 1 && burstOn {
		delete(l.rate, t)
		return
	}
	l.rate[t] = rateState{mult, burstOn}
}

func (l *Limits) SetConnCap(t string, n int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if n <= 0 {
		delete(l.db, t)
		return
	}
	l.db[t] = n
}

// RateScale returns the rate/cost multiplier and whether burst is allowed.
func (l *Limits) RateScale(t string) (mult float64, burstOn bool) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	if s, ok := l.rate[t]; ok {
		return s.mult, s.burstOn
	}
	return 1, true
}

// ConnCap returns the throttled DB connection cap, or 0 for "no override".
func (l *Limits) ConnCap(t string) int {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.db[t]
}
