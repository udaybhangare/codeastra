-- +goose Up
-- Per-(tenant, window, task) usage rows: the finest grain of the showback ledger.
-- usage_ledger (00001) keeps the per-window tenant aggregate incl. p99.
-- Rows are written with absolute values (upsert), so replays are idempotent.
CREATE TABLE usage_ledger_task (
    tenant_id    text NOT NULL REFERENCES tenants(id),
    window_start timestamptz NOT NULL,
    task         text NOT NULL,
    req          bigint NOT NULL DEFAULT 0,
    ok           bigint NOT NULL DEFAULT 0,
    rejected     bigint NOT NULL DEFAULT 0,
    cpu_ms       double precision NOT NULL DEFAULT 0,
    mem_mb_ms    double precision NOT NULL DEFAULT 0,
    db_ms        double precision NOT NULL DEFAULT 0,
    bytes        bigint NOT NULL DEFAULT 0,
    cost_units   double precision NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, window_start, task)
);
CREATE INDEX usage_ledger_task_window_idx ON usage_ledger_task (window_start);

-- +goose Down
DROP TABLE IF EXISTS usage_ledger_task;
