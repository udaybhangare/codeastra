// Package migrations embeds the SQL migrations and applies them with goose.
package migrations

import (
	"context"
	"database/sql"
	"embed"

	"github.com/pressly/goose/v3"
)

//go:embed *.sql
var fs embed.FS

// Up applies all pending migrations (idempotent).
func Up(ctx context.Context, db *sql.DB) error {
	goose.SetBaseFS(fs)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	return goose.UpContext(ctx, db, ".")
}
