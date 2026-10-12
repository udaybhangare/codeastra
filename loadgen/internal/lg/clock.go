package lg

import (
	"bytes"
	"context"
	"io"
	"sync"
	"time"
)

func bytesReader(b []byte) io.Reader { return bytes.NewReader(b) }

// Clock is injected so schedule/timing logic never calls time.Now directly.
type Clock interface {
	Now() time.Time
	// SleepUntil blocks until t or ctx is done; returns ctx.Err() if cancelled.
	SleepUntil(ctx context.Context, t time.Time) error
}

type RealClock struct{}

func (RealClock) Now() time.Time { return time.Now() }

func (RealClock) SleepUntil(ctx context.Context, t time.Time) error {
	d := time.Until(t)
	if d <= 0 {
		return ctx.Err()
	}
	tm := time.NewTimer(d)
	defer tm.Stop()
	select {
	case <-tm.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// FakeClock advances instantly on SleepUntil (for tests).
type FakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func NewFakeClock(t time.Time) *FakeClock { return &FakeClock{now: t} }

func (f *FakeClock) Now() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.now
}

func (f *FakeClock) SleepUntil(ctx context.Context, t time.Time) error {
	f.mu.Lock()
	if t.After(f.now) {
		f.now = t
	}
	f.mu.Unlock()
	return ctx.Err()
}
