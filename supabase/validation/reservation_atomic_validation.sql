\set ON_ERROR_STOP on
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '11111111-1111-4111-8111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'reservation-owner@example.test', '',
  now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
),
(
  '22222222-2222-4222-8222-222222222222',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'unrelated-user@example.test', '',
  now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
);

insert into rental_units (
  owner_id, id, property_id, label, status
) values (
  '11111111-1111-4111-8111-111111111111',
  'validation-unit',
  'validation-property',
  'Validation RV Site',
  'available'
);

insert into reservation_inventory_settings (
  owner_id, unit_id, inventory_type, booking_status, public_name,
  maximum_guests, minimum_nights, maximum_nights, turnover_buffer_hours,
  created_by, updated_by, cleaning_fee_cents, security_deposit_cents,
  lodging_tax_basis_points
) values (
  '11111111-1111-4111-8111-111111111111',
  'validation-unit',
  'rv_site',
  'active',
  'Validation RV Site',
  4,
  2,
  30,
  24,
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  5000,
  10000,
  1000
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

select id, status, total_due_cents
from confirm_owner_reservation(
  '11111111-1111-4111-8111-111111111111',
  'validation-reservation-1',
  'validation-guest-1',
  'validation-unit',
  'Validation Guest',
  'validation-guest@example.test',
  '555-0100',
  '2030-01-10',
  '2030-01-13',
  2,
  30000,
  5000,
  3000,
  10000,
  48000,
  'USD',
  'validation-source-1',
  'Atomic validation'
);

do $validation$
declare
  v_row reservations;
  v_rejected boolean;
begin
  if (select count(*) from reservations where id='validation-reservation-1') <> 1
     or (select count(*) from reservation_guests where id='validation-guest-1') <> 1
     or (select count(*) from reservation_events where reservation_id='validation-reservation-1') <> 1
     or (select count(*) from reservation_calendar_blocks where source_reference='validation-reservation-1') <> 1
  then
    raise exception 'Initial confirmation did not atomically create exactly one row in each table.';
  end if;

  select * into v_row from confirm_owner_reservation(
    '11111111-1111-4111-8111-111111111111',
    'validation-reservation-1',
    'validation-guest-1',
    'validation-unit',
    'Validation Guest',
    'validation-guest@example.test',
    '555-0100',
    '2030-01-10',
    '2030-01-13',
    2,
    30000,
    5000,
    3000,
    10000,
    48000,
    'USD',
    'validation-source-1',
    'Atomic validation'
  );

  if v_row.id <> 'validation-reservation-1'
     or (select count(*) from reservations where id='validation-reservation-1') <> 1
     or (select count(*) from reservation_events where reservation_id='validation-reservation-1') <> 1
     or (select count(*) from reservation_calendar_blocks where source_reference='validation-reservation-1') <> 1
  then
    raise exception 'Exact retry was not idempotent.';
  end if;

  v_rejected := false;
  begin
    perform confirm_owner_reservation(
      '11111111-1111-4111-8111-111111111111',
      'validation-overlap',
      'validation-guest-overlap',
      'validation-unit',
      'Overlap Guest',
      'overlap@example.test',
      '',
      '2030-01-11',
      '2030-01-14',
      1,
      30000, 0, 0, 0, 30000, 'USD',
      'validation-overlap',
      ''
    );
  exception when others then
    if position('no longer available' in sqlerrm) > 0
       or position('dates are blocked' in sqlerrm) > 0 then
      v_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_rejected then raise exception 'Overlapping reservation was accepted.'; end if;

  v_rejected := false;
  begin
    perform confirm_owner_reservation(
      '11111111-1111-4111-8111-111111111111',
      'validation-buffer',
      'validation-guest-buffer',
      'validation-unit',
      'Buffer Guest',
      'buffer@example.test',
      '',
      '2030-01-13',
      '2030-01-15',
      1,
      20000, 0, 0, 0, 20000, 'USD',
      'validation-buffer',
      ''
    );
  exception when others then
    if position('no longer available' in sqlerrm) > 0
       or position('dates are blocked' in sqlerrm) > 0 then
      v_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_rejected then raise exception 'Turnover-buffer conflict was accepted.'; end if;

  v_rejected := false;
  begin
    perform confirm_owner_reservation(
      '11111111-1111-4111-8111-111111111111',
      'validation-bad-total',
      'validation-guest-bad-total',
      'validation-unit',
      'Bad Total Guest',
      'bad-total@example.test',
      '',
      '2030-02-10',
      '2030-02-12',
      1,
      20000, 5000, 0, 0, 20001, 'USD',
      'validation-bad-total',
      ''
    );
  exception when others then
    if position('quote total is invalid' in sqlerrm) > 0 then
      v_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_rejected then raise exception 'Invalid quote total was accepted.'; end if;

  if exists (
    select 1 from reservations
    where id in ('validation-overlap','validation-buffer','validation-bad-total')
  ) or exists (
    select 1 from reservation_guests
    where id in ('validation-guest-overlap','validation-guest-buffer','validation-guest-bad-total')
  ) then
    raise exception 'A rejected confirmation left partial rows.';
  end if;
end
$validation$;

select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',
  true
);

do $validation$
declare v_rejected boolean := false;
begin
  begin
    perform confirm_owner_reservation(
      '11111111-1111-4111-8111-111111111111',
      'validation-unauthorized',
      'validation-guest-unauthorized',
      'validation-unit',
      'Unauthorized Guest',
      'unauthorized@example.test',
      '',
      '2030-03-10',
      '2030-03-12',
      1,
      20000, 0, 0, 0, 20000, 'USD',
      'validation-unauthorized',
      ''
    );
  exception when others then
    if position('Workspace access is required' in sqlerrm) > 0 then
      v_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_rejected then raise exception 'Unrelated authenticated user was authorized.'; end if;
end
$validation$;

reset role;

do $validation$
declare v_rejected boolean := false;
begin
  begin
    update reservation_events
       set event_payload='{"tampered":true}'::jsonb
     where reservation_id='validation-reservation-1';
  exception when others then
    if position('immutable' in sqlerrm) > 0 then
      v_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_rejected then raise exception 'Reservation event update was permitted.'; end if;

  v_rejected := false;
  begin
    delete from reservation_events
     where reservation_id='validation-reservation-1';
  exception when others then
    if position('immutable' in sqlerrm) > 0 then
      v_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_rejected then raise exception 'Reservation event deletion was permitted.'; end if;
end
$validation$;

select
  'RESERVATION_ATOMIC_VALIDATION_PASS' as result,
  (select count(*) from reservations where id='validation-reservation-1') as reservations,
  (select count(*) from reservation_guests where id='validation-guest-1') as guests,
  (select count(*) from reservation_events where reservation_id='validation-reservation-1') as events,
  (select count(*) from reservation_calendar_blocks where source_reference='validation-reservation-1') as calendar_blocks;

rollback;
