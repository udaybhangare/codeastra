package admission

import (
	"encoding/json"
	"math"
	"net/http"
	"strconv"
)

// Status maps a reject reason to its HTTP status (429 = back off, 503 = unavailable).
func Status(r Reason) int {
	switch r {
	case ReasonQueueFull, ReasonQuarantine:
		return http.StatusServiceUnavailable
	default:
		return http.StatusTooManyRequests
	}
}

// WriteReject writes X-Reason, Retry-After (whole seconds, >= 1) and a JSON body.
func WriteReject(w http.ResponseWriter, d Decision) {
	secs := int(math.Ceil(d.RetryAfter.Seconds()))
	if secs < 1 {
		secs = 1
	}
	h := w.Header()
	h.Set("X-Reason", string(d.Reason))
	h.Set("Retry-After", strconv.Itoa(secs))
	h.Set("Content-Type", "application/json")
	w.WriteHeader(Status(d.Reason))
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": "rejected", "reason": d.Reason, "retry_after_s": secs})
}
