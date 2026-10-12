// Package throttle is the adaptive throttle controller (docs/06 step 3): a
// per-tenant L0–L4 state machine driven by detector findings. It escalates
// only on sustained harm, recovers with AIMD, honours safety floors, and logs
// the evidence for every action it applies. Time comes from the caller (the
// snapshot clock), never from time.Now.
package throttle

import "time"

// Level is a rung of the throttle ladder.
type Level int

const (
	Normal Level = iota
	Observe
	Soft
	Hard
	Quarantine
)

var levelNames = [...]string{"Normal", "Observe", "Soft", "Hard", "Quarantine"}

func (l Level) String() string {
	if l < 0 || int(l) >= len(levelNames) {
		return "Unknown"
	}
	return levelNames[l]
}

// Knobs are the fractions of a tenant's policy limits the controller leaves it
// (1 = untouched). Each recovers independently under AIMD.
type Knobs struct {
	Weight float64 // DRR weight
	Rate   float64 // rate + cost bucket multiplier
	CPU    float64 // fraction of LimitCPU
	DB     float64 // fraction of DBConns
}

// Config holds every tunable (docs/06). Zero fields take DefaultConfig values.
type Config struct {
	Tau1 float64 // score that counts as "harm" (detector τ)
	Tau2 float64 // score that must be sustained for Observe → Soft

	Sustain2     time.Duration    // Observe→Soft: score>Tau2 this long
	Persist3     time.Duration    // Soft→Hard: harm persists this long at Soft
	Persist4     time.Duration    // Hard→Quarantine: harm persists this long at Hard
	MinDwell     time.Duration    // min time at a level before any change
	Grace        time.Duration    // harm gaps shorter than this don't reset timers (anti-flap)
	Calm         [5]time.Duration // calm needed to leave level i (index = current level)
	Reoffense    time.Duration    // re-offense window after a de-escalation
	RampStep     float64          // AIMD: fraction of the gap closed per calm tick
	ReoffenseMD  float64          // AIMD: multiplicative decrease on re-offense
	EventEvery   time.Duration    // min spacing of recovery-step events
	MaxCulprits  int              // max tenants held at Soft or above at once
	BreachCount  int              // limit-breach reports within BreachWindow → Quarantine
	BreachWindow time.Duration

	Profile [5]Knobs // target knobs per level

	CPUFloorFrac    float64 // CPU never below reservation × this (spec: 0.5), except Quarantine
	RailFrac        float64 // absolute safety rail: reservation × this (spec: 0.25)
	QuarantineCPU   float64 // fraction of LimitCPU in quarantine
	QuarantineMinCP float64 // absolute cores floor in quarantine
	MinRate         float64 // rate multiplier floor (non-quarantine)
	MinWeight       float64 // weight fraction floor (non-quarantine)

	PredictiveEnabled bool
	PredictObserve    float64 // p_overload to pre-enter Observe
	PredictSoft       float64 // p_overload to pre-enter Soft

	ActuateTimeout time.Duration
}

// DefaultConfig returns the doc 06 defaults.
func DefaultConfig() Config {
	return Config{
		Tau1: 0.05, Tau2: 0.10,
		Sustain2: 3 * time.Second, Persist3: 5 * time.Second, Persist4: 8 * time.Second,
		MinDwell: 5 * time.Second, Grace: 2 * time.Second,
		Calm:      [5]time.Duration{0, 5 * time.Second, 10 * time.Second, 15 * time.Second, 30 * time.Second},
		Reoffense: 60 * time.Second, RampStep: 0.1, ReoffenseMD: 0.5,
		EventEvery: 5 * time.Second, MaxCulprits: 3,
		BreachCount: 3, BreachWindow: 30 * time.Second,
		Profile: [5]Knobs{
			Normal:     {1, 1, 1, 1},
			Observe:    {1, 1, 1, 1},
			Soft:       {0.5, 0.7, 1, 1},
			Hard:       {0.5, 0.5, 0.4, 0.5},
			Quarantine: {0.25, 0.25, 0.1, 0.25},
		},
		CPUFloorFrac: 0.5, RailFrac: 0.25, QuarantineCPU: 0.1, QuarantineMinCP: 0.05,
		MinRate: 0.25, MinWeight: 0.25,
		PredictObserve: 0.6, PredictSoft: 0.85,
		ActuateTimeout: 3 * time.Second,
	}
}

func (c *Config) fill() {
	d := DefaultConfig()
	f := func(v *float64, def float64) {
		if *v <= 0 {
			*v = def
		}
	}
	g := func(v *time.Duration, def time.Duration) {
		if *v <= 0 {
			*v = def
		}
	}
	f(&c.Tau1, d.Tau1)
	f(&c.Tau2, d.Tau2)
	g(&c.Sustain2, d.Sustain2)
	g(&c.Persist3, d.Persist3)
	g(&c.Persist4, d.Persist4)
	g(&c.MinDwell, d.MinDwell)
	g(&c.Grace, d.Grace)
	g(&c.Reoffense, d.Reoffense)
	g(&c.EventEvery, d.EventEvery)
	g(&c.BreachWindow, d.BreachWindow)
	g(&c.ActuateTimeout, d.ActuateTimeout)
	f(&c.RampStep, d.RampStep)
	f(&c.ReoffenseMD, d.ReoffenseMD)
	f(&c.CPUFloorFrac, d.CPUFloorFrac)
	f(&c.RailFrac, d.RailFrac)
	f(&c.QuarantineCPU, d.QuarantineCPU)
	f(&c.QuarantineMinCP, d.QuarantineMinCP)
	f(&c.MinRate, d.MinRate)
	f(&c.MinWeight, d.MinWeight)
	f(&c.PredictObserve, d.PredictObserve)
	f(&c.PredictSoft, d.PredictSoft)
	if c.MaxCulprits <= 0 {
		c.MaxCulprits = d.MaxCulprits
	}
	if c.BreachCount <= 0 {
		c.BreachCount = d.BreachCount
	}
	for i := range c.Calm {
		if c.Calm[i] <= 0 {
			c.Calm[i] = d.Calm[i]
		}
	}
	if c.Profile == ([5]Knobs{}) {
		c.Profile = d.Profile
	}
}
