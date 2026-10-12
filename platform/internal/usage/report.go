package usage

import (
	"context"
	"errors"
	"math"
	"os"
	"sort"
	"strconv"
	"time"

	"github.com/bulkhead/platform/internal/cost"
)

// Disclaimer is attached to every report: these numbers are demo showback.
const Disclaimer = "Showback / estimate using demo rates. Not a financial system of record."

// MaxRange bounds one report query (rows are aggregated in memory).
const MaxRange = 24 * time.Hour

// RateCard prices usage in demo dollars.
//
// CPU and network are priced through cost units (their share of the cost
// formula); memory and database time are priced by their own meters instead,
// so nothing is charged twice.
type RateCard struct {
	PerCostUnit float64 // $ per cost unit (cpu + network share)
	PerGBs      float64 // $ per GB-second of memory
	PerDBs      float64 // $ per database-second
	// TierMultiplier scales the subtotal per tier (missing tier = 1).
	TierMultiplier map[string]float64
	// FreeCostUnits is the per-report-window allowance, expressed in cost units
	// priced at PerCostUnit and credited against the subtotal (missing tier = 0).
	FreeCostUnits map[string]float64
}

// DefaultRateCard is the demo card; the three base rates can be set from env.
func DefaultRateCard() RateCard {
	f := func(k string, def float64) float64 {
		if v, err := strconv.ParseFloat(os.Getenv(k), 64); err == nil && v >= 0 {
			return v
		}
		return def
	}
	return RateCard{
		PerCostUnit:    f("RATE_PER_COST_UNIT", 0.00002),
		PerGBs:         f("RATE_PER_GB_S", 0.0000167),
		PerDBs:         f("RATE_PER_DB_S", 0.0001),
		TierMultiplier: map[string]float64{"free": 1, "pro": 0.8, "enterprise": 0.6},
		FreeCostUnits:  map[string]float64{"free": 5000, "pro": 50000, "enterprise": 250000},
	}
}

// Totals is a sum of ledger rows.
type Totals struct {
	Requests  int64   `json:"requests"`
	OK        int64   `json:"ok"`
	Rejected  int64   `json:"rejected"`
	CPUms     float64 `json:"cpu_ms"`
	MemGBs    float64 `json:"mem_gb_s"`
	DBs       float64 `json:"db_s"`
	Bytes     int64   `json:"bytes"`
	CostUnits float64 `json:"cost_units"`
}

func (t *Totals) add(r Row) {
	t.Requests += r.Req
	t.OK += r.OK
	t.Rejected += r.Rejected
	t.CPUms += r.CPUms
	t.MemGBs += r.MemMBms / 1000 / 1024
	t.DBs += r.DBms / 1000
	t.Bytes += r.Bytes
	t.CostUnits += r.CostUnits
}

// Line is one priced resource.
type Line struct {
	Resource string  `json:"resource"` // compute | memory | database
	Quantity float64 `json:"quantity"`
	Unit     string  `json:"unit"`
	Rate     float64 `json:"rate"`
	Amount   float64 `json:"amount"`
}

// TaskLine is the per-task breakdown (list price, before tier multiplier/credit).
type TaskLine struct {
	Task string `json:"task"`
	Totals
	Lines  []Line  `json:"lines"`
	Amount float64 `json:"amount"`
}

// SeriesPoint is one minute of usage.
type SeriesPoint struct {
	At        time.Time `json:"at"`
	Requests  int64     `json:"requests"`
	Rejected  int64     `json:"rejected"`
	CostUnits float64   `json:"cost_units"`
}

// Usage is the /v1/me/usage payload (usage vs. quota is added by the gateway).
type Usage struct {
	Tenant string        `json:"tenant_id"`
	From   time.Time     `json:"from"`
	To     time.Time     `json:"to"`
	Totals Totals        `json:"totals"`
	Tasks  []TaskLine    `json:"by_task"`
	Series []SeriesPoint `json:"series"`
	Note   string        `json:"note"`
}

// Showback is the /v1/me/showback payload.
type Showback struct {
	Tenant         string     `json:"tenant_id"`
	Tier           string     `json:"tier"`
	From           time.Time  `json:"from"`
	To             time.Time  `json:"to"`
	Currency       string     `json:"currency"`
	Totals         Totals     `json:"totals"`
	Lines          []Line     `json:"lines"`
	ByTask         []TaskLine `json:"by_task"`
	Subtotal       float64    `json:"subtotal"`
	TierMultiplier float64    `json:"tier_multiplier"`
	FreeCredit     float64    `json:"free_allowance_credit"`
	Total          float64    `json:"total"`
	Rates          RateCard   `json:"rate_card"`
	Disclaimer     string     `json:"disclaimer"`
}

// Spender is one row of the admin "top spenders" list.
type Spender struct {
	Tenant string  `json:"tenant_id"`
	Tier   string  `json:"tier"`
	Totals Totals  `json:"totals"`
	Amount float64 `json:"amount"` // after tier multiplier and free credit
}

// AdminUsage is the /admin/usage payload.
type AdminUsage struct {
	From       time.Time  `json:"from"`
	To         time.Time  `json:"to"`
	Totals     Totals     `json:"totals"`
	Top        []Spender  `json:"top_spenders"`
	ByTask     []TaskLine `json:"by_task"`
	Disclaimer string     `json:"disclaimer"`
}

// Reporter answers usage queries from a Store.
type Reporter struct {
	Store   Store
	Card    RateCard
	Weights cost.Weights
	// Tier resolves a tenant's current tier ("" if unknown).
	Tier func(tenant string) string
}

var ErrRange = errors.New("usage: invalid time range")

