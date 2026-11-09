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
-- No new tables or policies: adding columns and indexes to
-- existing tables changes no grants (table-level ACLs and RLS
-- policies are column-agnostic), so no GRANT/REVOKE block is owed
-- for the columns — unlike the slice migrations that created
-- tables. The ONE function below (the step source-stamp RPC) DOES
-- carry its own grant block, following slice 5 exactly: EXECUTE
-- revoked from PUBLIC, granted to authenticated only.
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

-- Trusted step source-stamp RPC (fix round 1, PR #759 review P1).
--
-- Steps stamp through this RPC, never a direct client write:
-- slice 5 grants SELECT only to authenticated on forge_work_steps
-- and explicitly revokes insert/update/delete, so a direct UPDATE
-- from the import apply layer is denied in production (the stamp
-- would warn on every imported step and re-imports would
-- duplicate). This RPC is SECURITY DEFINER with row_security off,
-- like the slice-5 step RPCs: it enforces workspace access itself
-- (via has_workspace_access, which reads the caller's auth.uid())
-- and locks the step row, so a concurrent edit serializes here.
--
-- Deliberately NOT a versioned content change: it updates only the
-- two source columns — no version bump, no revision row — so
-- stamping never invalidates an in-flight edit. It also takes no
-- terminal-package refusal: stamping is bookkeeping metadata, not
-- a content change, and the import only stamps steps it just
-- created/updated, which already passed their own RPCs' terminal
-- rule. A stamp that would collide with another step's source
-- record is refused by the unique index (23505) and surfaces as
-- the import's per-row warning — fail-closed, never a silent
-- overwrite of another row's identity.
create or replace function public.forge_work_step_stamp_source(
  p_owner_id text,
  p_package_id text,
  p_step_id text,
  p_source_system text,
  p_source_record_id text
)
returns public.forge_work_steps
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_step public.forge_work_steps%rowtype;
  v_system text;
  v_record text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP5_WORKSPACE_FORBIDDEN';
  end if;
  v_system := btrim(coalesce(p_source_system, ''));
  v_record := btrim(coalesce(p_source_record_id, ''));
  if char_length(v_system) < 1 or char_length(v_system) > 128
     or char_length(v_record) < 1 or char_length(v_record) > 128
     or v_system ~ '[[:cntrl:]]' or v_record ~ '[[:cntrl:]]' then
    raise exception 'WPP5_INVALID_SOURCE';
  end if;
  -- Row lock + same-package parentage: the step must belong to the
  -- package the caller named, or it is a 404, not a stamp.
  select * into v_step from public.forge_work_steps
    where owner_id = p_owner_id
      and work_package_id = p_package_id
      and id = p_step_id
    for update;
  if not found then
    raise exception 'WPP5_STEP_NOT_FOUND';
  end if;
  update public.forge_work_steps
    set source_system = v_system,
        source_record_id = v_record
    where owner_id = p_owner_id
      and work_package_id = p_package_id
      and id = p_step_id
    returning * into v_step;
  return v_step;
end;
$$;

-- Grants (slice-5 pattern — the REVOKE from PUBLIC is load-bearing:
-- functions are EXECUTE-to-PUBLIC by default, so a GRANT alone
-- would leave anon able to call this RPC).
revoke all on function public.forge_work_step_stamp_source(text, text, text, text, text) from public;
grant execute on function public.forge_work_step_stamp_source(text, text, text, text, text) to authenticated;
