-- Work Package Planner — Industrial / Commercial mode selector.
--
-- FILE ONLY in this PR. Do NOT apply to production without a merge +
-- Muse's GO (the apply-on-GO standing rule for this specific PR, Jason
-- 2026-11-10 ~14:03 CST, supersedes the usual separate-word requirement).
--
-- One additive column. `mode` is a display/validation lens, never a
-- data rewrite: `ADD COLUMN ... NOT NULL DEFAULT 'industrial'` backfills
-- every existing row to 'industrial' as a single fast metadata
-- operation (Postgres 11+) — no UPDATE statement, no table rewrite, and
-- every other column (unit/area/system/property_id/package_type, etc.)
-- is untouched. Toggling mode on an existing package later changes only
-- which fields its own UI surfaces show; it never clears or rewrites
-- the fields belonging to the other mode.
--
-- No new table, no new function, no new RLS policy: a column add to an
-- existing table changes no grants (table-level ACLs and RLS policies
-- are column-agnostic) — same reasoning as 20261109000000's source-
-- tracking columns. No GRANT/REVOKE block is owed here.

alter table forge_work_packages
  add column if not exists mode text not null default 'industrial';

-- Idempotent CHECK add: a plain `ADD CONSTRAINT` (this repo's usual
-- pattern, e.g. 20261109000000's chk_forge_work_packages_source_pair)
-- is NOT safe to reapply as-is — Postgres has no
-- `ADD CONSTRAINT IF NOT EXISTS`. Guarded here so the "reapply
-- migration" acceptance gate actually passes a second run, not just
-- matches an unguarded precedent.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_forge_work_packages_mode'
      and conrelid = 'forge_work_packages'::regclass
  ) then
    alter table forge_work_packages
      add constraint chk_forge_work_packages_mode
        check (mode in ('industrial', 'commercial'));
  end if;
end $$;

comment on column forge_work_packages.mode is
  'Industrial vs Commercial (real-estate) planner mode. Controls which optional fields (Unit/Area/System vs Property) the UI/import layer shows and validates for this package. Toggling it never rewrites unit/area/system/property_id/package_type — those stay exactly as stored. Default industrial: every row that existed before this migration reads back as industrial with all prior data intact.';
