package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/bulkhead/platform/internal/auth"
	"github.com/bulkhead/platform/internal/metrics"
	"github.com/bulkhead/platform/internal/throttle"
	"github.com/gorilla/websocket"
)

const clientQueue = 16 // messages buffered per WebSocket client

// msg is one encoded outbound message; snapshots are droppable.
type msg struct {
	data     []byte
	snapshot bool
}

// client is one WebSocket subscriber with a bounded queue. A slow client only
// ever loses its own oldest snapshots (then oldest messages); it never blocks
// the broadcaster or other clients.
type client struct {
	mu     sync.Mutex
	q      []msg
	wake   chan struct{}
	closed bool
}

func newClient() *client { return &client{wake: make(chan struct{}, 1)} }

func (c *client) push(m msg) {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	if len(c.q) >= clientQueue {
		drop := 0 // fall back to the oldest message of any kind
		for i, e := range c.q {
			if e.snapshot {
				drop = i
				break
			}
		}
		c.q = append(c.q[:drop], c.q[drop+1:]...)
	}
	c.q = append(c.q, m)
	c.mu.Unlock()
	select {
	case c.wake <- struct{}{}:
	default:
	}
}

func (c *client) pop() (msg, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.q) == 0 {
		return msg{}, false
	}
	m := c.q[0]
	c.q = c.q[1:]
	return m, true
}

// Stream is the admin WebSocket hub: 1 Hz snapshots plus immediate events,
// run_progress and run_result messages (contracts/ws-messages.schema.json).
type Stream struct {
	mu      sync.Mutex
	clients map[*client]struct{}
	last    []byte // latest snapshot, sent first to new clients (reconnect-safe)
}

func NewStream() *Stream { return &Stream{clients: map[*client]struct{}{}} }

// Broadcast encodes v and queues it for every client. Non-snapshot messages are
// delivered immediately (the writer goroutines are woken).
func (s *Stream) Broadcast(v map[string]any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	m := msg{data: b, snapshot: v["type"] == "snapshot"}
	s.mu.Lock()
	if m.snapshot {
		s.last = b
	}
	cs := make([]*client, 0, len(s.clients))
	for c := range s.clients {
		cs = append(cs, c)
	}
	s.mu.Unlock()
	for _, c := range cs {
		c.push(m)
	}
}

// Clients is the number of connected subscribers.
func (s *Stream) Clients() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.clients)
}

func (s *Stream) add(c *client) {
	s.mu.Lock()
	s.clients[c] = struct{}{}
	last := s.last
	s.mu.Unlock()
	if last != nil {
		c.push(msg{data: last, snapshot: true})
	}
}

func (s *Stream) remove(c *client) {
	s.mu.Lock()
	delete(s.clients, c)
	s.mu.Unlock()
	c.mu.Lock()
	c.closed = true
	c.mu.Unlock()
}

// Run emits a snapshot every interval until ctx ends, and forwards controller
// events from hub as they happen.
func (s *Stream) Run(ctx context.Context, every time.Duration, snap func() map[string]any, hub *throttle.Hub) {
	var evs <-chan throttle.Event
	if hub != nil {
		ch, cancel := hub.Subscribe()
		defer cancel()
		evs = ch
	}
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if snap != nil {
				s.Broadcast(snap())
			}
		case e, ok := <-evs:
			if !ok {
				evs = nil
				continue
			}
			s.Broadcast(throttle.WSMessage(e))
		}
	}
}

// BuildSnapshot renders a metrics snapshot as the schema's `snapshot` message.
func BuildSnapshot(at time.Time, snap metrics.Snapshot, isolationOn bool,
	tier func(string) string, level func(string) int) map[string]any {
	tenants := make([]map[string]any, 0, len(snap.Windows))
	for _, w := range snap.Windows {
		tenants = append(tenants, map[string]any{
			"tenant_id": w.Tenant, "tier": tier(w.Tenant), "level": level(w.Tenant),
			"rps": float64(w.Requests), "ok_rps": float64(w.OK), "rejected_rps": float64(w.Rejected),
			"cost_units_s": w.CostUnit, "queue_depth": w.QueueDepth, "inflight": w.InFlight,
			"p50_ms": w.P50, "p95_ms": w.P95, "p99_ms": w.P99, "queue_wait_p95_ms": w.QueueWaitP95,
			"cpu_share": clamp01(w.CPUShare), "mem_mb": w.MemMB, "bytes_s": w.Bytes,
		})
	}
	mode := "off"
	if isolationOn {
		mode = "on"
	}
	jain := snap.Fairness.Jain
	if jain == 0 {
		jain = 1
	}
	return map[string]any{
		"type": "snapshot", "ts": at.UTC().Format(time.RFC3339), "isolation": mode,
		"host":     map[string]any{"cpu_util": clamp01(snap.Host.CPUUtil), "mem_util": clamp01(snap.Host.MemUtil)},
		"fairness": map[string]any{"jain": clamp01(jain), "victim_inflation": snap.Fairness.VictimInflation},
		"tenants":  tenants,
	}
}

func clamp01(v float64) float64 {
	switch {
	case v < 0:
		return 0
	case v > 1:
		return 1
	}
	return v
}

func (s *Server) wsUpgrader() *websocket.Upgrader {
	return &websocket.Upgrader{CheckOrigin: func(r *http.Request) bool {
		o := r.Header.Get("Origin")
		return o == "" || len(s.CORSOrigins) == 0 || s.originAllowed(o)
	}}
}

// GET /admin/stream?token=<admin JWT>. Browsers cannot set Authorization on a
// WebSocket, so the token may be a query parameter. Admin-only: the stream
// carries every tenant, so it is never exposed to tenant tokens.
func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
	tok, ok := bearer(r)
	if !ok {
		tok = r.URL.Query().Get("token")
	}
	c, err := s.AdminSigner.Verify(tok)
	if tok == "" || err != nil || c.Role != auth.RoleAdmin {
		writeErr(w, 403, "forbidden", "admin credential required")
		return
	}
	conn, err := s.wsUpgrader().Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	cl := newClient()
	s.Stream.add(cl)
	defer s.Stream.remove(cl)
	gone := make(chan struct{})
	go func() { // reader: detects client close
		defer close(gone)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
	for {
		for {
			m, ok := cl.pop()
			if !ok {
				break
			}
			_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := conn.WriteMessage(websocket.TextMessage, m.data); err != nil {
				return
			}
		}
		select {
		case <-gone:
			return
		case <-cl.wake:
		}
	}
}
