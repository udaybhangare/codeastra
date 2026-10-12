// Package ratelimit provides token buckets: an in-memory one (injected clock) and a
// Redis-backed one for correctness across replicas that degrades to memory.
package ratelimit

import (
	"context"
	"math"
	"sync"
	"time"
)

// Params describe one bucket: refill Rate tokens/s up to Burst tokens.
type Params struct {
	Rate  float64
	Burst float64
}

// Result of a Take. RetryAfter is how long until n tokens would be available.
type Result struct {
	Allowed    bool
	RetryAfter time.Duration
}

// Limiter is a keyed token bucket. Take is all-or-nothing; Refund returns tokens
// (capped at Burst) when a later admission layer rejects the request.
type Limiter interface {
	Take(ctx context.Context, key string, n float64, p Params) Result
	Refund(ctx context.Context, key string, n float64, p Params)
}

// Clock is the injected time source.
type Clock func() time.Time

type bucket struct {
	tokens float64
	last   time.Time
}

// Memory is a goroutine-safe in-memory Limiter. Buckets are created full.
type Memory struct {
	now Clock
	mu  sync.Mutex
	m   map[string]*bucket
}

func NewMemory(now Clock) *Memory { return &Memory{now: now, m: map[string]*bucket{}} }

func (l *Memory) refill(key string, p Params) *bucket {
	t := l.now()
	b, ok := l.m[key]
	if !ok {
		b = &bucket{tokens: p.Burst, last: t}
		l.m[key] = b
		return b
	}
	if dt := t.Sub(b.last).Seconds(); dt > 0 {
		b.tokens = math.Min(p.Burst, b.tokens+dt*p.Rate)
		b.last = t
	}
	if b.tokens > p.Burst { // policy shrank
		b.tokens = p.Burst
	}
	return b
}

func (l *Memory) Take(_ context.Context, key string, n float64, p Params) Result {
	l.mu.Lock()
	defer l.mu.Unlock()
	b := l.refill(key, p)
	if b.tokens >= n {
		b.tokens -= n
		return Result{Allowed: true}
	}
	return Result{RetryAfter: wait(n-b.tokens, p.Rate)}
}

func (l *Memory) Refund(_ context.Context, key string, n float64, p Params) {
	l.mu.Lock()
	defer l.mu.Unlock()
	b := l.refill(key, p)
	b.tokens = math.Min(p.Burst, b.tokens+n)
}

func wait(deficit, rate float64) time.Duration {
	if rate <= 0 {
		return time.Hour
	}
	return time.Duration(deficit / rate * float64(time.Second))
}
