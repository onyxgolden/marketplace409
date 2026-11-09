-- Work Package Planner — editable grid slice: file-import idempotency.
--
-- FILE ONLY in this PR. Do NOT apply to production without Jason's
-- separate word (standing rule: migration applies are a separate word).
--
-- Adds source_system + source_record_id to forge_work_packages and
-- forge_work_steps, with the unique index
-- (owner_id, source_system, source_record_id) copied from the
-- financial_events pattern (20260714 partial unique index, where the
-- source id is not null). Re-importing the same SAP / Maximo / P6 /
-- Excel file updates the same rows instead of duplicating them. Rows
-- never imported keep both columns NULL.
--
-- No new tables, functions, or policies: adding columns and indexes
-- to existing tables changes no grants (table-level ACLs and RLS
-- policies are column-agnostic), so no GRANT/REVOKE block is owed
-- here — unlike the slice migrations that created tables.
--
-- The CHECK pairs the two columns: a row either carries both or
-- neither, so a source record id can never dangle without its system.

alter table forge_work_packages
  add column if not exists source_system text,
  add column if not exists source_record_id text;

alter table forge_work_steps
  add column if not exists source_system text,
  add column if not exists source_record_id text;

alter table forge_work_packages
  add constraint chk_forge_work_packages_source_pair
    check ((source_system is null and source_record_id is null)
        or (source_system is not null and source_record_id is not null));

alter table forge_work_steps
  add constraint chk_forge_work_steps_source_pair
    check ((source_system is null and source_record_id is null)
        or (source_system is not null and source_record_id is not null));

create unique index if not exists uq_forge_work_packages_source
  on forge_work_packages (owner_id, source_system, source_record_id)
  where source_record_id is not null;

create unique index if not exists uq_forge_work_steps_source
  on forge_work_steps (owner_id, source_system, source_record_id)
  where source_record_id is not null;
