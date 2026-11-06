-- Team Brain P7 — canonical database roles and least-privilege grants.
--
-- Apply order: P1 migration (001_team_brain_schema.sql) -> P5 retrieval
-- schema -> P6 consolidation schema -> worker schema -> THIS file.
-- Idempotent: role creation is guarded, GRANT/REVOKE repeat safely.
--
-- tb_admin: the owner/provisioning role. NOLOGIN here on purpose:
-- LOGIN + password provisioning is a separately gated step (P8
-- territory), never part of this package. Nothing in the worker
-- package authenticates as tb_admin, and no worker-held config
-- names tb_admin credentials.
--
-- tb_consolidator: the ONLY role the worker engine connection may
-- authenticate as. Its grants cover exactly the contract §4 effects:
-- propose summaries, file supersession records, promote uncontested
-- facts, merge duplicates, retire stale entries with a note — plus
-- the run bookkeeping (runs, lease, checkpoints, bindings, audit,
-- proposals, heartbeat). It has NO DELETE and NO TRUNCATE anywhere,
-- NO write access to episodes, grants, pins, working set, or any P1
-- obligation/handoff table, and NO access to P1/P5 event history.
-- The engine additionally refuses any connection whose current_user
-- is not tb_consolidator, so even a broader grant cannot confer
-- apply authority through a different identity (proven in P7 tests,
-- including inherited-membership and PUBLIC-grant negatives).
--
-- tb_reader: the observer / health / backup-export role. Read-only.
-- It reads run state, facts, audit, heartbeat, and intake revisions,
-- plus handoff states for the pending-deliveries probe. It deliberately
-- has NO SELECT on tb_episode_grants (visibility principals), NO
-- SELECT on obligation/handoff event history, and NO write anywhere.
--
-- PUBLIC: explicitly revoked on every team-brain table below, so a
-- default or inherited PUBLIC grant can never widen these roles.
-- (Fresh PostgreSQL grants PUBLIC nothing on new tables by default;
-- the revokes below make that explicit and survive dump/restore.)
-- FUNCTIONS are the opposite default: PostgreSQL grants EXECUTE to
-- PUBLIC on a new function unless revoked. team_brain_is_valid_utc_iso
-- (migrations/001_team_brain_schema.sql) went unrevoked until this
-- block — proven on production (2026-11-06) when a Supabase default
-- grant correction revoked it from anon/authenticated/service_role but
-- NOT from PUBLIC/tb_admin specifically, surfacing that tb_admin's own
-- restore inserts (team_brain_obligations/obligation_events/handoffs/
-- handoff_events — every table whose CHECK constraint calls this
-- function) had only ever worked because of the implicit PUBLIC grant,
-- never an explicit one. Every isolated Docker/PGlite test this
-- project ran passed for the same reason, silently. Revoked below,
-- EXECUTE re-granted to tb_admin only (the sole role that inserts into
-- those four tables); tb_consolidator and tb_reader never needed it.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tb_admin') THEN
    CREATE ROLE tb_admin NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tb_consolidator') THEN
    CREATE ROLE tb_consolidator NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tb_reader') THEN
    CREATE ROLE tb_reader NOLOGIN;
  END IF;
END
$$;

-- Consolidator: reads the intake it consolidates (episodes, their
-- visibility grants, episode events for retraction/supersession
-- checks, the intake revision). Reads only — no writes here.
GRANT SELECT ON tb_episodes TO tb_consolidator;
GRANT SELECT ON tb_episode_grants TO tb_consolidator;
GRANT SELECT ON tb_episode_events TO tb_consolidator;
GRANT SELECT ON tb_retrieval_revisions TO tb_consolidator;

