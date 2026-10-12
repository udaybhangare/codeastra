package throttle

import "sync"

// Hub fans events out to live subscribers (the admin WebSocket). It never
// blocks the controller: a slow subscriber just drops events.
type Hub struct {
	mu   sync.Mutex
	subs map[chan Event]struct{}
}

func NewHub() *Hub { return &Hub{subs: map[chan Event]struct{}{}} }

// Subscribe returns a buffered channel and a cancel func.
func (h *Hub) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, 64)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		if _, ok := h.subs[ch]; ok {
			delete(h.subs, ch)
			close(ch)
		}
		h.mu.Unlock()
	}
}

// Publish implements Publisher.
func (h *Hub) Publish(e Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- e:
		default:
		}
	}
}

// WSMessage renders an event as the contracts/ws-messages.schema.json "event".
func WSMessage(e Event) map[string]any {
	return map[string]any{
		"type": "event", "ts": e.TS, "kind": "throttle", "tenant_id": e.Tenant,
		"from_level": int(e.From), "to_level": int(e.To), "message": e.Explanation,
		"evidence": e.Evidence, "actions": e.Actions, "actor": e.Actor,
	}
}
