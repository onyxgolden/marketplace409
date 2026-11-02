-- Team Brain P7 — worker heartbeat schema.
-- Idempotent: safe to re-apply (CREATE IF NOT EXISTS + ON CONFLICT guards).
-- Apply after P1, P5, P6 schemas; roles.sql grants on this table, so
-- apply roles.sql after this file.
--
-- One row per worker cycle outcome. The observer reads the latest row
-- per worker_id; freshness is (now - recorded_at). A heartbeat row is
-- evidence of a cycle, never authority to run one: the engine lease
-- and the role check are the arbiters, not this table.
-- States: COMPLETED (cycle ran, receipt stored), REFUSED_OVERLAP
-- (lease held by another cycle — no overlapping instances),
-- FAILED (cycle threw; detail names the error, never a payload),
-- STOPPED (stop file present; cycle refused to start),
-- MISSED (slot passed with no cycle — recorded by the observer,
-- never backfilled by the worker).

CREATE TABLE IF NOT EXISTS tb_worker_heartbeats (
  id BIGSERIAL PRIMARY KEY,
  worker_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  run_date TEXT,
  state TEXT NOT NULL CHECK (state IN (
    'COMPLETED', 'REFUSED_OVERLAP', 'FAILED', 'STOPPED', 'MISSED'
  )),
  receipt_hash TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS tb_worker_heartbeats_worker_idx
  ON tb_worker_heartbeats (worker_id, id DESC);
