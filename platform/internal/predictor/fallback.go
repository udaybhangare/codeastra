package predictor

import (
	"math"
	"time"
)

// Fallback is the in-process forecaster used when the sidecar is unavailable:
// EWMA level + EWMA trend of cost-units/s, projected H seconds ahead. Simpler
// than the sidecar's Holt+z-score but same scale of p_overload.
type Fallback struct {
	cap float64
	st  map[string]*fbState
}

type fbState struct {
	level, trend float64
	n, streak    int
}

const (
	fbH       = 10.0
	fbAlpha   = 0.3
	fbBeta    = 0.1
	fbMid     = 0.5 // tenant alone at 50% of host capacity == overload
	fbSteep   = 8.0
	fbStreak  = 3
	fbMinTrnd = 0.01
)

// NewFallback returns a Fallback for a host capacity in cost units/s.
func NewFallback(capacity float64) *Fallback {
	return &Fallback{cap: capacity, st: map[string]*fbState{}}
}

// Step ingests one round and forecasts every tenant in it.
func (f *Fallback) Step(at time.Time, req wireReq) Result {
	res := Result{At: at, Model: "ewma-fallback", Tenants: map[string]Prediction{}}
	var total float64
	for _, t := range req.Tenants {
		var cost float64
		if len(t.Features) > 1 {
			cost = t.Features[1]
		}
		s := f.st[t.ID]
		if s == nil {
			s = &fbState{level: cost}
			f.st[t.ID] = s
		}
		prev := s.level
		s.level = fbAlpha*cost + (1-fbAlpha)*(s.level+s.trend)
		if s.n > 0 {
			s.trend = fbBeta*(s.level-prev) + (1-fbBeta)*s.trend
		}
		s.n++
		proj := math.Max(0, s.level+fbH*s.trend)
		total += proj
		p, top := 0.0, "none"
		if f.cap > 0 {
			rising := s.trend > fbMinTrnd*f.cap
			if rising {
				s.streak++
			} else {
				s.streak = 0
			}
			ratio := proj / f.cap / fbMid
			p = logistic(fbSteep * (ratio - 1))
			if s.streak < fbStreak {
				p *= 0.3
			}
			if p > 0.05 {
				top = "cost_rate_trend"
			}
		}
		pr := Prediction{P: round4(p), TopFactor: top, Source: "fallback"}
		if f.cap > 0 && s.level/f.cap/fbMid >= 1 {
			z := 0.0
			pr.ETA = &z
		} else if f.cap > 0 && s.trend > fbMinTrnd*f.cap {
			for h := 1.0; h <= 30; h++ {
				if (s.level+h*s.trend)/f.cap/fbMid >= 1 {
					hh := h
					pr.ETA = &hh
					break
				}
			}
		}
		res.Tenants[t.ID] = pr
	}
	r := math.Max(req.Host.CPUUtil, req.Host.MemUtil) / 0.95
	if f.cap > 0 {
		r = math.Max(r, total/f.cap)
	}
	res.Host = round4(logistic(fbSteep * (r - 1)))
	return res
}

func logistic(x float64) float64 { return 1 / (1 + math.Exp(-x)) }
func round4(x float64) float64   { return math.Round(x*1e4) / 1e4 }
