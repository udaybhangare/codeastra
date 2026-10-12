package throttle

import (
	"fmt"
	"strings"

	"github.com/bulkhead/platform/internal/policy"
)

// Explain renders the plain-English sentence for an event from its evidence,
// e.g. "rogue-ml throttled to Hard: used 71% CPU vs 20% entitlement;
// acme-shop p99 rose 6.2× (r=0.91)."
func Explain(e Event, _ policy.Policy) string {
	t := e.Tenant
	switch e.Reason {
	case ReasonPin:
		return fmt.Sprintf("%s pinned to %s by %s (automatic changes paused).", t, e.To, e.Actor)
	case ReasonUnpin:
		return fmt.Sprintf("%s unpinned by %s; staying at %s and recovering automatically.", t, e.Actor, e.To)
	case ReasonPanic:
		return fmt.Sprintf("%s shed to %s: panic mode is protecting paying tenants by throttling the free tier first.", t, e.To)
	case ReasonPanicClear:
		return fmt.Sprintf("%s released from panic shedding at %s; recovering automatically.", t, e.To)
	case ReasonRecovered:
		return fmt.Sprintf("%s eased from %s to %s: %s, limits recovering gradually.", t, e.From, e.To, noteOr(e, "no harm detected"))
	case ReasonRecovering:
		return fmt.Sprintf("%s limits recovering at %s: no harm detected, raising limits step by step.", t, e.To)
	case ReasonLimitBreach:
		return fmt.Sprintf("%s quarantined: repeated resource-limit breaches (%s).", t, noteOr(e, "OOM/limit loop"))
	case ReasonPredicted:
		p := 0.0
		if e.Evidence.Predicted != nil {
			p = *e.Evidence.Predicted
		}
		return fmt.Sprintf("%s pre-emptively moved to %s: predictor forecasts overload (p=%.2f) before any neighbour was hurt.", t, e.To, p)
	}
	verb := "throttled to"
	if e.Reason == ReasonDetected {
		verb = "flagged at"
	}
	if e.Reason == ReasonReoffense {
		verb = "re-offended within 60s, throttled to"
	}
	return fmt.Sprintf("%s %s %s%s", t, verb, e.To, culpritClause(e.Evidence))
}

func culpritClause(ev Evidence) string {
	f := ev.Finding
	if f == nil {
		return "."
	}
	var parts []string
	// the resource that contributes most to the score
	best := -1
	for i, r := range f.Evidence.Resources {
		if best < 0 || r.Contribution > f.Evidence.Resources[best].Contribution {
			best = i
		}
	}
	corr := 0.0
	if best >= 0 {
		r := f.Evidence.Resources[best]
		corr = r.Corr
		parts = append(parts, fmt.Sprintf("used %.0f%% %s vs %.0f%% entitlement", r.Share*100, strings.ToUpper(r.Resource), r.Entitlement*100))
	}
	if len(f.Evidence.Victims) > 0 {
		v := f.Evidence.Victims[0]
		for _, x := range f.Evidence.Victims {
			if x.Inflation > v.Inflation {
				v = x
			}
		}
		s := fmt.Sprintf("%s p99 rose %.1f×", v.Tenant, v.Inflation)
		if best >= 0 {
			s += fmt.Sprintf(" (r=%.2f)", corr)
		}
		parts = append(parts, s)
	}
	if len(parts) == 0 {
		return "."
	}
	return ": " + strings.Join(parts, "; ") + "."
}

func noteOr(e Event, def string) string {
	if e.Evidence.Note != "" {
		return e.Evidence.Note
	}
	return def
}
