-- reservation_inventory_settings and reservation_rate_plans are the only two reservation-domain
-- tables writable directly through RLS (`grant select, insert, update ... to authenticated`, RLS
-- policy `using/with check (has_workspace_access(owner_id))`) rather than exclusively through a
-- SECURITY DEFINER RPC. has_workspace_access(owner_id) correctly gates WHICH workspace a write
-- can land in, but nothing gated WHO the write is attributed to: created_by/updated_by are plain
-- not-null uuid columns with no default and no constraint tying them to auth.uid(), so any
-- authorized workspace member (owner or co-owner) could set created_by/updated_by to an arbitrary
-- valid auth.users id via a direct API call -- forging "who did this" for the one part of the
-- reservation domain not already behind a SECURITY DEFINER RPC that derives the actor itself. The
-- one existing app route (src/app/api/rental/reservations/inventory/route.js) happens to always
-- send the real session's own user id, but that is an application-layer courtesy, not a database
-- guarantee -- exactly the gap this migration closes, matching the "never trust a client-supplied
-- actor id" rule already enforced everywhere else in this schema (has_workspace_access RPCs,
-- confirm_owner_reservation, import_reservation_inventory_bulk, the financial-account-group RPCs).
--
-- This also fixes a second, related bug as a side effect: reservation_rate_plans.created_by was
-- being resent (and silently overwritten) on every upsert from that same route, so editing an
-- existing rate plan as a different user erased the ORIGINAL creator. Forcing created_by
-- immutable on UPDATE (never re-derived from auth.uid() after insert) fixes that too.
create or replace function enforce_reservation_inventory_settings_actor()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
  end if;
  new.updated_by := auth.uid();
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists trg_enforce_reservation_inventory_settings_actor on reservation_inventory_settings;
create trigger trg_enforce_reservation_inventory_settings_actor
before insert or update on reservation_inventory_settings
for each row execute function enforce_reservation_inventory_settings_actor();

create or replace function enforce_reservation_rate_plan_actor()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists trg_enforce_reservation_rate_plan_actor on reservation_rate_plans;
create trigger trg_enforce_reservation_rate_plan_actor
before insert or update on reservation_rate_plans
for each row execute function enforce_reservation_rate_plan_actor();
