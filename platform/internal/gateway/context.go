package gateway

import "context"

// TenantCtx is the verified identity of the caller. It is built only from JWT claims.
type TenantCtx struct {
	TenantID string
	Tier     string
	JTI      string
}

type ctxKey int

const (
	tenantKey ctxKey = iota
	adminKey
	reqIDKey
)

func WithTenant(ctx context.Context, t TenantCtx) context.Context {
	return context.WithValue(ctx, tenantKey, t)
}

// TenantFrom returns the authenticated tenant; ok is false on unauthenticated requests.
func TenantFrom(ctx context.Context) (TenantCtx, bool) {
	t, ok := ctx.Value(tenantKey).(TenantCtx)
	return t, ok
}

func RequestID(ctx context.Context) string {
	s, _ := ctx.Value(reqIDKey).(string)
	return s
}
