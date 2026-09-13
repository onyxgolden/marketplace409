alter table public.reservation_inventory_settings
  add column if not exists public_guest_agreement text not null default 'Guests agree to follow the property rules and are responsible for damage caused during the stay.',
  add column if not exists public_access_release_hours smallint not null default 24
    check (public_access_release_hours between 0 and 168);

alter table public.reservations
  add column if not exists guest_agreement_text text,
  add column if not exists guest_agreement_acknowledged_at timestamptz,
  add column if not exists guest_access_token text,
  add column if not exists guest_access_release_at timestamptz;

create unique index if not exists reservations_guest_access_token_key
  on public.reservations(guest_access_token) where guest_access_token is not null;

create or replace function public.stamp_public_reservation_agreement_and_access()
returns trigger language plpgsql security definer set search_path = public set row_security = off
as $$
declare v_settings public.reservation_inventory_settings;
begin
  if new.source_system = 'forge_direct' and new.created_by is null then
    select * into strict v_settings from public.reservation_inventory_settings
      where owner_id = new.owner_id and unit_id = new.unit_id;
    if nullif(btrim(v_settings.public_guest_agreement), '') is null then
      raise exception 'A guest agreement is required for public booking.';
    end if;
    new.guest_agreement_text := v_settings.public_guest_agreement;
    new.guest_agreement_acknowledged_at := now();
    new.guest_access_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    new.guest_access_release_at := ((new.check_in_date + v_settings.check_in_time) at time zone v_settings.timezone)
      - make_interval(hours => v_settings.public_access_release_hours);
  end if;
  return new;
end $$;

drop trigger if exists stamp_public_reservation_agreement_and_access on public.reservations;
create trigger stamp_public_reservation_agreement_and_access
  before insert on public.reservations for each row
  execute function public.stamp_public_reservation_agreement_and_access();

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
      || v_slug || '/access?token=' || v_token;
  end if;
  return new;
end $$;

drop trigger if exists append_reservation_access_link_to_confirmation on public.reservation_confirmation_outbox;
create trigger append_reservation_access_link_to_confirmation
  before insert on public.reservation_confirmation_outbox for each row
  execute function public.append_reservation_access_link_to_confirmation();

create or replace function public.get_public_reservation_access(p_booking_slug text, p_access_token text)
returns jsonb language plpgsql security definer set search_path = public set row_security = off
as $$
declare v_reservation public.reservations; v_settings public.reservation_inventory_settings; v_available boolean;
begin
  if nullif(btrim(p_booking_slug), '') is null or nullif(btrim(p_access_token), '') is null then
    raise exception 'Reservation access was not found.';
  end if;
  select r.* into v_reservation from public.reservations r
    join public.reservation_inventory_settings s on s.owner_id = r.owner_id and s.unit_id = r.unit_id
    where s.public_booking_slug = p_booking_slug and r.guest_access_token = p_access_token
      and r.status in ('confirmed', 'checked_in');
  if not found then raise exception 'Reservation access was not found.'; end if;
  select * into strict v_settings from public.reservation_inventory_settings
    where owner_id = v_reservation.owner_id and unit_id = v_reservation.unit_id;
  v_available := now() >= v_reservation.guest_access_release_at;
  return jsonb_build_object(
    'publicName', v_settings.public_name,
    'checkIn', v_reservation.check_in_date,
    'checkOut', v_reservation.check_out_date,
    'available', v_available,
    'availableAt', v_reservation.guest_access_release_at,
    'arrivalInstructions', case when v_available then v_settings.public_arrival_instructions else null end
  );
end $$;

revoke all on function public.stamp_public_reservation_agreement_and_access() from public, anon, authenticated;
revoke all on function public.append_reservation_access_link_to_confirmation() from public, anon, authenticated;
revoke all on function public.get_public_reservation_access(text, text) from public, anon, authenticated;
grant execute on function public.get_public_reservation_access(text, text) to service_role;
