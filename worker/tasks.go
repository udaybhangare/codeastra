package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

// Limits that keep a typo from wedging a test box; real abuse is the cgroup's job.
const (
	maxBurnMS  = 600_000
	maxThreads = 16
	maxIOKB    = 256 * 1024
	chunkMB    = 1
)

// Worker executes tasks. Zero values are usable except HTTP/DBProxy for db-query.
type Worker struct {
	TenantID string
	DBProxy  string // platform DB proxy URL (POST /internal/db)
	Secret   string // per-worker secret sent as X-Worker-Secret
	HTTP     *http.Client
}

// Result is the JSON body of POST /run.
type Result struct {
	OK        bool    `json:"ok"`
	Task      string  `json:"task"`
	Error     string  `json:"error,omitempty"`
	WallMS    float64 `json:"wall_ms"`
	CPUMS     float64 `json:"cpu_ms"`      // process CPU time (user+sys) consumed during the call
	MemPeakMB float64 `json:"mem_peak_mb"` // peak RSS seen during the call
	DBMS      float64 `json:"db_ms,omitempty"`
	Bytes     int64   `json:"bytes,omitempty"`
	Detail    string  `json:"detail,omitempty"`
}

// processCPU returns CPU time used by the whole process so far.
func processCPU() time.Duration {
	var ru syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &ru); err != nil {
		return 0
	}
	return time.Duration(ru.Utime.Nano() + ru.Stime.Nano())
}

// threadCPU returns CPU time of the calling OS thread (CLOCK_THREAD_CPUTIME_ID).
func threadCPU() time.Duration {
	var ts syscall.Timespec
	const clockThreadCPUTimeID = 3
	_, _, e := syscall.Syscall(syscall.SYS_CLOCK_GETTIME, clockThreadCPUTimeID, uintptr(unsafe.Pointer(&ts)), 0)
	if e != 0 {
		return 0
	}
	return time.Duration(ts.Nano())
}

// rssMB reads VmRSS from /proc/self/status.
func rssMB() float64 {
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			f := strings.Fields(line)
			if len(f) >= 2 {
				kb, _ := strconv.ParseFloat(f[1], 64)
				return kb / 1024
			}
		}
	}
	return 0
}

// Run executes one task and fills the resource report.
func (w *Worker) Run(ctx context.Context, task string, params map[string]float64, kind string) Result {
	res := Result{Task: task}
	cpu0, t0 := processCPU(), time.Now()

	var err error
	switch task {
	case "echo":
		res.OK = true
	case "cpu-burn":
		err = cpuBurn(ctx, int(params["ms"]), int(params["threads"]))
	case "mem-alloc":
		res.MemPeakMB, err = memAlloc(ctx, int(params["mb"]), time.Duration(params["hold_ms"])*time.Millisecond)
	case "io-heavy":
		res.Bytes, err = ioHeavy(int(params["kb"]))
	case "db-query":
		res.DBMS, res.Detail, err = w.dbQuery(ctx, kind, params["n"])
	default:
		err = fmt.Errorf("unknown task %q", task)
	}

	res.WallMS = float64(time.Since(t0)) / float64(time.Millisecond)
	res.CPUMS = float64(processCPU()-cpu0) / float64(time.Millisecond)
	if res.MemPeakMB == 0 {
		res.MemPeakMB = rssMB()
	}
	if err != nil {
		res.Error = err.Error()
	} else {
		res.OK = true
	}
	return res
}

// cpuBurn spins until each of `threads` goroutines has consumed `ms` of *CPU*
// time (not wall time), so a throttled container takes longer, like real work.
func cpuBurn(ctx context.Context, ms, threads int) error {
	if ms <= 0 || ms > maxBurnMS {
		return fmt.Errorf("ms must be 1..%d", maxBurnMS)
	}
	if threads <= 0 {
		threads = 1
	}
	if threads > maxThreads {
		return fmt.Errorf("threads must be <= %d", maxThreads)
	}
	var wg sync.WaitGroup
	for i := 0; i < threads; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			runtime.LockOSThread()
			defer runtime.UnlockOSThread()
			target := threadCPU() + time.Duration(ms)*time.Millisecond
			var x uint64 = 1
			for n := 0; ; n++ {
				for j := 0; j < 20_000; j++ {
					x = x*6364136223846793005 + 1442695040888963407
				}
				if n%8 == 0 {
					if threadCPU() >= target || ctx.Err() != nil {
						break
					}
				}
			}
			sink = x
		}()
	}
	wg.Wait()
	return ctx.Err()
}

var sink uint64

// memAlloc allocates `mb` MB in 1 MB chunks, touching every page so it is
// resident, holds it, then releases. Chunking makes an OOM kill land mid-way.
func memAlloc(ctx context.Context, mb int, hold time.Duration) (peakMB float64, err error) {
	if mb <= 0 {
		return 0, errors.New("mb must be > 0")
	}
	chunks := make([][]byte, 0, mb/chunkMB+1)
	for i := 0; i < mb; i += chunkMB {
		c := make([]byte, chunkMB<<20)
		for p := 0; p < len(c); p += 4096 {
			c[p] = 1
		}
		chunks = append(chunks, c)
	}
	peakMB = rssMB()
	select {
	case <-time.After(hold):
	case <-ctx.Done():
		err = ctx.Err()
	}
	runtime.KeepAlive(chunks)
	chunks = nil
	runtime.GC()
	return peakMB, err
}

// ioHeavy builds and hashes a kb-KB payload (CPU + memory + "bytes produced").
func ioHeavy(kb int) (int64, error) {
	if kb <= 0 || kb > maxIOKB {
		return 0, fmt.Errorf("kb must be 1..%d", maxIOKB)
	}
	buf := make([]byte, 1024)
	for i := range buf {
		buf[i] = byte(i * 31)
	}
	h := sha256.New()
	for i := 0; i < kb; i++ {
		buf[0] = byte(i)
		h.Write(buf)
	}
	_ = h.Sum(nil)
	return int64(kb) * 1024, nil
}

// dbQuery asks the platform DB proxy to run a canned query of the given kind.
func (w *Worker) dbQuery(ctx context.Context, kind string, n float64) (float64, string, error) {
	if kind == "" {
		kind = "point"
	}
	if w.DBProxy == "" {
		return 0, "", errors.New("db proxy not configured (DB_PROXY_URL)")
	}
	body, _ := json.Marshal(map[string]any{"tenant": w.TenantID, "kind": kind, "n": n})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.DBProxy, bytes.NewReader(body))
	if err != nil {
		return 0, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Worker-Secret", w.Secret)
	t0 := time.Now()
	resp, err := w.HTTP.Do(req)
	ms := float64(time.Since(t0)) / float64(time.Millisecond)
	if err != nil {
		return ms, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return ms, "", fmt.Errorf("db proxy status %d", resp.StatusCode)
	}
	return ms, kind, nil
}
