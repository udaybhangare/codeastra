// Package cost turns resource usage into one scalar "cost unit" and estimates it
// before execution (docs/03 §3.1).
package cost

import (
	"math"
	"sync"
)

// Vector is the resource cost of one invocation.
type Vector struct {
	CPUms   float64
	MemMBms float64
	DBms    float64
	Bytes   float64
}

// Weights for the scalar formula c = a·cpu_ms + b·db_ms + g·bytes/1024 + m·mem_mb_ms/1000.
type Weights struct{ A, B, G, M float64 }

var DefaultWeights = Weights{A: 1, B: 1.5, G: 0.1, M: 0.2}

func (w Weights) Unit(v Vector) float64 {
	return w.A*v.CPUms + w.B*v.DBms + w.G*v.Bytes/1024 + w.M*v.MemMBms/1000
}

// FromParams is the prior: a cost vector derived from the task type and its params.
// Numeric params accepted: ms (cpu-burn, db-query), mb (mem-alloc), kb (payload).
func FromParams(task string, params map[string]any) Vector {
	num := func(k string, def float64) float64 {
		switch x := params[k].(type) {
		case float64:
			return math.Max(0, x)
		case int:
			return math.Max(0, float64(x))
		}
		return def
	}
	switch task {
	case "cpu-burn":
		return Vector{CPUms: num("ms", 500), Bytes: 256}
	case "mem-alloc":
		return Vector{CPUms: 5, MemMBms: num("mb", 64) * 100, Bytes: 256} // assume ~100 ms hold
	case "db-query":
		return Vector{CPUms: 2, DBms: num("ms", 50), Bytes: 512}
	case "payload":
		kb := num("kb", 64)
		return Vector{CPUms: 2, Bytes: kb * 1024}
	default: // echo and unknown tasks
		return Vector{CPUms: 1, Bytes: 128}
	}
}

type key struct{ tenant, task string }

// Estimator predicts cost per (tenant, task): prior × EWMA of observed actual/prior
// ratio. Ratio (not absolute cost) because params vary wildly between calls.
type Estimator struct {
	W     Weights
	Alpha float64 // EWMA smoothing, default 0.3
	mu    sync.Mutex
	ratio map[key]float64
}

func NewEstimator(w Weights) *Estimator {
	return &Estimator{W: w, Alpha: 0.3, ratio: map[key]float64{}}
}

// Estimate returns the predicted vector and its scalar unit.
func (e *Estimator) Estimate(tenant, task string, params map[string]any) (Vector, float64) {
	v := FromParams(task, params)
	e.mu.Lock()
	r, ok := e.ratio[key{tenant, task}]
	e.mu.Unlock()
	if ok {
		v = Vector{v.CPUms * r, v.MemMBms * r, v.DBms * r, v.Bytes * r}
	}
	return v, e.W.Unit(v)
}

// Observe feeds back the actual cost of a completed run (called by metrics, later prompts).
func (e *Estimator) Observe(tenant, task string, params map[string]any, actual Vector) {
	prior := e.W.Unit(FromParams(task, params))
	if prior <= 0 {
		return
	}
	r := math.Min(10, math.Max(0.1, e.W.Unit(actual)/prior))
	k := key{tenant, task}
	e.mu.Lock()
	if old, ok := e.ratio[k]; ok {
		r = e.Alpha*r + (1-e.Alpha)*old
	}
	e.ratio[k] = r
	e.mu.Unlock()
}