-- Consolidator: the full P6 write set, and nothing else.
-- INSERT + UPDATE cover: runs (insert + state updates), lease
-- (acquire/release updates), facts (insert + state flips),
-- proposals (insert), checkpoints (insert + INCOMPLETE update),
-- bindings (insert + progress updates), audit (insert).
-- Sequences the consolidator's INSERTs need. PostgreSQL names a
-- BIGSERIAL backing sequence <table>_<column>_seq, so the audit
-- sequence is tb_consolidation_audit_seq_seq (not ..._audit_seq)
-- and the heartbeat sequence is tb_worker_heartbeats_id_seq.
-- INSERT without USAGE on the backing sequence fails, so the table
-- grant alone is not enough.
GRANT SELECT, INSERT, UPDATE ON tb_consolidation_runs TO tb_consolidator;
GRANT SELECT, INSERT, UPDATE ON tb_consolidation_lease TO tb_consolidator;
GRANT SELECT, INSERT, UPDATE ON tb_consolidated_facts TO tb_consolidator;
GRANT SELECT, INSERT, UPDATE ON tb_consolidation_proposals TO tb_consolidator;
GRANT SELECT, INSERT, UPDATE ON tb_consolidation_checkpoints TO tb_consolidator;
GRANT SELECT, INSERT, UPDATE ON tb_consolidation_run_bindings TO tb_consolidator;
GRANT SELECT, INSERT, UPDATE ON tb_consolidation_audit TO tb_consolidator;
GRANT USAGE, SELECT ON SEQUENCE tb_consolidation_audit_seq_seq TO tb_consolidator;

-- Consolidator: heartbeat writes (worker cycle receipts).
GRANT SELECT, INSERT, UPDATE ON tb_worker_heartbeats TO tb_consolidator;
GRANT USAGE, SELECT ON SEQUENCE tb_worker_heartbeats_id_seq TO tb_consolidator;

-- Reader: run state, facts, audit, intake, heartbeat, handoff states.
GRANT SELECT ON tb_consolidation_runs TO tb_reader;
GRANT SELECT ON tb_consolidation_lease TO tb_reader;
GRANT SELECT ON tb_consolidated_facts TO tb_reader;
GRANT SELECT ON tb_consolidation_proposals TO tb_reader;
GRANT SELECT ON tb_consolidation_checkpoints TO tb_reader;
GRANT SELECT ON tb_consolidation_run_bindings TO tb_reader;
GRANT SELECT ON tb_consolidation_audit TO tb_reader;
GRANT SELECT ON tb_retrieval_revisions TO tb_reader;
GRANT SELECT ON tb_episodes TO tb_reader;
GRANT SELECT ON tb_worker_heartbeats TO tb_reader;
GRANT SELECT ON team_brain_handoffs TO tb_reader;
GRANT SELECT ON team_brain_obligations TO tb_reader;

