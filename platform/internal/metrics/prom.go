package metrics

import (
	"fmt"
	"net/http"
	"strings"
)

// Handler serves the latest closed window in Prometheus text format.
func (a *Aggregator) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		snap := a.Latest()
		var b strings.Builder
		g := func(name, tenant string, v float64) {
			fmt.Fprintf(&b, "bulkhead_%s{tenant=%q} %g\n", name, tenant, v)
		}
		for _, win := range snap.Windows {
			g("rps", win.Tenant, float64(win.Requests))
			g("rejected", win.Tenant, float64(win.Rejected))
			g("latency_p50_ms", win.Tenant, win.P50)
			g("latency_p95_ms", win.Tenant, win.P95)
			g("latency_p99_ms", win.Tenant, win.P99)
			g("queue_wait_p95_ms", win.Tenant, win.QueueWaitP95)
			g("cpu_share", win.Tenant, win.CPUShare)
			g("p99_inflation", win.Tenant, win.P99Inflation)
			c := a.Totals(win.Tenant)
			fmt.Fprintf(&b, "bulkhead_requests_total{tenant=%q} %d\n", win.Tenant, c.Requests)
		}
		fmt.Fprintf(&b, "bulkhead_host_cpu_util %g\nbulkhead_host_mem_util %g\n", snap.Host.CPUUtil, snap.Host.MemUtil)
		fmt.Fprintf(&b, "bulkhead_jain_index %g\nbulkhead_victim_p99_inflation %g\n", snap.Fairness.Jain, snap.Fairness.VictimInflation)
		fmt.Fprintf(&b, "bulkhead_events_dropped_total %d\n", a.Dropped())
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		_, _ = w.Write([]byte(b.String()))
	})
}
