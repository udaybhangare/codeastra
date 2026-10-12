package ratelimit

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *fakeClock) add(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

var ctx = context.Background()

func TestMemoryBurstRefillRefund(t *testing.T) {
	c := &fakeClock{t: time.Unix(1000, 0)}
	l := NewMemory(c.now)
	p := Params{Rate: 10, Burst: 5}
	for i := 0; i < 5; i++ {
		if !l.Take(ctx, "k", 1, p).Allowed {
			t.Fatalf("take %d should pass (burst)", i)
		}
	}
	r := l.Take(ctx, "k", 1, p)
	if r.Allowed || r.RetryAfter != 100*time.Millisecond {
		t.Fatalf("want deny retry 100ms, got %+v", r)
	}
	c.add(300 * time.Millisecond) // +3 tokens
	for i := 0; i < 3; i++ {
		if !l.Take(ctx, "k", 1, p).Allowed {
			t.Fatalf("refilled take %d", i)
		}
	}
	if l.Take(ctx, "k", 1, p).Allowed {
		t.Fatal("should be empty")
	}
	l.Refund(ctx, "k", 100, p) // capped at burst
	n := 0
	for l.Take(ctx, "k", 1, p).Allowed {
		n++
	}
	if n != 5 {
		t.Fatalf("refund must cap at burst, got %d", n)
	}
	if !l.Take(ctx, "other", 5, p).Allowed {
		t.Fatal("keys are independent")
	}
}

func TestMemoryNoOverAdmissionConcurrent(t *testing.T) {
	c := &fakeClock{t: time.Unix(1000, 0)} // frozen: no refill
	l := NewMemory(c.now)
	p := Params{Rate: 1, Burst: 50}
	var ok atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if l.Take(ctx, "k", 1, p).Allowed {
				ok.Add(1)
			}
		}()
	}
	wg.Wait()
	if ok.Load() != 50 {
		t.Fatalf("admitted %d, want exactly burst 50", ok.Load())
	}
}

// failingScripter simulates Redis being down.
type failingScripter struct{ calls atomic.Int64 }

func (f *failingScripter) Eval(context.Context, string, []string, ...interface{}) *redis.Cmd {
	f.calls.Add(1)
	cmd := redis.NewCmd(ctx)
	cmd.SetErr(errors.New("connection refused"))
	return cmd
}
func (f *failingScripter) EvalSha(c context.Context, s string, k []string, a ...interface{}) *redis.Cmd {
	return f.Eval(c, s, k, a...)
}
func (f *failingScripter) EvalRO(c context.Context, s string, k []string, a ...interface{}) *redis.Cmd {
	return f.Eval(c, s, k, a...)
}
func (f *failingScripter) EvalShaRO(c context.Context, s string, k []string, a ...interface{}) *redis.Cmd {
	return f.Eval(c, s, k, a...)
}
func (f *failingScripter) ScriptExists(context.Context, ...string) *redis.BoolSliceCmd {
	cmd := redis.NewBoolSliceCmd(ctx)
	cmd.SetErr(errors.New("down"))
	return cmd
}
func (f *failingScripter) ScriptLoad(context.Context, string) *redis.StringCmd {
	cmd := redis.NewStringCmd(ctx)
	cmd.SetErr(errors.New("down"))
	return cmd
}

func TestRedisDownFallsBackToLocal(t *testing.T) {
	c := &fakeClock{t: time.Unix(1000, 0)}
	f := &failingScripter{}
	r := NewRedis(f, c.now, nil)
	p := Params{Rate: 1, Burst: 3}
	got := 0
	for i := 0; i < 10; i++ {
		if r.Take(ctx, "k", 1, p).Allowed {
			got++
		}
	}
	if got != 3 {
		t.Fatalf("local fallback should still enforce burst, admitted %d", got)
	}
	if !r.Degraded() {
		t.Fatal("must report degraded")
	}
	if f.calls.Load() == 0 {
		t.Fatal("redis should have been tried")
	}
}
