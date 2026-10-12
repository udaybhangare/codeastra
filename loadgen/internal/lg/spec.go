// Package lg is the Bulkhead load generator: scenario specs, a seeded
// deterministic request schedule, an open-loop executor and a report builder.
package lg

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// Scenario mirrors contracts/scenario.schema.json.
type Scenario struct {
	Name        string       `json:"name"`
	Description string       `json:"description,omitempty"`
	ID          string       `json:"id,omitempty"`
	DefaultSeed int64        `json:"default_seed,omitempty"`
	Phases      []Phase      `json:"phases"`
	Tenants     []TenantSpec `json:"tenants"`
	Assertions  []Assertion  `json:"assertions,omitempty"`
	Waves       []Wave       `json:"waves,omitempty"`
}

// Wave labels a slice of the attack phase (seconds from attack start) so a
// long scenario can be reported per attack kind (cpu, memory, db, ...).
type Wave struct {
	Name   string  `json:"name"`
	Kind   string  `json:"kind,omitempty"`
	StartS float64 `json:"start_s"`
	EndS   float64 `json:"end_s"`
}

type Phase struct {
	Name      string `json:"name"`
	DurationS int    `json:"duration_s"`
}

type TenantSpec struct {
	Tenant   string    `json:"tenant"`
	Role     string    `json:"role"`
	Arrivals []Arrival `json:"arrivals"`
}

type Arrival struct {
	Phase               string    `json:"phase"`
	Process             string    `json:"process"`
	RPS                 float64   `json:"rps"`
	RPSEnd              float64   `json:"rps_end,omitempty"`
	BurstMultiplier     float64   `json:"burst_multiplier,omitempty"`
	BurstDurationS      float64   `json:"burst_duration_s,omitempty"`
	RetryWithoutBackoff bool      `json:"retry_without_backoff,omitempty"`
	StartS              float64   `json:"start_s,omitempty"` // arrivals only from this offset in the phase
	EndS                float64   `json:"end_s,omitempty"`   // ...until this offset (0 = phase end)
	TaskMix             []TaskMix `json:"task_mix,omitempty"`
}

type TaskMix struct {
	Task         string         `json:"task"`
	Weight       float64        `json:"weight"`
	Params       map[string]any `json:"params,omitempty"`
	PayloadBytes int            `json:"payload_bytes,omitempty"`
}

type Assertion struct {
	Metric    string  `json:"metric"`
	Op        string  `json:"op"`
	Value     float64 `json:"value"`
	AppliesTo string  `json:"applies_to,omitempty"`
}

var (
	phaseNames = map[string]bool{"warmup": true, "attack": true, "cooldown": true}
	processes  = map[string]bool{"poisson": true, "burst": true, "ramp": true, "constant": true}
	roles      = map[string]bool{"victim": true, "culprit": true, "false_positive_probe": true, "bystander": true}
	tasks      = map[string]bool{"echo": true, "cpu-burn": true, "mem-alloc": true, "db-query": true, "payload": true}
	ops        = map[string]bool{"<=": true, ">=": true, "==": true, "<": true, ">": true}
)

// ParseScenario decodes (strictly) and validates a scenario spec.
func ParseScenario(data []byte) (*Scenario, error) {
	var sc Scenario
	dec := json.NewDecoder(bytesReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&sc); err != nil {
		return nil, fmt.Errorf("scenario: %w", err)
	}
	if err := sc.Validate(); err != nil {
		return nil, err
	}
	return &sc, nil
}

// LoadScenarioFile reads and validates a scenario from disk.
func LoadScenarioFile(path string) (*Scenario, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return ParseScenario(b)
}

func (s *Scenario) Validate() error {
	if s.Name == "" || len(s.Phases) == 0 || len(s.Tenants) == 0 {
		return fmt.Errorf("scenario: name, phases and tenants are required")
	}
	have := map[string]bool{}
	for _, p := range s.Phases {
		if !phaseNames[p.Name] || p.DurationS < 1 {
			return fmt.Errorf("scenario %s: bad phase %q/%d", s.Name, p.Name, p.DurationS)
		}
		have[p.Name] = true
	}
	for _, t := range s.Tenants {
		if t.Tenant == "" || !roles[t.Role] || len(t.Arrivals) == 0 {
			return fmt.Errorf("scenario %s: bad tenant %q", s.Name, t.Tenant)
		}
		for _, a := range t.Arrivals {
			if !have[a.Phase] || !processes[a.Process] || a.RPS < 0 || a.RPSEnd < 0 {
				return fmt.Errorf("scenario %s: tenant %s: bad arrival (phase %q process %q)", s.Name, t.Tenant, a.Phase, a.Process)
			}
			if a.StartS < 0 || a.EndS < 0 || (a.EndS != 0 && a.EndS <= a.StartS) {
				return fmt.Errorf("scenario %s: tenant %s: bad start_s/end_s", s.Name, t.Tenant)
			}
			if a.BurstMultiplier != 0 && a.BurstMultiplier < 1 {
				return fmt.Errorf("scenario %s: tenant %s: burst_multiplier < 1", s.Name, t.Tenant)
			}
			for _, m := range a.TaskMix {
				if !tasks[m.Task] || m.Weight <= 0 || m.PayloadBytes < 0 {
					return fmt.Errorf("scenario %s: tenant %s: bad task mix %q", s.Name, t.Tenant, m.Task)
				}
			}
		}
	}
	for _, a := range s.Assertions {
		if a.Metric == "" || !ops[a.Op] {
			return fmt.Errorf("scenario %s: bad assertion %q %q", s.Name, a.Metric, a.Op)
		}
	}
	return nil
}

// Scaled returns a copy with phase durations multiplied by f (min 1 s).
// Used for tiny smoke runs; the schedule is a function of the scaled spec.
func (s *Scenario) Scaled(f float64) *Scenario {
	if f <= 0 || f == 1 {
		return s
	}
	c := *s
	c.Phases = make([]Phase, len(s.Phases))
	for i, p := range s.Phases {
		p.DurationS = max(1, int(float64(p.DurationS)*f+0.5))
		c.Phases[i] = p
	}
	return &c
}

// WithLoad returns a copy with every arrival rate (rps, rps_end) multiplied
// by f. Task sizes (ms/mb/n) are untouched; durations are unchanged.
func (s *Scenario) WithLoad(f float64) *Scenario {
	if f <= 0 || f == 1 {
		return s
	}
	c := *s
	c.Tenants = make([]TenantSpec, len(s.Tenants))
	for i, t := range s.Tenants {
		arr := make([]Arrival, len(t.Arrivals))
		for j, a := range t.Arrivals {
			a.RPS *= f
			a.RPSEnd *= f
			arr[j] = a
		}
		t.Arrivals = arr
		c.Tenants[i] = t
	}
	return &c
}

// PhaseWindow is a phase placed on the scenario timeline.
type PhaseWindow struct {
	Name       string
	Start, End time.Duration
}

func (s *Scenario) Windows() []PhaseWindow {
	var out []PhaseWindow
	var at time.Duration
	for _, p := range s.Phases {
		d := time.Duration(p.DurationS) * time.Second
		out = append(out, PhaseWindow{p.Name, at, at + d})
		at += d
	}
	return out
}

func (s *Scenario) Total() time.Duration {
	w := s.Windows()
	return w[len(w)-1].End
}
