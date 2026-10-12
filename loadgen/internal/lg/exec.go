package lg

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

// Outcome is what a Sender reports for one HTTP attempt.
type Outcome struct {
	Status      int // 0 = transport error
	Reason      string
	RetryAfter  time.Duration
	Level       int // X-Throttle-Level, -1 if absent
	QueueWaitMs float64
	Err         string
}

func (o Outcome) OK() bool       { return o.Status >= 200 && o.Status < 300 }
func (o Outcome) Rejected() bool { return o.Status == 429 || o.Status == 503 }

// Sender performs one attempt. Implementations must be safe for concurrent use.
type Sender interface {
	Do(ctx context.Context, r Request) Outcome
}

// Result is one recorded attempt. Latency is measured from the *intended*
// send time (open loop / no coordinated omission); retries from their own start.
type Result struct {
	Seq         int
	Tenant      string
	Phase       string
	Task        string
	Attempt     int
	At          time.Duration // intended offset (attempt 0) or actual offset (retries)
	Status      int
	Reason      string
	Level       int
	QueueWaitMs float64
	LatencyMs   float64
	Dropped     bool // client-side saturation: never sent
	Err         string
}

// ExecConfig tunes the executor.
type ExecConfig struct {
	MaxInflight     int           // cap on concurrent goroutines; excess is recorded as Dropped
	HonorRetries    int           // retries (after Retry-After) for well-behaved profiles
	StormRetries    int           // immediate retries for retry_without_backoff profiles
	MaxRetryAfter   time.Duration // cap on honored Retry-After
	DefaultRetryAft time.Duration
	Drain           time.Duration // wait for stragglers after the last arrival
}

func DefaultExecConfig() ExecConfig {
	return ExecConfig{MaxInflight: 20000, HonorRetries: 2, StormRetries: 5,
		MaxRetryAfter: 5 * time.Second, DefaultRetryAft: time.Second, Drain: 15 * time.Second}
}

// Progress is a live counter snapshot.
type Progress struct {
	Elapsed  time.Duration
	Sent     int64
	OK       int64
	Rejected int64
	Errors   int64
	Dropped  int64
}

// ExecStats is run-level dispatch accuracy.
type ExecStats struct {
	Scheduled int
	Sent      int64
	MaxLag    time.Duration // worst (actual send − intended send)
	SumLag    time.Duration
	FirstSend time.Duration
	LastSend  time.Duration
	Dropped   int64
}

type Executor struct {
	Clock    Clock
	Sender   Sender
	Cfg      ExecConfig
	Progress func(Progress) // called ~1/s from a helper goroutine; may be nil
}

// Run dispatches reqs open-loop: it never waits for a response before the
// next arrival. Returns all attempts (unordered) and dispatch stats.
func (e *Executor) Run(ctx context.Context, reqs []Request) ([]Result, ExecStats) {
	cfg := e.Cfg
	if cfg.MaxInflight <= 0 {
		cfg = DefaultExecConfig()
	}
	var (
		mu                           sync.Mutex
		results                      = make([]Result, 0, len(reqs)+len(reqs)/8)
		wg                           sync.WaitGroup
		sem                          = make(chan struct{}, cfg.MaxInflight)
		sent, okN, rejN, errN, dropN atomic.Int64
	)
	start := e.Clock.Now()
	st := ExecStats{Scheduled: len(reqs)}
	record := func(r Result) {
		mu.Lock()
		results = append(results, r)
		mu.Unlock()
		switch {
		case r.Dropped:
			dropN.Add(1)
		case r.Status >= 200 && r.Status < 300:
			okN.Add(1)
		case r.Status == 429 || r.Status == 503:
			rejN.Add(1)
		default:
			errN.Add(1)
		}
	}

	stop := make(chan struct{})
	if e.Progress != nil {
		go func() {
			t := time.NewTicker(time.Second)
			defer t.Stop()
			for {
				select {
				case <-stop:
					return
				case <-t.C:
					e.Progress(Progress{e.Clock.Now().Sub(start), sent.Load(), okN.Load(), rejN.Load(), errN.Load(), dropN.Load()})
				}
			}
		}()
	}

	attempt := func(r Request, n int, intended time.Time) Outcome {
		o := e.Sender.Do(ctx, r)
		record(Result{
			Seq: r.Seq, Tenant: r.Tenant, Phase: r.Phase, Task: r.Task, Attempt: n,
			At: intended.Sub(start), Status: o.Status, Reason: o.Reason, Level: o.Level,
			QueueWaitMs: o.QueueWaitMs, LatencyMs: float64(e.Clock.Now().Sub(intended)) / float64(time.Millisecond),
			Err: o.Err,
		})
		return o
	}

	for _, r := range reqs {
		intended := start.Add(r.Offset)
		if err := e.Clock.SleepUntil(ctx, intended); err != nil {
			break
		}
		lag := e.Clock.Now().Sub(intended)
		st.SumLag += lag
		if lag > st.MaxLag {
			st.MaxLag = lag
		}
		if sent.Load() == 0 {
			st.FirstSend = r.Offset
		}
		st.LastSend = r.Offset
		sent.Add(1)
		select {
		case sem <- struct{}{}:
		default:
			record(Result{Seq: r.Seq, Tenant: r.Tenant, Phase: r.Phase, Task: r.Task, At: r.Offset, Dropped: true, Level: -1, Err: "client_saturated"})
			continue
		}
		wg.Add(1)
		go func(r Request, intended time.Time) {
			defer wg.Done()
			defer func() { <-sem }()
			o := attempt(r, 0, intended)
			max, wait := cfg.HonorRetries, time.Duration(0)
			if r.IgnoreRetry {
				max = cfg.StormRetries
			}
			for n := 1; n <= max && o.Rejected(); n++ {
				if !r.IgnoreRetry {
					wait = o.RetryAfter
					if wait <= 0 {
						wait = cfg.DefaultRetryAft
					}
					if wait > cfg.MaxRetryAfter {
						wait = cfg.MaxRetryAfter
					}
					if e.Clock.SleepUntil(ctx, e.Clock.Now().Add(wait)) != nil {
						return
					}
				}
				if ctx.Err() != nil {
					return
				}
				o = attempt(r, n, e.Clock.Now())
			}
		}(r, intended)
	}

	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(cfg.Drain):
	}
	close(stop)
	st.Sent = sent.Load()
	st.Dropped = dropN.Load()
	mu.Lock()
	defer mu.Unlock()
	return append([]Result(nil), results...), st
}
