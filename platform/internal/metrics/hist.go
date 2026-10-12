package metrics

import "math/bits"

// Histogram is a fixed-size log-linear (HDR-style) histogram of non-negative
// microsecond values. Each power of two is split into 128 linear sub-buckets,
// so the relative error of any reported quantile is below 0.8%. Recording is
// allocation-free; Reset only clears buckets that were touched.
const (
	subBits    = 7
	subCount   = 1 << subBits // 128
	maxShift   = 20           // values clamp at ~268 s
	histLen    = (maxShift + 2) * subCount
	maxValueUS = (uint64(2*subCount) << maxShift) - 1
)

type Histogram struct {
	counts [histLen]uint32
	total  uint64
	maxIdx int // highest touched bucket, for cheap Reset/scan
}

func bucketIndex(v uint64) int {
	if v < subCount {
		return int(v)
	}
	if v > maxValueUS {
		v = maxValueUS
	}
	shift := bits.Len64(v) - 1 - subBits
	return (shift+1)*subCount + int(v>>uint(shift)) - subCount
}

// bucketMid returns the midpoint value represented by a bucket.
func bucketMid(idx int) float64 {
	if idx < subCount {
		return float64(idx)
	}
	shift := idx/subCount - 1
	sub := idx%subCount + subCount
	lo := uint64(sub) << uint(shift)
	return float64(lo) + float64(uint64(1)<<uint(shift))/2
}

// Record adds one value in microseconds.
func (h *Histogram) Record(us uint64) {
	i := bucketIndex(us)
	h.counts[i]++
	h.total++
	if i > h.maxIdx {
		h.maxIdx = i
	}
}

func (h *Histogram) Count() uint64 { return h.total }

// Quantile returns the value (µs) at quantile q in [0,1]; 0 when empty.
func (h *Histogram) Quantile(q float64) float64 {
	if h.total == 0 {
		return 0
	}
	rank := uint64(q*float64(h.total) + 0.9999999)
	if rank < 1 {
		rank = 1
	}
	if rank > h.total {
		rank = h.total
	}
	var cum uint64
	for i := 0; i <= h.maxIdx; i++ {
		cum += uint64(h.counts[i])
		if cum >= rank {
			return bucketMid(i)
		}
	}
	return bucketMid(h.maxIdx)
}

func (h *Histogram) Reset() {
	if h.total == 0 {
		return
	}
	clear(h.counts[:h.maxIdx+1])
	h.total, h.maxIdx = 0, 0
}
