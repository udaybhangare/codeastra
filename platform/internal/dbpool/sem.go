package dbpool

import (
	"context"
	"sync"
)

// sem is a FIFO counting semaphore whose capacity is supplied on each acquire, so a policy
// change takes effect immediately without rebuilding it.
type sem struct {
	mu      sync.Mutex
	held    int
	waiters []chan struct{}
}

func (s *sem) acquire(ctx context.Context, capacity int) error {
	s.mu.Lock()
	if s.held < capacity && len(s.waiters) == 0 {
		s.held++
		s.mu.Unlock()
		return nil
	}
	ch := make(chan struct{})
	s.waiters = append(s.waiters, ch)
	s.mu.Unlock()

	select {
	case <-ch:
		return nil // slot was handed to us by release
	case <-ctx.Done():
		s.mu.Lock()
		defer s.mu.Unlock()
		for i, w := range s.waiters {
			if w == ch {
				s.waiters = append(s.waiters[:i], s.waiters[i+1:]...)
				return ctx.Err()
			}
		}
		// Already handed off between the timeout and taking the lock: we own the slot.
		return nil
	}
}

// release hands the slot straight to the oldest waiter, if any.
func (s *sem) release() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.waiters) > 0 {
		close(s.waiters[0])
		s.waiters = s.waiters[1:]
		return
	}
	s.held--
}
