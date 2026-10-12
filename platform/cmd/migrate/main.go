// Command migrate applies database migrations (idempotent). Usage: go run ./cmd/migrate
package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"

	"github.com/bulkhead/platform/migrations"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://bulkhead:bulkhead@localhost:5432/bulkhead?sslmode=disable"
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer db.Close()
	if err := migrations.Up(context.Background(), db); err != nil {
		fmt.Fprintln(os.Stderr, "migrate:", err)
		os.Exit(1)
	}
}
