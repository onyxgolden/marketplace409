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

-- Episode lifecycle events (fix round 1, TBP5-003; identity hardened
-- fix round 2, TBP5-009). Episode rows are never UPDATE'd: an archive
-- appends one event row here and bumps the retrieval revision, so a
-- query at an earlier pin still projects the original state while a
-- latest-state query projects ARCHIVED. The event carries its revision
-- plus full audit identity (note, actor, operation_id, time); an
-- archive replay compares that full identity, and any changed actor,
-- note, claimed operation id, or claimed timestamp fails with a named
-- conflicting-replay result instead of reusing the receipt.
CREATE TABLE IF NOT EXISTS tb_episode_events (
  event_id BIGSERIAL PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES tb_episodes (episode_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('ARCHIVED')),
  revision BIGINT NOT NULL,
  note TEXT,
  actor TEXT,
  created_at TEXT NOT NULL,
  operation_id TEXT,
  -- Fix round 3 (TBP5-011): whether created_at was caller-supplied.
  -- When false, the bound timestamp is null (a replay supplying one
  -- conflicts); when true — or NULL on a pre-fix row with unknown
  -- provenance, which fails closed — created_at is the bound
  -- timestamp. Without this flag a server-generated created_at is
  -- indistinguishable from a caller timestamp, and a weaker replay
  -- omitting the binding would silently reuse the receipt.
  timestamp_claimed BOOLEAN
);
ALTER TABLE tb_episode_events ADD COLUMN IF NOT EXISTS operation_id TEXT;
ALTER TABLE tb_episode_events ADD COLUMN IF NOT EXISTS timestamp_claimed BOOLEAN;
CREATE UNIQUE INDEX IF NOT EXISTS tb_episode_events_one_archive_idx
  ON tb_episode_events (episode_id, event_type);
CREATE INDEX IF NOT EXISTS tb_episode_events_revision_idx
  ON tb_episode_events (episode_id, revision);
