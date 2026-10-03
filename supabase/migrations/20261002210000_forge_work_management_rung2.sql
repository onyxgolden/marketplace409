-- FORGE Work Management Rung 2: Typed Object Links.
--
-- forge_work_links: typed relationships between a Work Package and
-- authoritative records in other FORGE domains (schedule blocks, drawings,
-- documents, vendors, assets, ...). Links reference; they never copy domain
-- data, never confer access, and never cross workspace owners.
--
-- forge_work_link_confirmations: immutable append-only history of who
-- confirmed each AI-suggested link. Enforced by trigger, not just convention.
--
-- Isolation follows the shared-workspace model (NOT owner-only): owner_id is
-- the effective workspace owner and RLS uses has_workspace_access(owner_id),
-- matching Rung 1. Both link endpoints must resolve inside the link's own
-- workspace; a cross-workspace endpoint simply does not resolve and the link
-- can never be created or reach active.
--
-- All tables are additive. Safe to re-run: tables/policies/indexes/triggers
-- use IF NOT EXISTS / DROP IF EXISTS guards.

-- ---------------------------------------------------------------------------
-- forge_work_links — the typed relationship record.
-- ---------------------------------------------------------------------------
create table if not exists forge_work_links (
  owner_id text not null,
  id text not null default ('forge_wlink_' || gen_random_uuid()::text),
  -- Endpoints: domain + type + canonical id in the source domain.
  source_domain text not null,
  source_type text not null,
  source_id text not null,
  source_locator text,
  source_version text,
  target_domain text not null,
  target_type text not null,
  target_id text not null,
  -- Relationship from the closed vocabulary; canonical orientation is fixed
  -- per type (see docs/forge-work-management/object-relationship-contract.md).
  relationship_type text not null,
  -- Provenance: who/what created the link and on what basis.
  created_by text not null,
  created_at timestamptz not null default now(),
  observed_at timestamptz,
  provenance text not null default 'user_confirmed',
  confirmed_by text,
  confirmed_at timestamptz,
  -- Resolution state: unresolved (new) -> active | broken;
  -- active -> stale | broken; stale -> active | broken; broken -> active.
  status text not null default 'unresolved',
  resolved_at timestamptz,
  resolved_state text,
  -- Small typed extras (zone, activity_type, evidence meaning, revision
  -- ref). Never domain data.
  annotation jsonb,
  notes text,
  primary key (owner_id, id),
  -- The same fact is recorded once, in its canonical orientation.
  unique (owner_id, source_domain, source_type, source_id,
          target_domain, target_type, target_id, relationship_type),
  constraint forge_work_links_provenance_check check (provenance in (
    'user_confirmed', 'deterministic_import', 'ai_proposed')),
  constraint forge_work_links_status_check check (status in (
    'unresolved', 'active', 'stale', 'broken')),
  constraint forge_work_links_resolved_state_check check (
    resolved_state is null or resolved_state in ('ok', 'moved', 'unavailable'))
);

create index if not exists forge_work_links_source_idx
  on forge_work_links (owner_id, source_domain, source_type, source_id);
create index if not exists forge_work_links_target_idx
  on forge_work_links (owner_id, target_domain, target_type, target_id);
create index if not exists forge_work_links_status_idx
  on forge_work_links (owner_id, status);
create index if not exists forge_work_links_relationship_idx
  on forge_work_links (owner_id, relationship_type);

-- ---------------------------------------------------------------------------
-- forge_work_link_confirmations — immutable history of AI-link confirmations.
-- Accepting an ai_proposed link inserts a row here AND flips the link's
-- provenance; the original proposal and every confirmation live forever.
-- ---------------------------------------------------------------------------
create table if not exists forge_work_link_confirmations (
  owner_id text not null,
  id text not null default ('forge_wlconf_' || gen_random_uuid()::text),
  link_id text not null,
  confirmed_by text not null,
  confirmed_at timestamptz not null default now(),
  prior_provenance text not null,
  note text,
  primary key (owner_id, id)
);

create index if not exists forge_work_link_confirmations_link_idx
  on forge_work_link_confirmations (owner_id, link_id, confirmed_at desc);

