-- +goose Up
-- Contended tables used by `db-query` tasks. Rows are loaded by `make seed`.
CREATE SCHEMA demo;

CREATE TABLE demo.events (
    id         bigserial PRIMARY KEY,
    tenant_id  text NOT NULL,
    user_id    integer NOT NULL,
    kind       text NOT NULL,
    payload    text NOT NULL,
    created_at timestamptz NOT NULL
);
-- Fast path: lookups by tenant + time range use this index.
CREATE INDEX events_tenant_created_idx ON demo.events (tenant_id, created_at);
-- Deliberately NO index on user_id / kind / payload: filtering or aggregating on
-- those columns (or LIKE '%x%' on payload) is a slow sequential scan over ~2M rows.

-- +goose Down
DROP SCHEMA IF EXISTS demo CASCADE;