-- Owner (tb_admin): the health-probe and backup/restore handle.
-- Holds SELECT on all twenty team-brain tables (needed for --check
-- and --backup — see below), plus the narrowly scoped restore writes
-- added further down. It still has NO membership in tb_consolidator
-- / tb_reader, and still cannot DELETE or TRUNCATE anything: this is
-- not a general write role, it is SELECT everywhere plus exactly the
-- two conflict shapes importRestore ever issues.
--
-- SELECT scope: --check (run.mjs --check --owner-user tb_admin)
-- directly SELECTs from six tables —
--   migrationCatalog: team_brain_schema_version + tb_consolidation_lease
--   backlogWatermark / projectionRevision: tb_retrieval_revisions,
--     tb_consolidation_runs, tb_episodes
--   pendingUnknownDeliveries: tb_consolidation_runs, team_brain_handoffs
-- but migrationCatalog ALSO lists tables through
-- information_schema.tables, which only shows tables the handle holds
-- a privilege on — so six grants leave fourteen tables "missing" and
-- the probe FAILs (proven: granting only the six still failed
-- migrationCatalog with 14 missing). The owner read set must
-- therefore cover all twenty team-brain tables. --backup
-- (worker/backup.mjs exportBackup) reads the same twenty tables in
-- full, which this SELECT set also covers.
--
-- No role membership, on purpose: membership WITH INHERIT (the
-- default) would let tb_admin inherit consolidator writes (proven:
-- INSERT into tb_consolidation_runs succeeds), and membership WITH
-- INHERIT FALSE loses the role_table_grants visibility it was meant
-- to provide (proven: 0 visible rows). Consequence, stated plainly:
-- the effectiveGrants probe stays NOT_VISIBLE from tb_admin by design
-- (PARTIAL, not FAIL); full grant verification needs a
-- superuser/DBA handle, which the runbook already anticipates
-- ("re-run --check with an owner handle"). Before this block,
-- team_brain_schema_version had a PUBLIC revoke and no grant to any
-- role, so no handle could read it at all (P8 Step A NOT QUALIFIED).
GRANT SELECT ON team_brain_schema_version TO tb_admin;
GRANT SELECT ON team_brain_obligations TO tb_admin;
GRANT SELECT ON team_brain_obligation_dependencies TO tb_admin;
GRANT SELECT ON team_brain_obligation_events TO tb_admin;
GRANT SELECT ON team_brain_handoffs TO tb_admin;
GRANT SELECT ON team_brain_handoff_events TO tb_admin;
GRANT SELECT ON tb_retrieval_revisions TO tb_admin;
GRANT SELECT ON tb_episodes TO tb_admin;
GRANT SELECT ON tb_episode_grants TO tb_admin;
GRANT SELECT ON tb_pins TO tb_admin;
GRANT SELECT ON tb_working_set TO tb_admin;
GRANT SELECT ON tb_episode_events TO tb_admin;
GRANT SELECT ON tb_consolidation_runs TO tb_admin;
GRANT SELECT ON tb_consolidation_lease TO tb_admin;
GRANT SELECT ON tb_consolidated_facts TO tb_admin;
GRANT SELECT ON tb_consolidation_proposals TO tb_admin;
GRANT SELECT ON tb_consolidation_checkpoints TO tb_admin;
GRANT SELECT ON tb_consolidation_run_bindings TO tb_admin;
GRANT SELECT ON tb_consolidation_audit TO tb_admin;
GRANT SELECT ON tb_worker_heartbeats TO tb_admin;

-- Owner (tb_admin): restore rights, added 2026-11-05 (P8 Step A
-- re-qualification finding; Jason's decision 2026-11-05 ~16:57 CST;
-- narrowed 2026-11-05 on ChatGPT's NEEDS CHANGES review of the first
-- cut, which over-granted — see the two corrections below).
-- importRestore (worker/backup.mjs) issues exactly two statement
-- shapes, both via insertRows: INSERT ... ON CONFLICT DO NOTHING for
-- seventeen tables, and INSERT ... ON CONFLICT (id) DO UPDATE SET ...
-- for exactly three — the SINGLETON_UPSERT tables
-- (team_brain_schema_version, tb_retrieval_revisions,
-- tb_consolidation_lease), which already hold a seeded row in a
-- fresh target. DO NOTHING never executes an UPDATE, so it needs
-- INSERT only; it is only the three singleton tables whose conflict
-- path updates an existing row. Never DELETE or TRUNCATE anywhere in
-- the restore path.
GRANT INSERT ON team_brain_schema_version TO tb_admin;
GRANT INSERT ON team_brain_obligations TO tb_admin;
GRANT INSERT ON team_brain_obligation_dependencies TO tb_admin;
GRANT INSERT ON team_brain_obligation_events TO tb_admin;
GRANT INSERT ON team_brain_handoffs TO tb_admin;
GRANT INSERT ON team_brain_handoff_events TO tb_admin;
GRANT INSERT ON tb_retrieval_revisions TO tb_admin;
GRANT INSERT ON tb_episodes TO tb_admin;
GRANT INSERT ON tb_episode_grants TO tb_admin;
GRANT INSERT ON tb_pins TO tb_admin;
GRANT INSERT ON tb_working_set TO tb_admin;
GRANT INSERT ON tb_episode_events TO tb_admin;
GRANT INSERT ON tb_consolidation_runs TO tb_admin;
GRANT INSERT ON tb_consolidation_lease TO tb_admin;
GRANT INSERT ON tb_consolidated_facts TO tb_admin;
GRANT INSERT ON tb_consolidation_proposals TO tb_admin;
GRANT INSERT ON tb_consolidation_checkpoints TO tb_admin;
GRANT INSERT ON tb_consolidation_run_bindings TO tb_admin;
GRANT INSERT ON tb_consolidation_audit TO tb_admin;
GRANT INSERT ON tb_worker_heartbeats TO tb_admin;

