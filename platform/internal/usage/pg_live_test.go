package usage

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Runs only when DATABASE_URL is set and the migrations are applied.
func TestPGStoreRoundTrip(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var tenant string
	if err := pool.QueryRow(ctx, `SELECT id FROM tenants LIMIT 1`).Scan(&tenant); err != nil {
		t.Skip("no tenants seeded")
	}
	win := time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)
	defer pool.Exec(ctx, `DELETE FROM usage_ledger_task WHERE window_start=$1`, win)
	defer pool.Exec(ctx, `DELETE FROM usage_ledger WHERE window_start=$1`, win)
	st := PGStore{Pool: pool}
	row := Row{Tenant: tenant, Window: win, Task: "echo", Req: 2, OK: 2, CostUnits: 7.5}
	wr := WindowRow{Row: Row{Tenant: tenant, Window: win, Req: 2, OK: 2, CostUnits: 7.5}, P99ms: 12}
	for i := 0; i < 2; i++ { // second write must be a no-op upsert
		if err := st.Write(ctx, []Row{row}, []WindowRow{wr}); err != nil {
			t.Fatal(err)
		}
	}
	// unknown tenant is skipped, not fatal
	if err := st.Write(ctx, []Row{{Tenant: "no-such", Window: win, Task: "x"}}, nil); err != nil {
		t.Fatal(err)
	}
	rows, err := st.Rows(ctx, tenant, win, win.Add(time.Second))
	if err != nil || len(rows) != 1 || rows[0].CostUnits != 7.5 || rows[0].Req != 2 {
		t.Fatalf("rows=%+v err=%v", rows, err)
	}
}
