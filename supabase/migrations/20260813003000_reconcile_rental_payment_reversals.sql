create or replace function reconcile_rental_payment_reversal() returns trigger language plpgsql security definer set search_path=public set row_security=off as $$
declare v_paid bigint;v_charge rent_charges;v_property_id text;v_adjustment bigint;
begin
 if new.status is not distinct from old.status and new.refunded_amount_cents is not distinct from old.refunded_amount_cents then return new;end if;
 if new.status not in('partially_refunded','refunded','disputed') then return new;end if;
 select * into v_charge from rent_charges where owner_id=new.owner_id and id=new.charge_id for update;
 select coalesce(sum(case when status='succeeded' then amount_cents when status='partially_refunded' then amount_cents-refunded_amount_cents else 0 end),0) into v_paid from rental_payments where owner_id=new.owner_id and charge_id=new.charge_id;
 v_paid:=least(v_charge.amount_cents,v_paid);update rent_charges set paid_amount_cents=v_paid,status=case when v_paid=0 then case when due_date<current_date then 'overdue' else 'due' end when v_paid<amount_cents then 'partially_paid' else 'paid' end,updated_at=now() where owner_id=new.owner_id and id=new.charge_id;
 v_adjustment:=case when new.status='partially_refunded' then new.refunded_amount_cents else new.amount_cents end;
 select property_id into v_property_id from rental_leases where owner_id=new.owner_id and id=new.lease_id;
 insert into financial_events(owner_id,property_id,event_date,description,amount,transaction_kind,normalized_category,tax_deductible,affects_noi,capitalized,source_system,source_record_id,metadata,created_by,updated_by)
 values(new.owner_id,v_property_id,current_date,case when new.status='disputed' then 'Rent payment disputed' else 'Rent payment refunded' end,-v_adjustment/100.0,'expense','rental_income_reversal',false,true,false,'forge_rental_payment_adjustment',new.id,jsonb_build_object('payment_id',new.id,'status',new.status,'refunded_amount_cents',new.refunded_amount_cents),new.owner_id,new.owner_id)
 on conflict(owner_id,source_system,source_record_id) do update set amount=excluded.amount,description=excluded.description,metadata=excluded.metadata,updated_at=now();return new;
end$$;
drop trigger if exists reconcile_rental_payment_reversal_trigger on rental_payments;
create trigger reconcile_rental_payment_reversal_trigger after update of status,refunded_amount_cents on rental_payments for each row execute function reconcile_rental_payment_reversal();
revoke all on function reconcile_rental_payment_reversal() from public,anon,authenticated;

create or replace function process_stripe_rental_refund_event(p_provider_event_id text,p_connected_account_id text,p_payment_id text,p_refunded_amount_cents bigint,p_occurred_at timestamptz)
returns jsonb language plpgsql security invoker set search_path=public as $$declare v_owner_id text;v_event payment_webhook_events;v_payment rental_payments;begin
 select owner_id into v_owner_id from landlord_payment_accounts where provider='stripe' and provider_account_id=p_connected_account_id;if v_owner_id is null then raise exception 'Unknown Stripe connected account.';end if;
 select * into v_event from payment_webhook_events where provider='stripe' and provider_event_id=p_provider_event_id for update;if v_event.status in('processed','ignored') then return jsonb_build_object('status',v_event.status,'duplicate',true);end if;
 if p_payment_id is null or p_refunded_amount_cents is null then raise exception 'Mapped Stripe refund evidence is required.';end if;select * into v_payment from rental_payments where owner_id=v_owner_id and id=p_payment_id for update;if v_payment.id is null then raise exception 'Stripe refund payment mapping was not found.';end if;
 if p_refunded_amount_cents<0 or p_refunded_amount_cents>v_payment.amount_cents then raise exception 'Stripe refund amount is invalid.';end if;
 update rental_payments set refunded_amount_cents=p_refunded_amount_cents,status=case when p_refunded_amount_cents=amount_cents then 'refunded' else 'partially_refunded' end,updated_at=p_occurred_at where owner_id=v_owner_id and id=v_payment.id;
 update payment_webhook_events set status='processed',processed_at=now(),failure_message=null where id=v_event.id;return jsonb_build_object('status','processed','payment_id',v_payment.id,'owner_id',v_owner_id);end$$;
revoke all on function process_stripe_rental_refund_event(text,text,text,bigint,timestamptz) from public,anon,authenticated;
grant execute on function process_stripe_rental_refund_event(text,text,text,bigint,timestamptz) to service_role;
