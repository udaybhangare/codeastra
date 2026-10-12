package policy

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// PGNotifier listens on the `policies_changed` channel using a dedicated connection.
type PGNotifier struct{ DSN string }

func (n PGNotifier) Listen(ctx context.Context, ch chan<- struct{}) error {
	conn, err := pgx.Connect(ctx, n.DSN)
	if err != nil {
		return err
	}
	defer conn.Close(context.Background())
	if _, err := conn.Exec(ctx, "LISTEN policies_changed"); err != nil {
		return err
	}
	for {
		if _, err := conn.WaitForNotification(ctx); err != nil {
			return err
		}
		select { // coalesce bursts: one pending signal is enough
		case ch <- struct{}{}:
		default:
		}
	}
}
