package workerpool

import (
	"fmt"
	"regexp"

	"github.com/bulkhead/platform/internal/policy"
)

const (
	cpuPeriod = 100_000 // µs, Docker default CFS period
	// The daemon rejects Memory<6MB (so -1 is refused on update). "Unlimited"
	// is therefore a ceiling far above any host's RAM.
	unlimitedMem = int64(1) << 40
)

var tenantIDRe = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$`)

// Spec is one tenant's container sizing. Zero CPUs/MemoryMB/PidsLimit = unlimited.
type Spec struct {
	TenantID  string
	CPUs      float64
	MemoryMB  int64
	PidsLimit int64
}

// SpecFromPolicy maps a tenant policy onto container limits (hard ceiling).
func SpecFromPolicy(p policy.Policy, pids int64) Spec {
	return Spec{TenantID: p.TenantID, CPUs: p.LimitCPU, MemoryMB: int64(p.LimitMemMB), PidsLimit: pids}
}

func (s Spec) validate() error {
	if !tenantIDRe.MatchString(s.TenantID) {
		return fmt.Errorf("workerpool: invalid tenant id %q", s.TenantID)
	}
	if s.CPUs < 0 || s.MemoryMB < 0 || s.PidsLimit < 0 {
		return fmt.Errorf("workerpool: negative limit in spec for %q", s.TenantID)
	}
	return nil
}

// quota converts cores to a CFS quota. CPU is expressed as quota/period (not
// NanoCpus) because Docker refuses to un-set NanoCpus on a live container,
// which Isolation OFF needs.
func quota(cpus float64) int64 {
	q := int64(cpus * cpuPeriod)
	if q < 1000 { // kernel minimum quota is 1 ms
		q = 1000
	}
	return q
}

// createResources is the limit set applied at container creation. Unlimited
// fields are simply omitted.
func createResources(s Spec) resources {
	var r resources
	if s.CPUs > 0 {
		r.CpuPeriod, r.CpuQuota = cpuPeriod, quota(s.CPUs)
	}
	if s.MemoryMB > 0 {
		r.Memory = s.MemoryMB << 20
		r.MemorySwap = r.Memory // swap == memory, i.e. no swap
	}
	r.PidsLimit = s.PidsLimit
	return r
}

// updateResources is the body for a live `docker update`. Unlimited fields are
// sent as explicit unlimited values so a previously limited container is un-limited.
func updateResources(s Spec) resources {
	r := resources{}
	r.CpuPeriod = cpuPeriod
	if s.CPUs > 0 {
		r.CpuQuota = quota(s.CPUs)
	} else {
		r.CpuQuota = -1
	}
	if s.MemoryMB > 0 {
		r.Memory = s.MemoryMB << 20
		r.MemorySwap = r.Memory
	} else {
		r.Memory, r.MemorySwap = unlimitedMem, unlimitedMem
	}
	if s.PidsLimit > 0 {
		r.PidsLimit = s.PidsLimit
	} else {
		r.PidsLimit = -1
	}
	return r
}

// EventKind classifies what happened to a tenant container.
type EventKind string

const (
	EventOOMKilled EventKind = "oom_killed"
	EventExited    EventKind = "exited"
	EventUnhealthy EventKind = "unhealthy"
	EventRestarted EventKind = "restarted"
)

// Event is emitted by the pool's watcher.
type Event struct {
	Tenant   string
	Kind     EventKind
	ExitCode int
	Unix     int64 // from the Docker event
}

// classify decides whether a die event was an OOM kill. Docker emits `oom`
// just before `die`; exit 137 alone is ambiguous (plain SIGKILL), so OOM
// requires the oom event or State.OOMKilled.
func classify(sawOOM, stateOOM bool, exitCode int) EventKind {
	if sawOOM || stateOOM {
		return EventOOMKilled
	}
	return EventExited
}
