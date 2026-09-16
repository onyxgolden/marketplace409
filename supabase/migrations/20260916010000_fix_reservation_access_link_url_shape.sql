-- Forward-fix: append_reservation_access_link_to_confirmation() (20260913030000_add_guest_
-- agreement_and_timed_access.sql, already live in production) embeds the guest access URL in the
-- confirmation notification body as `/book/<slug>/access?token=<token>` -- a long-lived bearer
-- credential riding in a query string, which lands in server access logs, browser history, and can
-- leak via Referer to any third-party resource the page ever loads. The frontend route for this page
-- has been moved from a query-string token to a path segment (`/book/<slug>/access/<token>`) for
-- exactly that reason. This migration updates the trigger function to match, so guest confirmation
-- emails link to a URL that actually resolves. No data is modified; this is a function-definition
-- change only, and does not affect any already-sent notification (their body_text was already
-- written and is not retroactively rewritten).

create or replace function public.append_reservation_access_link_to_confirmation()
returns trigger language plpgsql security definer set search_path = public set row_security = off
as $$
declare v_token text; v_slug text; v_name text; v_check_in date; v_check_out date; v_total bigint;
begin
  select r.guest_access_token, s.public_booking_slug, s.public_name, r.check_in_date, r.check_out_date, r.total_due_cents
    into v_token, v_slug, v_name, v_check_in, v_check_out, v_total
    from public.reservations r
    join public.reservation_inventory_settings s on s.owner_id = r.owner_id and s.unit_id = r.unit_id
    where r.owner_id = new.owner_id and r.id = new.reservation_id;
  if v_token is not null and v_slug is not null then
    new.body_text := 'Your reservation at ' || v_name || ' is confirmed for ' || v_check_in || ' through ' || v_check_out
      || '. Total due: $' || to_char(v_total / 100.0, 'FM999999990.00')
      || '. No payment was collected during booking. Arrival and access details are released closer to check-in: /book/'
      || v_slug || '/access/' || v_token;
  end if;
  return new;
end $$;

-- create or replace function never resets previously-granted privileges (this function is trigger
-- -only and was never directly callable), but restated idempotently for self-containment.
revoke all on function public.append_reservation_access_link_to_confirmation() from public, anon, authenticated;