-- Append-only enforcement: updates and deletes are forbidden at the DB level.
create or replace function forge_work_link_confirmations_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'forge_work_link_confirmations is append-only; updates and deletes are forbidden';
end;
$$;

drop trigger if exists forge_work_link_confirmations_no_write
  on forge_work_link_confirmations;
create trigger forge_work_link_confirmations_no_write
  before update or delete on forge_work_link_confirmations
  for each row execute function forge_work_link_confirmations_immutable();

-- ---------------------------------------------------------------------------
-- RLS: shared-workspace model, same as Rung 1.
-- ---------------------------------------------------------------------------
alter table forge_work_links enable row level security;
alter table forge_work_link_confirmations enable row level security;

do $$
declare t text;
begin
  foreach t in array array['forge_work_links', 'forge_work_link_confirmations']
  loop
    execute format('drop policy if exists %I on %I',
      'forge_work_' || replace(t, 'forge_work_', '') || '_workspace_all', t);
    execute format(
      'create policy %I on %I for all to authenticated using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id))',
      'forge_work_' || replace(t, 'forge_work_', '') || '_workspace_all', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Attribution triggers: the audit trail records the TRUE caller.
--
-- created_by / confirmed_by are caller-supplied text. Without these a
-- workspace member could file links or confirmations under someone else's
-- identity (the owner, the brain) through direct table writes — and the
-- application service itself used to honor a caller-supplied created_by.
-- When a user JWT is present the database stamps auth.uid(); service_role
-- writes (imports, brain proposals with no JWT) keep their supplied values.
-- ---------------------------------------------------------------------------
create or replace function forge_work_links_stamp_attribution()
returns trigger language plpgsql as $$
declare v_caller text := nullif(auth.uid()::text, '');
begin
  if v_caller is not null then
    if TG_OP = 'INSERT' then
      NEW.created_by := v_caller;
    elsif NEW.confirmed_by is distinct from OLD.confirmed_by then
      NEW.confirmed_by := v_caller;
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists forge_work_links_attribution_trg on forge_work_links;
create trigger forge_work_links_attribution_trg
  before insert or update on forge_work_links
  for each row execute function forge_work_links_stamp_attribution();

create or replace function forge_work_link_confirmations_stamp_attribution()
returns trigger language plpgsql as $$
declare v_caller text := nullif(auth.uid()::text, '');
begin
  if v_caller is not null then
    NEW.confirmed_by := v_caller;
  end if;
  return NEW;
end $$;
drop trigger if exists forge_work_link_confirmations_attribution_trg
  on forge_work_link_confirmations;
create trigger forge_work_link_confirmations_attribution_trg
  before insert on forge_work_link_confirmations
  for each row execute function forge_work_link_confirmations_stamp_attribution();

-- ---------------------------------------------------------------------------
-- Status guard: the documented resolution lifecycle is a database invariant,
-- not just a JS convention.
--   unresolved -> active | broken; active -> stale | broken;
--   stale -> active | broken; broken -> active.
-- New links are born unresolved (service_role backfills with no JWT may
-- insert historical states directly).
-- ---------------------------------------------------------------------------
create or replace function forge_work_links_status_guard()
returns trigger language plpgsql as $$
declare v_caller text := nullif(auth.uid()::text, '');
begin
  if TG_OP = 'INSERT' then
    if v_caller is not null and NEW.status <> 'unresolved' then
      raise exception 'forge_work: links are created unresolved';
    end if;
    return NEW;
  end if;
  if NEW.status is distinct from OLD.status then
    if not (
      (OLD.status = 'unresolved' and NEW.status in ('active', 'broken')) or
      (OLD.status = 'active' and NEW.status in ('stale', 'broken')) or
      (OLD.status = 'stale' and NEW.status in ('active', 'broken')) or
      (OLD.status = 'broken' and NEW.status = 'active')
    ) then
      raise exception 'forge_work: illegal link status transition % -> %',
        OLD.status, NEW.status;
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists forge_work_links_status_guard_trg on forge_work_links;
create trigger forge_work_links_status_guard_trg
  before insert or update on forge_work_links
  for each row execute function forge_work_links_status_guard();
