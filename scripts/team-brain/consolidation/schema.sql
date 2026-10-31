-- Team Brain P6 — consolidation / replay engine.
-- Idempotent: safe to re-apply (CREATE IF NOT EXISTS + ON CONFLICT guards).
-- This schema is P6-only. It does not alter the P5 schema
-- (scripts/team-brain/retrieval/schema.sql), the P1 migration
-- (001_team_brain_schema.sql), or their pinned snapshots.
-- It DOES require the P5 schema first: tb_consolidated_facts
-- references tb_episodes, so apply retrieval/schema.sql before this
-- file (migrateP6 refuses with MISSING_PREREQUISITE otherwise).
-- Offline test target: PGlite (real PostgreSQL semantics, in-memory).
-- Production apply is a separately gated step (no migration runs here).
--
-- In-process boundary only (001A): the lease row below is a
-- cooperative record, not cross-process fencing. Two writers in
-- different processes may still race; the engine refuses a second
-- holder only when it can see the lease row, and never claims
-- exclusion it cannot prove. Do not deploy this engine behind two
-- writers without a separately reviewed fencing step (P8 territory,
-- Jason-gated).

-- One row per civil date (America/Chicago). A date's run is COMPLETED
-- exactly once; a date whose slot passed with no run is MISSED
-- (audit-only — a missed slot is never silently backfilled).
-- A run receipt is stored as canonical JSON text for readback.
CREATE TABLE IF NOT EXISTS tb_consolidation_runs (
  run_date TEXT PRIMARY KEY,
  slot_instant TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('COMPLETED', 'MISSED')),
  lease_generation BIGINT NOT NULL DEFAULT 0,
  source_revision BIGINT,
  source_watermark TEXT,
  episodes_considered INTEGER NOT NULL DEFAULT 0,
  episodes_promoted INTEGER NOT NULL DEFAULT 0,
  duplicates_found INTEGER NOT NULL DEFAULT 0,
  conflicts_found INTEGER NOT NULL DEFAULT 0,
  proposals_filed INTEGER NOT NULL DEFAULT 0,
  receipt TEXT,
  started_at TEXT,
  completed_at TEXT
);

-- Cooperative single-holder lease. Exactly one row (id = 1). Acquire
-- is UPDATE ... WHERE holder IS NULL; a second holder in the same
-- process sees zero updated rows and is refused with LEASE_HELD.
-- A crashed holder leaves its lease behind on purpose: recovery is
-- explicit (recover + same holder id), never automatic, so a restart
-- resumes from the last fenced checkpoint instead of re-applying.
CREATE TABLE IF NOT EXISTS tb_consolidation_lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generation BIGINT NOT NULL DEFAULT 0,
  holder TEXT,
  run_date TEXT,
  acquired_at TEXT
);
INSERT INTO tb_consolidation_lease (id, generation, holder, run_date, acquired_at)
VALUES (1, 0, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- Promoted facts. One row per (episode, fact type). A fact is a
-- deterministic derivation from a verified uncontested episode — never
-- free text, never a model output. Archive flips state + note only;
-- rows are never deleted (archive-without-delete).
CREATE TABLE IF NOT EXISTS tb_consolidated_facts (
  fact_id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES tb_episodes (episode_id),
  fact_type TEXT NOT NULL CHECK (fact_type IN (
    'EPISODE_RECORDED', 'SOURCE_VERIFIED', 'SCOPE_CLASSIFIED',
    'CONFLICT_FREE', 'DUPLICATE_CANONICAL'
  )),
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  promoted_revision BIGINT NOT NULL,
  promoted_run_date TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (state IN ('ACTIVE', 'ARCHIVED')),
  archived_note TEXT,
  archived_actor TEXT,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS tb_consolidated_facts_episode_idx
  ON tb_consolidated_facts (episode_id);

-- Proposals for Jason. The engine files CONFLICT and DUPLICATE
-- proposals from replay; STANDING_RULE and PERMISSION_CHANGE exist
-- in the closed schema but are NEVER filed from replay — episode
-- text is evidence, never authority — and an explicit filing without
-- an authorization record is refused. A proposal is OPEN until Jason
-- closes it; the engine never closes one. Re-filing the same
-- deterministic id replays (no duplicate row).
CREATE TABLE IF NOT EXISTS tb_consolidation_proposals (
  proposal_id TEXT PRIMARY KEY,
  proposal_type TEXT NOT NULL CHECK (proposal_type IN (
    'CONFLICT', 'DUPLICATE', 'STANDING_RULE', 'PERMISSION_CHANGE'
  )),
  episode_id TEXT,
  conflict_group TEXT,
  detail TEXT NOT NULL,
  authorization_id TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status = 'OPEN'),
  filed_run_date TEXT NOT NULL,
  filed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tb_consolidation_proposals_group_idx
  ON tb_consolidation_proposals (conflict_group)
  WHERE conflict_group IS NOT NULL;

-- Fenced checkpoints. One row per (run, checkpoint). The six ordered
-- steps each write their checkpoint before the next step starts, so a
-- restart resumes after the last recorded checkpoint without
-- re-applying. counts is canonical JSON text.
CREATE TABLE IF NOT EXISTS tb_consolidation_checkpoints (
  run_date TEXT NOT NULL,
  checkpoint TEXT NOT NULL CHECK (checkpoint IN (
    'SNAPSHOT', 'SELECTION', 'VERIFICATION', 'PROPOSALS', 'APPLY', 'EXPORT'
  )),
  counts TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (run_date, checkpoint)
);

-- Audit export rows. Every step appends rows; export reads them back
-- in sequence order. Nothing here is ever updated or deleted.
-- payload_hash makes appends idempotent per (run_date, entry_type,
-- payload): a resumed step re-appends the same deterministic payload
-- and the row is kept once, so a mid-step crash cannot duplicate
-- audit rows on resume. (A btree on raw payload text would fail on
-- long payloads; the hash keeps the dedup index small.)
CREATE TABLE IF NOT EXISTS tb_consolidation_audit (
  seq BIGSERIAL PRIMARY KEY,
  run_date TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tb_consolidation_audit_dedup_idx
  ON tb_consolidation_audit (run_date, entry_type, payload_hash);
CREATE INDEX IF NOT EXISTS tb_consolidation_audit_run_idx
  ON tb_consolidation_audit (run_date, seq);
