alter table rental_payments add column if not exists payment_method text
  check (payment_method is null or payment_method in ('us_bank_account','card','cash','cashiers_check'));
alter table rental_payments add column if not exists received_at timestamptz;
alter table rental_payments add column if not exists recorded_by text;
alter table rental_payments add column if not exists receipt_reference text;
alter table rental_payments add column if not exists notes text;

create or replace function record_offline_rental_payment(
  p_owner_id text, p_charge_id text, p_payment_method text, p_amount_cents bigint,
  p_received_at timestamptz, p_receipt_reference text default null, p_notes text default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_charge rent_charges%rowtype; v_payment_id text; v_new_paid bigint; v_status text;
begin
  if auth.uid() is null or auth.uid()::text <> p_owner_id then raise exception 'Authenticated owner id is required.'; end if;
  if p_payment_method not in ('cash','cashiers_check') then raise exception 'Unsupported offline payment method.'; end if;
  if p_amount_cents <= 0 then raise exception 'Offline payment amount must be positive.'; end if;
  if p_received_at is null or p_received_at > now() + interval '5 minutes' then raise exception 'A valid received date is required.'; end if;
  select * into v_charge from rent_charges where owner_id = p_owner_id and id = p_charge_id for update;
  if not found or v_charge.status in ('paid','void') then raise exception 'Rent charge is not payable.'; end if;
  if p_amount_cents > v_charge.amount_cents - v_charge.paid_amount_cents then raise exception 'Payment exceeds the remaining rent balance.'; end if;
  v_payment_id := 'rental_payment_' || gen_random_uuid()::text;
  v_new_paid := v_charge.paid_amount_cents + p_amount_cents;
  v_status := case when v_new_paid = v_charge.amount_cents then 'paid' else 'partially_paid' end;
  insert into rental_payments (owner_id,id,charge_id,lease_id,tenant_id,provider,amount_cents,refunded_amount_cents,
    currency_code,status,idempotency_key,payment_method,received_at,recorded_by,receipt_reference,notes,created_at,updated_at,succeeded_at)
  select p_owner_id,v_payment_id,v_charge.id,v_charge.lease_id,lt.tenant_id,'offline',p_amount_cents,0,
    v_charge.currency_code,'succeeded','offline:' || v_payment_id,p_payment_method,p_received_at,auth.uid()::text,
    nullif(trim(p_receipt_reference),''),nullif(trim(p_notes),''),now(),now(),p_received_at
  from rental_lease_tenants lt where lt.owner_id = p_owner_id and lt.lease_id = v_charge.lease_id
  order by lt.tenant_id limit 1;
  if not found then raise exception 'Lease tenant was not found.'; end if;
  update rent_charges set paid_amount_cents = v_new_paid, status = v_status, updated_at = now()
    where owner_id = p_owner_id and id = v_charge.id;
  return jsonb_build_object('id',v_payment_id,'chargeId',v_charge.id,'amountCents',p_amount_cents,
    'paymentMethod',p_payment_method,'status','succeeded','receivedAt',p_received_at);
end;
$$;
revoke all on function record_offline_rental_payment(text,text,text,bigint,timestamptz,text,text) from public;
grant execute on function record_offline_rental_payment(text,text,text,bigint,timestamptz,text,text) to authenticated;
