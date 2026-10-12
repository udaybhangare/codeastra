package metrics

import (
	"bufio"
	"context"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ContainerStat is a raw, cumulative reading for one tenant container.
type ContainerStat struct {
	CPUNanos uint64 // cumulative CPU time
	MemBytes uint64 // current usage
}

// ContainerSource reads per-tenant container stats (Docker stats API).
type ContainerSource interface {
	Stats(ctx context.Context) (map[string]ContainerStat, error)
}

// TenantStat is a rate-converted container reading.
type TenantStat struct {
	CPUCores float64
	MemMB    float64
}

// Sampler yields host and per-tenant resource usage once per call.
type Sampler interface {
	Sample(ctx context.Context) (Host, map[string]TenantStat)
}

// HostSampler combines /proc host numbers with Docker container stats. CPU
// rates come from deltas between successive samples on the injected clock.
type HostSampler struct {
	Now        func() time.Time
	Containers ContainerSource // optional
	ProcStat   string          // default /proc/stat
	ProcMem    string          // default /proc/meminfo

	mu            sync.Mutex
	lastAt        time.Time
	lastBusy      uint64
	lastTotal     uint64
	lastContainer map[string]ContainerStat
}

func (h *HostSampler) Sample(ctx context.Context) (Host, map[string]TenantStat) {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.Now()
	var host Host

	busy, total := readCPUStat(orDefault(h.ProcStat, "/proc/stat"))
	if h.lastTotal != 0 && total > h.lastTotal {
		host.CPUUtil = clamp01(float64(busy-h.lastBusy) / float64(total-h.lastTotal))
	}
	h.lastBusy, h.lastTotal = busy, total
	host.MemUtil = readMemUtil(orDefault(h.ProcMem, "/proc/meminfo"))

	var out map[string]TenantStat
	if h.Containers != nil {
		cur, err := h.Containers.Stats(ctx)
		if err == nil {
			out = make(map[string]TenantStat, len(cur))
			dt := now.Sub(h.lastAt).Seconds()
			for t, c := range cur {
				ts := TenantStat{MemMB: float64(c.MemBytes) / (1 << 20)}
				if prev, ok := h.lastContainer[t]; ok && dt > 0 && c.CPUNanos >= prev.CPUNanos {
					ts.CPUCores = float64(c.CPUNanos-prev.CPUNanos) / 1e9 / dt
				}
				out[t] = ts
			}
			h.lastContainer = cur
		}
	}
	h.lastAt = now
	return host, out
}

func orDefault(s, d string) string {
	if s == "" {
		return d
	}
	return s
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

// readCPUStat returns busy and total jiffies from the aggregate "cpu" line.
func readCPUStat(path string) (busy, total uint64) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fs := strings.Fields(sc.Text())
		if len(fs) < 5 || fs[0] != "cpu" {
			continue
		}
		var idle uint64
		for i, v := range fs[1:] {
			n, _ := strconv.ParseUint(v, 10, 64)
			if i >= 8 { // guest columns are already inside user/nice
				break
			}
			total += n
			if i == 3 || i == 4 { // idle, iowait
				idle += n
			}
		}
		return total - idle, total
	}
	return 0, 0
}

func readMemUtil(path string) float64 {
	f, err := os.Open(path)
	if err != nil {
		return 0
	}
	defer f.Close()
	var tot, avail float64
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fs := strings.Fields(sc.Text())
		if len(fs) < 2 {
			continue
		}
		v, _ := strconv.ParseFloat(fs[1], 64)
		switch fs[0] {
		case "MemTotal:":
			tot = v
		case "MemAvailable:":
			avail = v
		}
	}
	if tot == 0 {
		return 0
	}
	return clamp01(1 - avail/tot)
}
