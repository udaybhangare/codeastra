package policy

import (
	"context"
	"log/slog"
	"sync/atomic"
	"time"
)

// Notifier blocks delivering a signal on ch for every policy change until ctx ends or the
// connection drops (then it returns an error and Cache reconnects).
type Notifier interface {
	Listen(ctx context.Context, ch chan<- struct{}) error
}

// Cache holds an immutable snapshot behind an atomic pointer. Get never touches Postgres.
type Cache struct {
	store    Store
	notifier Notifier
	snap     atomic.Pointer[map[string]Policy]

	// Sleep is the reconnect backoff; injectable for tests.
	Sleep   func(ctx context.Context, d time.Duration)
	Backoff time.Duration
	Log     *slog.Logger
}

func NewCache(store Store, n Notifier) *Cache {
	c := &Cache{store: store, notifier: n, Backoff: time.Second, Log: slog.Default(),
		Sleep: func(ctx context.Context, d time.Duration) {
			t := time.NewTimer(d)
			defer t.Stop()
			select {
			case <-ctx.Done():
			case <-t.C:
			}
		}}
	empty := map[string]Policy{}
	c.snap.Store(&empty)
	return c
}

// Get returns the cached policy for a tenant. Lock-free, no I/O.
func (c *Cache) Get(tenantID string) (Policy, bool) {
	p, ok := (*c.snap.Load())[tenantID]
	return p, ok
}

// Snapshot returns the current immutable map; callers must not modify it.
func (c *Cache) Snapshot() map[string]Policy { return *c.snap.Load() }

// Reload reads all policies and atomically swaps the snapshot. Invalid rows are skipped
// (and logged) so one bad row cannot take down enforcement for everyone.
func (c *Cache) Reload(ctx context.Context) error {
	list, err := c.store.List(ctx)
	if err != nil {
		return err
	}
	m := make(map[string]Policy, len(list))
	for _, p := range list {
		if err := p.Validate(); err != nil {
			c.Log.Warn("skipping invalid policy", "tenant", p.TenantID, "err", err)
			continue
		}
		m[p.TenantID] = p
	}
	c.snap.Store(&m)
	return nil
}

// Run loads the initial snapshot, then reloads on every notification until ctx ends.
// It reconnects (and does a full reload, to catch changes missed while disconnected).
func (c *Cache) Run(ctx context.Context) error {
	if err := c.Reload(ctx); err != nil {
		return err
	}
	for ctx.Err() == nil {
		ch := make(chan struct{}, 1)
		lctx, cancel := context.WithCancel(ctx)
		errc := make(chan error, 1)
		go func() { errc <- c.notifier.Listen(lctx, ch) }()

		// Reload once the LISTEN is active would be ideal; reloading after any notification
		// plus at (re)connect time covers the gap.
		if err := c.Reload(ctx); err != nil {
			c.Log.Warn("policy reload failed", "err", err)
		}
	loop:
		for {
			select {
			case <-ctx.Done():
				cancel()
				return nil
			case <-ch:
				if err := c.Reload(ctx); err != nil {
					c.Log.Warn("policy reload failed", "err", err)
				}
			case err := <-errc:
				if err != nil && ctx.Err() == nil {
					c.Log.Warn("policy listener dropped", "err", err)
				}
				break loop
			}
		}
		cancel()
		c.Sleep(ctx, c.Backoff)
	}
	return nil
}
