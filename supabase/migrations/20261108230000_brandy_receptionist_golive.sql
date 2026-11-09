-- Brandy receptionist GO-LIVE slice (2026-11-08): additive columns only.
--
-- What this adds and why (no behavior change to v1 rows):
--   calls.source               TEST | LIVE | SYNTHETIC — labels every call
--                              so test traffic can never be mistaken for a
--                              live tenant call in the inbox. Existing rows
--                              backfill to SYNTHETIC (v1 records were
--                              synthetic/offline by construction).
--   calls.cost_estimate_usd    per-call provider cost estimate (USD) from
--                              the worker's versioned rate table (see
--                              services/brandy-receptionist/app/cost.py).
--   calls.cost_rate_version    the rate-table version that priced the
--                              estimate, so it is always traceable.
--   alerts.refused_reason      why a dispatch was refused by the live gate
--                              (mode OFF / kill switch / no consented
--                              recipient). NULL when not refused.
--   alerts.resolution_state    CHECK widened to include 'REFUSED' — the
--                              dispatcher records a gate-refused alert as
--                              REFUSED/UNRESOLVED (never silently dropped,
--                              never retried against the provider). This is
--                              a pure widening: every value allowed before
--                              is still allowed.
--
-- Posture (same as 20261108020000): additive only, IF NOT EXISTS, no
-- grants, no RLS changes (new columns inherit the tables' RLS + FORCE),
-- no new tables or functions, no data rewritten. Apply needs a separate
-- owner word; this file is NOT applied by the build.
-- Idempotent: safe to apply twice (the RLS proof harness does).

alter table public.forge_rental_receptionist_calls
  add column if not exists source text not null default 'SYNTHETIC'
    constraint receptionist_calls_source_check
    check (source in ('TEST', 'LIVE', 'SYNTHETIC'));

alter table public.forge_rental_receptionist_calls
  add column if not exists cost_estimate_usd numeric(10, 4);

alter table public.forge_rental_receptionist_calls
  add column if not exists cost_rate_version text;

alter table public.forge_rental_receptionist_alerts
  add column if not exists refused_reason text;

-- Widen the resolution_state CHECK to admit 'REFUSED'. The inline CHECK
-- from 20261108020000 is named by Postgres
-- forge_rental_receptionist_alerts_resolution_state_check; drop it and
-- re-add with the wider set. Dropping + re-adding the same constraint
-- name is idempotent across re-applies.
alter table public.forge_rental_receptionist_alerts
  drop constraint if exists forge_rental_receptionist_alerts_resolution_state_check;

alter table public.forge_rental_receptionist_alerts
  add constraint forge_rental_receptionist_alerts_resolution_state_check
  check (resolution_state in ('UNRESOLVED', 'ACKNOWLEDGED', 'DEAD_LETTER', 'REFUSED'));
