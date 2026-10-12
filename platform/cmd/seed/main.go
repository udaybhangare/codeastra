// Command seed loads demo tenants, keys, policies and demo.events. Usage: go run ./cmd/seed
package main

import (
	"context"
	"fmt"
	"os"

	"github.com/bulkhead/platform/internal/seed"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://bulkhead:bulkhead@localhost:5432/bulkhead?sslmode=disable"
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer pool.Close()
	if err := seed.Run(ctx, pool, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "seed:", err)
		os.Exit(1)
	}
}
