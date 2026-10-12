package cost

import (
	"math"
	"testing"
)

func TestUnitFormula(t *testing.T) {
	// 100·1 + 10·1.5 + 2048/1024·0.1 + 5000/1000·0.2 = 116.2
	got := DefaultWeights.Unit(Vector{CPUms: 100, DBms: 10, Bytes: 2048, MemMBms: 5000})
	if math.Abs(got-116.2) > 1e-9 {
		t.Fatalf("got %v", got)
	}
}

func TestExpensiveTaskIsAboutFiveHundredEchoes(t *testing.T) {
	e := NewEstimator(DefaultWeights)
	_, burn := e.Estimate("t", "cpu-burn", nil)
	_, echo := e.Estimate("t", "echo", nil)
	if r := burn / echo; r < 300 || r > 700 {
		t.Fatalf("cpu-burn/echo = %.0f, want ~500", r)
	}
}

func TestParamsScaleEstimate(t *testing.T) {
	e := NewEstimator(DefaultWeights)
	_, a := e.Estimate("t", "cpu-burn", map[string]any{"ms": 100.0})
	_, b := e.Estimate("t", "cpu-burn", map[string]any{"ms": 1000.0})
	if b < 9*a {
		t.Fatalf("1000ms should cost ~10x 100ms: %v vs %v", b, a)
	}
}

func TestEWMACorrection(t *testing.T) {
	e := NewEstimator(DefaultWeights)
	params := map[string]any{"ms": 100.0}
	_, prior := e.Estimate("a", "cpu-burn", params)
	// actual is consistently 2x the prior
	for i := 0; i < 30; i++ {
		e.Observe("a", "cpu-burn", params, Vector{CPUms: 2 * (100 + 0), Bytes: 2 * 256})
	}
	_, after := e.Estimate("a", "cpu-burn", params)
	if after < 1.9*prior || after > 2.1*prior {
		t.Fatalf("prior %v after %v, want ~2x", prior, after)
	}
	if _, other := e.Estimate("b", "cpu-burn", params); math.Abs(other-prior) > 1e-9 {
		t.Fatal("correction must be per tenant")
	}
}
