create or replace function post_succeeded_rental_payment_to_financial_event()
returns trigger language plpgsql security definer set search_path=public set row_security=off as $$
declare v_property_id text; v_event_date date;
begin
  if new.status<>'succeeded' then return new; end if;
  if tg_op='UPDATE' and old.status='succeeded' then return new; end if;
  select property_id into v_property_id from rental_leases where owner_id=new.owner_id and id=new.lease_id;
  v_event_date:=coalesce(new.received_at,new.succeeded_at,new.created_at)::date;
  insert into financial_events(owner_id,property_id,event_date,description,amount,transaction_kind,normalized_category,
    tax_deductible,affects_noi,capitalized,source_system,source_record_id,metadata,created_by,updated_by)
  values(new.owner_id,v_property_id,v_event_date,'Rent payment received',new.amount_cents/100.0,'income','rental_income',
    false,true,false,'forge_rental_payment',new.id,jsonb_build_object('payment_id',new.id,'charge_id',new.charge_id,
      'lease_id',new.lease_id,'tenant_id',new.tenant_id,'provider',new.provider,'currency_code',new.currency_code),new.owner_id,new.owner_id)
  on conflict(owner_id,source_system,source_record_id) do nothing;
  return new;
end;$$;
drop trigger if exists post_rental_payment_insert_financial_event on rental_payments;
create trigger post_rental_payment_insert_financial_event after insert on rental_payments
for each row execute function post_succeeded_rental_payment_to_financial_event();
drop trigger if exists post_rental_payment_update_financial_event on rental_payments;
create trigger post_rental_payment_update_financial_event after update of status on rental_payments
for each row execute function post_succeeded_rental_payment_to_financial_event();
revoke all on function post_succeeded_rental_payment_to_financial_event() from public,anon,authenticated;

insert into financial_events(owner_id,property_id,event_date,description,amount,transaction_kind,normalized_category,
  tax_deductible,affects_noi,capitalized,source_system,source_record_id,metadata,created_by,updated_by)
select payment.owner_id,lease.property_id,coalesce(payment.received_at,payment.succeeded_at,payment.created_at)::date,
  'Rent payment received',payment.amount_cents/100.0,'income','rental_income',false,true,false,'forge_rental_payment',payment.id,
  jsonb_build_object('payment_id',payment.id,'charge_id',payment.charge_id,'lease_id',payment.lease_id,
    'tenant_id',payment.tenant_id,'provider',payment.provider,'currency_code',payment.currency_code),payment.owner_id,payment.owner_id
from rental_payments payment join rental_leases lease on lease.owner_id=payment.owner_id and lease.id=payment.lease_id
where payment.status='succeeded'
on conflict(owner_id,source_system,source_record_id) do nothing;