func (r *Reporter) tier(t string) string {
	if r.Tier == nil {
		return ""
	}
	return r.Tier(t)
}

func checkRange(from, to time.Time) error {
	if !to.After(from) || to.Sub(from) > MaxRange {
		return ErrRange
	}
	return nil
}

// lines prices a totals bundle at list price. cpuNet is the cpu+network share
// of the cost units (everything except memory and db, which have own meters).
func (r *Reporter) lines(t Totals) ([]Line, float64) {
	cpuNet := r.Weights.A*t.CPUms + r.Weights.G*float64(t.Bytes)/1024
	ls := []Line{
		{"compute", cpuNet, "cost units (cpu+network)", r.Card.PerCostUnit, cpuNet * r.Card.PerCostUnit},
		{"memory", t.MemGBs, "GB-s", r.Card.PerGBs, t.MemGBs * r.Card.PerGBs},
		{"database", t.DBs, "DB-s", r.Card.PerDBs, t.DBs * r.Card.PerDBs},
	}
	var sum float64
	for _, l := range ls {
		sum += l.Amount
	}
	return ls, sum
}

func (r *Reporter) byTask(rows []Row) []TaskLine {
	m := map[string]*TaskLine{}
	for _, row := range rows {
		tl := m[row.Task]
		if tl == nil {
			tl = &TaskLine{Task: row.Task}
			m[row.Task] = tl
		}
		tl.add(row)
	}
	out := make([]TaskLine, 0, len(m))
	for _, tl := range m {
		tl.Lines, tl.Amount = r.lines(tl.Totals)
		out = append(out, *tl)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CostUnits != out[j].CostUnits {
			return out[i].CostUnits > out[j].CostUnits
		}
		return out[i].Task < out[j].Task
	})
	return out
}

func totalsOf(rows []Row) Totals {
	var t Totals
	for _, r := range rows {
		t.add(r)
	}
	return t
}

// price turns totals into a final amount for a tier.
func (r *Reporter) price(t Totals, tier string) (lines []Line, sub, mult, credit, total float64) {
	lines, sub = r.lines(t)
	mult = 1
	if m, ok := r.Card.TierMultiplier[tier]; ok {
		mult = m
	}
	credit = math.Min(sub*mult, r.Card.FreeCostUnits[tier]*r.Card.PerCostUnit)
	total = math.Max(0, sub*mult-credit)
	return
}

// Usage returns a tenant's totals, per-task split and per-minute series.
func (r *Reporter) Usage(ctx context.Context, tenant string, from, to time.Time) (Usage, error) {
	if err := checkRange(from, to); err != nil {
		return Usage{}, err
	}
	rows, err := r.Store.Rows(ctx, tenant, from, to)
	if err != nil {
		return Usage{}, err
	}
	pts := map[time.Time]*SeriesPoint{}
	for _, row := range rows {
		k := row.Window.Truncate(time.Minute)
		p := pts[k]
		if p == nil {
			p = &SeriesPoint{At: k}
			pts[k] = p
		}
		p.Requests += row.Req
		p.Rejected += row.Rejected
		p.CostUnits += row.CostUnits
	}
	series := make([]SeriesPoint, 0, len(pts))
	for _, p := range pts {
		series = append(series, *p)
	}
	sort.Slice(series, func(i, j int) bool { return series[i].At.Before(series[j].At) })
	return Usage{Tenant: tenant, From: from, To: to, Totals: totalsOf(rows),
		Tasks: r.byTask(rows), Series: series,
		Note: "Ledger is written every 5 s; the newest seconds may be missing. " + Disclaimer}, nil
}

// Showback prices a tenant's usage with the rate card.
func (r *Reporter) Showback(ctx context.Context, tenant string, from, to time.Time) (Showback, error) {
	if err := checkRange(from, to); err != nil {
		return Showback{}, err
	}
	rows, err := r.Store.Rows(ctx, tenant, from, to)
	if err != nil {
		return Showback{}, err
	}
	tier := r.tier(tenant)
	t := totalsOf(rows)
	lines, sub, mult, credit, total := r.price(t, tier)
	return Showback{Tenant: tenant, Tier: tier, From: from, To: to, Currency: "USD (demo)",
		Totals: t, Lines: lines, ByTask: r.byTask(rows), Subtotal: sub,
		TierMultiplier: mult, FreeCredit: credit, Total: total, Rates: r.Card,
		Disclaimer: Disclaimer}, nil
}

// Admin returns fleet totals and the top-n spenders (n<=0 means all).
func (r *Reporter) Admin(ctx context.Context, from, to time.Time, n int) (AdminUsage, error) {
	if err := checkRange(from, to); err != nil {
		return AdminUsage{}, err
	}
	rows, err := r.Store.Rows(ctx, "", from, to)
	if err != nil {
		return AdminUsage{}, err
	}
	per := map[string][]Row{}
	for _, row := range rows {
		per[row.Tenant] = append(per[row.Tenant], row)
	}
	top := make([]Spender, 0, len(per))
	for id, rs := range per {
		t := totalsOf(rs)
		tier := r.tier(id)
		_, _, _, _, total := r.price(t, tier)
		top = append(top, Spender{Tenant: id, Tier: tier, Totals: t, Amount: total})
	}
	sort.Slice(top, func(i, j int) bool {
		if top[i].Amount != top[j].Amount {
			return top[i].Amount > top[j].Amount
		}
		return top[i].Tenant < top[j].Tenant
	})
	if n > 0 && len(top) > n {
		top = top[:n]
	}
	return AdminUsage{From: from, To: to, Totals: totalsOf(rows), Top: top,
		ByTask: r.byTask(rows), Disclaimer: Disclaimer}, nil
}
