-- Team Brain P5 — immutable episode capture + deterministic retrieval.
-- Idempotent: safe to re-apply (CREATE IF NOT EXISTS + ON CONFLICT guards).
-- This schema is P5-only. It does not alter the P1 migration
-- (001_team_brain_schema.sql) or its pinned snapshot.
-- Offline test target: PGlite (real PostgreSQL semantics, in-memory).
-- Production apply is a separately gated step (no migration runs here).

CREATE TABLE IF NOT EXISTS tb_retrieval_revisions (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision BIGINT NOT NULL DEFAULT 0
);
INSERT INTO tb_retrieval_revisions (id, revision)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

-- One row per captured episode. Immutable: the adapter never UPDATEs or
-- DELETEs a row here (corrections link as new episodes; archive flips only
-- the state flag, never the content — see the adapter's archive note).
CREATE TABLE IF NOT EXISTS tb_episodes (
  episode_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_repo TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_commit TEXT,
  source_blob TEXT,
  source_watermark TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  captured_at_ms BIGINT NOT NULL,
  revision BIGINT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (state IN ('ACTIVE', 'ARCHIVED')),
  visibility TEXT NOT NULL
    CHECK (visibility IN ('public', 'restricted')),
  provenance_status TEXT NOT NULL
    CHECK (provenance_status IN ('COMPLETE', 'UNAVAILABLE')),
  conflict_group TEXT,
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
  ) STORED
);
CREATE INDEX IF NOT EXISTS tb_episodes_search_idx
  ON tb_episodes USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS tb_episodes_scope_revision_idx
  ON tb_episodes (scope, revision);
CREATE INDEX IF NOT EXISTS tb_episodes_conflict_idx
  ON tb_episodes (conflict_group) WHERE conflict_group IS NOT NULL;

-- Authorization rows. An episode with visibility 'restricted' is visible
-- only to principals with a row here. Visibility is enforced in the
-- search query itself (before ranking and limiting), never as a
-- post-filter, so denied content cannot leak through counts or snippets.
CREATE TABLE IF NOT EXISTS tb_episode_grants (
  episode_id TEXT NOT NULL REFERENCES tb_episodes (episode_id),
  principal TEXT NOT NULL,
  PRIMARY KEY (episode_id, principal)
);

-- Historical pins: a pin name binds one immutable revision. Repointing a
-- pin to a different revision is refused (PIN_CONFLICT); replaying the
-- same name+revision is idempotent.
CREATE TABLE IF NOT EXISTS tb_pins (
  pin_name TEXT PRIMARY KEY,
  revision BIGINT NOT NULL,
  pinned_at TEXT NOT NULL
);

-- Four-slot durable-reference working set, per principal. A slot holds
-- one episode reference. Displacement is a single UPDATE/UPSERT, so a
-- failed write leaves the previous slot value intact (write-through
-- first; the adapter holds no in-memory copy that could diverge).
CREATE TABLE IF NOT EXISTS tb_working_set (
  principal TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
  episode_id TEXT NOT NULL REFERENCES tb_episodes (episode_id),
  revision BIGINT NOT NULL,
  PRIMARY KEY (principal, slot)
);
