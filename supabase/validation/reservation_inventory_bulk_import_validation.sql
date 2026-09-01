\set ON_ERROR_STOP on
begin;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('33333333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bulk-owner@example.test','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
('44444444-4444-4444-8444-444444444444','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bulk-outsider@example.test','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());

set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);

select import_reservation_inventory_bulk(
  '33333333-3333-4333-8333-333333333333','validation-import-1','digest-1',
  '[
    {"unitId":"bulk-unit-1","ratePlanId":"bulk-rate-1","propertyId":"Validation Park","unitLabel":"Site 1","inventoryType":"rv_site","bookingStatus":"draft","publicName":"Validation Site 1","publicDescription":null,"timezone":"America/Chicago","maximumGuests":6,"minimumNights":1,"maximumNights":30,"turnoverBufferHours":24,"amenities":["50 amp","water"],"nightlyRateCents":5500,"cleaningFeeCents":1000,"securityDepositCents":10000,"lodgingTaxBasisPoints":825,"effectiveStartDate":"2030-01-01"},
    {"unitId":"bulk-unit-2","ratePlanId":"bulk-rate-2","propertyId":"Validation Park","unitLabel":"Cabin 1","inventoryType":"cabin","bookingStatus":"draft","publicName":"Validation Cabin 1","publicDescription":null,"timezone":"America/Chicago","maximumGuests":4,"minimumNights":2,"maximumNights":14,"turnoverBufferHours":24,"amenities":["kitchen","Wi-Fi"],"nightlyRateCents":12500,"cleaningFeeCents":4500,"securityDepositCents":15000,"lodgingTaxBasisPoints":825,"effectiveStartDate":"2030-01-01"}
  ]'::jsonb
);

do $validation$
declare v_result jsonb; v_rejected boolean;
begin
  if (select count(*) from rental_units where id in ('bulk-unit-1','bulk-unit-2')) <> 2
    or (select count(*) from reservation_inventory_settings where unit_id in ('bulk-unit-1','bulk-unit-2')) <> 2
    or (select count(*) from reservation_rate_plans where id in ('bulk-rate-1','bulk-rate-2')) <> 2
    or (select count(*) from reservation_inventory_imports where id='validation-import-1') <> 1
  then raise exception 'Atomic import did not create exactly two complete records.'; end if;

  select import_reservation_inventory_bulk(
    '33333333-3333-4333-8333-333333333333','validation-import-1','digest-1',
    '[{"unitId":"ignored-on-exact-retry"}]'::jsonb
  ) into v_result;
  if (v_result->>'createdUnits')::integer <> 2
    or (select count(*) from rental_units where property_id='Validation Park') <> 2
  then raise exception 'Exact retry was not idempotent.'; end if;

  v_rejected := false;
  begin
    perform import_reservation_inventory_bulk('33333333-3333-4333-8333-333333333333','validation-import-1','changed-digest','[]'::jsonb);
  exception when others then
    if position('different plan' in sqlerrm) > 0 then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'Changed plan was accepted.'; end if;

  v_rejected := false;
  begin
    perform import_reservation_inventory_bulk(
      '33333333-3333-4333-8333-333333333333','validation-import-rollback','rollback-digest',
      '[
        {"unitId":"rollback-unit-1","ratePlanId":"rollback-rate-1","propertyId":"Rollback Park","unitLabel":"Site 1","inventoryType":"rv_site","bookingStatus":"draft","publicName":"Rollback Site 1","timezone":"America/Chicago","maximumGuests":4,"minimumNights":1,"maximumNights":30,"turnoverBufferHours":0,"amenities":[],"nightlyRateCents":5000,"cleaningFeeCents":0,"securityDepositCents":0,"lodgingTaxBasisPoints":0,"effectiveStartDate":"2030-01-01"},
        {"unitId":"rollback-unit-2","ratePlanId":"rollback-rate-2","propertyId":"Rollback Park","unitLabel":"Site 2","inventoryType":"rv_site","bookingStatus":"draft","publicName":"Rollback Site 2","timezone":"America/Chicago","maximumGuests":4,"minimumNights":1,"maximumNights":30,"turnoverBufferHours":0,"amenities":[],"nightlyRateCents":0,"cleaningFeeCents":0,"securityDepositCents":0,"lodgingTaxBasisPoints":0,"effectiveStartDate":"2030-01-01"}
      ]'::jsonb
    );
  exception when others then
    if position('row 2 is invalid' in lower(sqlerrm)) > 0 then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'Invalid later row was accepted.'; end if;
  if exists(select 1 from rental_units where id like 'rollback-unit-%')
    or exists(select 1 from reservation_inventory_settings where unit_id like 'rollback-unit-%')
    or exists(select 1 from reservation_rate_plans where id like 'rollback-rate-%')
    or exists(select 1 from reservation_inventory_imports where id='validation-import-rollback')
  then raise exception 'Rejected import left partial data.'; end if;
end
$validation$;

select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
do $validation$
declare v_rejected boolean := false;
begin
  begin
    perform import_reservation_inventory_bulk('33333333-3333-4333-8333-333333333333','validation-unauthorized','unauthorized-digest','[]'::jsonb);
  exception when others then
    if position('Workspace access is required' in sqlerrm) > 0 then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'Unrelated authenticated user was authorized.'; end if;
end
$validation$;

reset role;
select 'RESERVATION_BULK_IMPORT_VALIDATION_PASS' as result,
  (select count(*) from rental_units where property_id='Validation Park') as units,
  (select count(*) from reservation_inventory_settings where unit_id in ('bulk-unit-1','bulk-unit-2')) as inventory,
  (select count(*) from reservation_rate_plans where id in ('bulk-rate-1','bulk-rate-2')) as rates,
  (select count(*) from reservation_inventory_imports where id='validation-import-1') as imports;
rollback;