-- UPDATE limited to exactly the three SINGLETON_UPSERT tables (see
-- above) — the only tables whose restore conflict path updates an
-- existing row. Every other table restores into an empty target, so
-- DO NOTHING is exact there and needs no UPDATE grant.
GRANT UPDATE ON team_brain_schema_version TO tb_admin;
GRANT UPDATE ON tb_retrieval_revisions TO tb_admin;
GRANT UPDATE ON tb_consolidation_lease TO tb_admin;

-- Five tables restore rows whose surrogate id column was stripped
-- from the backup (SURROGATE_COLUMNS in backup.mjs) and is left for
-- the database to regenerate via the column's own DEFAULT
-- nextval(...) expression, which needs USAGE on the sequence only —
-- restore never reads sequence state (no currval/lastval, no SELECT
-- on the sequence relation), so SELECT is not granted. Two sequences
-- already exist for tb_consolidator (tb_consolidation_audit_seq_seq,
-- tb_worker_heartbeats_id_seq); the other three were previously
-- ungranted to anyone and are added here:
-- team_brain_obligation_events_seq_seq, team_brain_handoff_events_seq_seq
-- (both back an identity column named "seq"), and
-- tb_episode_events_event_id_seq (backs event_id). All five names
-- verified against a live schema via pg_get_serial_sequence(), not
-- assumed from the naming convention.
--
-- This does not touch tb_consolidator or tb_reader, and does not
-- grant DELETE/TRUNCATE to tb_admin: a restore run proved it doesn't
-- need them (see the PR's verification evidence).
GRANT USAGE ON SEQUENCE team_brain_obligation_events_seq_seq TO tb_admin;
GRANT USAGE ON SEQUENCE team_brain_handoff_events_seq_seq TO tb_admin;
GRANT USAGE ON SEQUENCE tb_episode_events_event_id_seq TO tb_admin;
GRANT USAGE ON SEQUENCE tb_consolidation_audit_seq_seq TO tb_admin;
GRANT USAGE ON SEQUENCE tb_worker_heartbeats_id_seq TO tb_admin;

-- CHECK-constraint function: revoke the implicit PUBLIC EXECUTE grant,
-- re-grant to tb_admin only (see the comment at the top of this file).
REVOKE EXECUTE ON FUNCTION team_brain_is_valid_utc_iso(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION team_brain_is_valid_utc_iso(text) TO tb_admin;

-- Explicit PUBLIC revokes on every team-brain table named above.
REVOKE ALL ON tb_episodes FROM PUBLIC;
REVOKE ALL ON tb_episode_grants FROM PUBLIC;
REVOKE ALL ON tb_episode_events FROM PUBLIC;
REVOKE ALL ON tb_retrieval_revisions FROM PUBLIC;
REVOKE ALL ON tb_working_set FROM PUBLIC;
REVOKE ALL ON tb_pins FROM PUBLIC;
REVOKE ALL ON tb_consolidation_runs FROM PUBLIC;
REVOKE ALL ON tb_consolidation_lease FROM PUBLIC;
REVOKE ALL ON tb_consolidated_facts FROM PUBLIC;
REVOKE ALL ON tb_consolidation_proposals FROM PUBLIC;
REVOKE ALL ON tb_consolidation_checkpoints FROM PUBLIC;
REVOKE ALL ON tb_consolidation_run_bindings FROM PUBLIC;
REVOKE ALL ON tb_consolidation_audit FROM PUBLIC;
REVOKE ALL ON tb_worker_heartbeats FROM PUBLIC;
REVOKE ALL ON team_brain_schema_version FROM PUBLIC;
REVOKE ALL ON team_brain_obligations FROM PUBLIC;
REVOKE ALL ON team_brain_obligation_dependencies FROM PUBLIC;
REVOKE ALL ON team_brain_obligation_events FROM PUBLIC;
REVOKE ALL ON team_brain_handoffs FROM PUBLIC;
REVOKE ALL ON team_brain_handoff_events FROM PUBLIC;
