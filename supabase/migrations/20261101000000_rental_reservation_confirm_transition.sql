-- B7 confirm leg (landlord decision 2026-10-31): a landlord may confirm a held
-- reservation from the Reservations panel. This is a pure status transition in the
-- existing transition_owner_reservation function, following the cancel leg exactly:
-- same owner/workspace gate, same row lock, same audit event, same error wording.
--
-- No other behavior changes:
-- - The financial-contract snapshot already exists from insert (every reservation
--   gets one immediately on insert per 20260913040000), so confirming does not
--   create or freeze anything new; it only unlocks the already-guarded
--   modify/check_in paths, which both require status 'confirmed'.
-- - No payment is charged by any transition (cancel/check_in/check_out do not
--   charge either); the panel states "No payment is charged here."
-- - Calendar blocks are untouched by confirm: held reservations already block
--   their dates, and blocks are only released on cancelled/checked_out.
-- - The event_type written is 'confirmed', already in the reservation_events
--   CHECK constraint (20260913010000) -- no constraint change needed.
-- - The reservations.status CHECK already includes 'held' and 'confirmed'
--   (20260901000200) -- no constraint change needed.
-- - CREATE OR REPLACE preserves the existing grants (EXECUTE to authenticated
--   only); no grant statements are repeated here.
-- - Idempotency follows the function's existing convention: confirming an
--   already-confirmed reservation returns the row unchanged (same as cancelling
--   an already-cancelled one). Every other non-held status raises.
create or replace function public.transition_owner_reservation(
  p_owner_id text,
  p_reservation_id text,
  p_action text,
  p_reason text default null
) returns public.reservations
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_current public.reservations;
  v_target text;
  v_result public.reservations;
begin
  if v_actor is null or not public.has_workspace_access(p_owner_id) then
    raise exception 'Workspace access is required.';
  end if;
  if p_action not in ('cancel','check_in','check_out','confirm') then
    raise exception 'Reservation action is invalid.';
  end if;

  select * into v_current from public.reservations
  where owner_id = p_owner_id and id = p_reservation_id for update;
  if not found then raise exception 'Reservation was not found.'; end if;

  -- Explicit arms (the original used `else 'checked_out'`, which would have
  -- silently mapped the new 'confirm' action to checked_out).
  v_target := case p_action
    when 'cancel' then 'cancelled'
    when 'check_in' then 'checked_in'
    when 'check_out' then 'checked_out'
    when 'confirm' then 'confirmed'
  end;
  if v_current.status = v_target then return v_current; end if;
  if (p_action = 'cancel' and v_current.status not in ('held','confirmed'))
     or (p_action = 'check_in' and v_current.status <> 'confirmed')
     or (p_action = 'check_out' and v_current.status <> 'checked_in')
     or (p_action = 'confirm' and v_current.status <> 'held') then
    raise exception 'Reservation cannot transition from % using %.', v_current.status, p_action;
  end if;

  update public.reservations set
    status = v_target,
    cancelled_at = case when v_target = 'cancelled' then now() else cancelled_at end,
    updated_at = now()
  where owner_id = p_owner_id and id = p_reservation_id
  returning * into v_result;

  if v_target in ('cancelled','checked_out') then
    delete from public.reservation_calendar_blocks
    where owner_id = p_owner_id and source_system = 'forge' and source_reference = p_reservation_id;
  end if;

  insert into public.reservation_events(owner_id,id,reservation_id,event_type,event_payload,acting_user_id)
  values (p_owner_id, 'reservation_event_' || gen_random_uuid()::text, p_reservation_id, v_target,
    jsonb_build_object('previousStatus',v_current.status,'reason',nullif(btrim(p_reason),'')), v_actor);
  return v_result;
end $$;
