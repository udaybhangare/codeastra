-- +goose Up
CREATE TABLE tenants (
    id         text PRIMARY KEY,
    name       text NOT NULL,
    tier       text NOT NULL CHECK (tier IN ('free','pro','enterprise')),
    status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
    id         bigserial PRIMARY KEY,
    tenant_id  text NOT NULL REFERENCES tenants(id),
    key_hash   text NOT NULL UNIQUE,
    prefix     text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz
);
CREATE INDEX api_keys_tenant_idx ON api_keys (tenant_id);

CREATE TABLE policies (
    tenant_id     text PRIMARY KEY REFERENCES tenants(id),
    tier          text NOT NULL CHECK (tier IN ('free','pro','enterprise')),
    weight        integer NOT NULL CHECK (weight > 0),
    reserve_cpu   double precision NOT NULL CHECK (reserve_cpu >= 0),
    limit_cpu     double precision NOT NULL CHECK (limit_cpu > 0),
    limit_mem_mb  integer NOT NULL CHECK (limit_mem_mb > 0),
    rps           double precision NOT NULL CHECK (rps > 0),
    burst         integer NOT NULL CHECK (burst >= 1),
    cost_per_s    double precision NOT NULL CHECK (cost_per_s > 0),
    concurrency   integer NOT NULL CHECK (concurrency >= 1),
    queue_depth   integer NOT NULL CHECK (queue_depth >= 0),
    db_conns      integer NOT NULL CHECK (db_conns >= 1),
    bandwidth_bps bigint NOT NULL CHECK (bandwidth_bps > 0),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (reserve_cpu <= limit_cpu)
);

CREATE TABLE usage_ledger (
    tenant_id    text NOT NULL REFERENCES tenants(id),
    window_start timestamptz NOT NULL,
    req          bigint NOT NULL DEFAULT 0,
    ok           bigint NOT NULL DEFAULT 0,
    rejected     bigint NOT NULL DEFAULT 0,
    cpu_ms       double precision NOT NULL DEFAULT 0,
    mem_mb_s     double precision NOT NULL DEFAULT 0,
    db_ms        double precision NOT NULL DEFAULT 0,
    bytes        bigint NOT NULL DEFAULT 0,
    cost_units   double precision NOT NULL DEFAULT 0,
    p99_ms       double precision NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, window_start)
);

CREATE TABLE throttle_events (
    id          bigserial PRIMARY KEY,
    ts          timestamptz NOT NULL DEFAULT now(),
    tenant_id   text NOT NULL,
    from_level  smallint NOT NULL,
    to_level    smallint NOT NULL,
    reason      text NOT NULL,
    evidence    jsonb NOT NULL DEFAULT '{}',
    actions     jsonb NOT NULL DEFAULT '[]',
    actor       text NOT NULL DEFAULT 'system'
);
CREATE INDEX throttle_events_ts_idx ON throttle_events (ts);

CREATE TABLE runs (
    id             bigserial PRIMARY KEY,
    scenario       text NOT NULL,
    seed           bigint NOT NULL,
    isolation_mode text NOT NULL CHECK (isolation_mode IN ('on','off')),
    started_at     timestamptz NOT NULL DEFAULT now(),
    ended_at       timestamptz,
    summary        jsonb
);

CREATE TABLE audit_log (
    id     bigserial PRIMARY KEY,
    ts     timestamptz NOT NULL DEFAULT now(),
    actor  text NOT NULL,
    action text NOT NULL,
    target text NOT NULL DEFAULT '',
    detail jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_ts_idx ON audit_log (ts);

-- Live reload: any policy change notifies the platform, which swaps its snapshot.
-- +goose StatementBegin
CREATE FUNCTION policies_notify() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('policies_changed', COALESCE(NEW.tenant_id, OLD.tenant_id));
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER policies_notify_trg
    AFTER INSERT OR UPDATE OR DELETE ON policies
    FOR EACH ROW EXECUTE FUNCTION policies_notify();

-- +goose Down
DROP TRIGGER IF EXISTS policies_notify_trg ON policies;
DROP FUNCTION IF EXISTS policies_notify();
DROP TABLE IF EXISTS audit_log, runs, throttle_events, usage_ledger, policies, api_keys, tenants;
