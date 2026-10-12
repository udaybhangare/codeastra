package dbpool

import "sync"

type tenantStats struct {
	mu                     sync.Mutex
	held, peak             int
	queries, rejects       int64
	dbMSSum, connWaitMSSum float64
}

// Stats is a point-in-time copy of one tenant's DB usage.
type Stats struct {
	Queries, Rejects int64
	DBMS, ConnWaitMS float64 // cumulative
	Held, PeakHeld   int
}

func (p *Pool) tenantStats(t string) *tenantStats {
	p.mu.Lock()
	defer p.mu.Unlock()
	s, ok := p.stats[t]
	if !ok {
		s = &tenantStats{}
		p.stats[t] = s
	}
	return s
}

// Stats returns the tenant's cumulative counters.
func (p *Pool) Stats(tenant string) Stats {
	s := p.tenantStats(tenant)
	s.mu.Lock()
	defer s.mu.Unlock()
	return Stats{s.queries, s.rejects, s.dbMSSum, s.connWaitMSSum, s.held, s.peak}
}

func (s *tenantStats) hold() {
	s.mu.Lock()
	s.held++
	if s.held > s.peak {
		s.peak = s.held
	}
	s.mu.Unlock()
}
func (s *tenantStats) unhold() { s.mu.Lock(); s.held--; s.mu.Unlock() }
func (s *tenantStats) heldNow() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.held
}
func (s *tenantStats) record(r Result, rejected bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if rejected {
		s.rejects++
	} else {
		s.queries++
	}
	s.dbMSSum += r.DBMS
	s.connWaitMSSum += r.ConnWaitMS
}
