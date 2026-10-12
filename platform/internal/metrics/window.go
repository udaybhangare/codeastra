package metrics

import "time"

// Event is one finished (or rejected) request, as seen by the platform.
type Event struct {
	At        time.Time // stamped by Record when zero
	Tenant    string
	Task      string
	QueueWait time.Duration
	Exec      time.Duration
	Total     time.Duration
	CPUms     float64
	MemPeakMB float64
	DBms      float64
	Bytes     int64
	Cost      float64 // cost units
	Status    int     // HTTP status returned to the caller
	Reason    string  // X-Reason for rejections
}

// Rejected reports admission/overload rejections (429/503): they are counted
// but excluded from latency histograms.
func (e *Event) Rejected() bool { return e.Status == 429 || e.Status == 503 }

// OK reports a successful completion.
func (e *Event) OK() bool { return e.Status >= 200 && e.Status < 400 }

// Window is one tenant's closed 1-second aggregate. Latencies are ms.
type Window struct {
	Start  time.Time `json:"start"`
	Tenant string    `json:"tenant_id"`

	Requests int `json:"requests"`
	OK       int `json:"ok"`
	Rejected int `json:"rejected"`
	Errors   int `json:"errors"`

	P50, P95, P99                float64 // total latency
	QueueWaitP50, QueueWaitP95   float64
	QueueWaitP99                 float64
	ExecP50, ExecP95, ExecP99    float64
	CPUms, DBms, Bytes, CostUnit float64 // summed over the window
	MemPeakMB                    float64 // max over the window

	// Gauges sampled at close (see Aggregator.SetGauges / host sampler).
	QueueDepth int
	InFlight   int
	CPUShare   float64 // fraction of host CPU used by the tenant's container
	MemMB      float64

	// Derived at close.
	Entitlement  float64 // fraction of host CPU the tenant is entitled to
	P99Inflation float64 // P99 / calm baseline p99; 0 when unknown
}

// Host is a host-level utilisation sample.
type Host struct {
	CPUUtil float64 `json:"cpu_util"`
	MemUtil float64 `json:"mem_util"`
}

// Fairness summarises one second across tenants.
type Fairness struct {
	Jain            float64 `json:"jain"`
	VictimInflation float64 `json:"victim_inflation"`
}

// Snapshot is everything closed at one tick; the detector consumes this.
type Snapshot struct {
	Start    time.Time
	Windows  []Window
	Host     Host
	Fairness Fairness
}

// Jain returns Jain's fairness index (Σx)²/(n·Σx²); 1 for empty/all-zero input.
func Jain(x []float64) float64 {
	var s, s2 float64
	for _, v := range x {
		s += v
		s2 += v * v
	}
	if len(x) == 0 || s2 == 0 {
		return 1
	}
	return s * s / (float64(len(x)) * s2)
}
