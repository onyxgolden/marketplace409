create table if not exists private_financing_online_payment_settings (
  owner_id text not null, account_id text not null, enabled boolean not null default false,
  reimburse_stripe_fee_as_principal_credit boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(owner_id,account_id), foreign key(owner_id,account_id) references private_financing_accounts(owner_id,id) on delete restrict
);
create table if not exists private_financing_billing_customers (
  owner_id text not null, borrower_id text not null, provider text not null, provider_mode text not null check(provider_mode in('test','live')),
  connected_account_id text not null, customer_id text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(owner_id,borrower_id,provider,provider_mode), unique(provider,provider_mode,connected_account_id,customer_id),
  foreign key(owner_id,borrower_id) references private_financing_borrowers(owner_id,id) on delete restrict
);
create table if not exists private_financing_online_payments (
  owner_id text not null,id text not null,account_id text not null,borrower_id text not null,provider text not null,provider_mode text not null check(provider_mode in('test','live')),
  provider_customer_id text,provider_payment_id text,amount_cents bigint not null check(amount_cents>0),currency_code text not null default 'USD',
  status text not null check(status in('created','requires_payment_method','requires_action','processing','succeeded','failed','cancelled','partially_refunded','refunded','disputed')),
  idempotency_key text not null,ledger_event_id text,stripe_fee_cents bigint check(stripe_fee_cents is null or stripe_fee_cents>=0),fee_credit_event_id text,
  failure_code text,failure_message text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),succeeded_at timestamptz,
  primary key(owner_id,id),unique(owner_id,idempotency_key),unique(provider,provider_mode,provider_payment_id),
  foreign key(owner_id,account_id) references private_financing_accounts(owner_id,id) on delete restrict,
  foreign key(owner_id,borrower_id) references private_financing_borrowers(owner_id,id) on delete restrict,
  foreign key(owner_id,ledger_event_id) references private_financing_events(owner_id,id) on delete restrict,
  foreign key(owner_id,fee_credit_event_id) references private_financing_events(owner_id,id) on delete restrict
);
create unique index if not exists private_financing_one_pending_online_payment on private_financing_online_payments(owner_id,account_id,borrower_id) where status in('created','requires_payment_method','requires_action','processing');
alter table private_financing_online_payment_settings enable row level security;alter table private_financing_online_payment_settings force row level security;
alter table private_financing_billing_customers enable row level security;alter table private_financing_billing_customers force row level security;
alter table private_financing_online_payments enable row level security;alter table private_financing_online_payments force row level security;
create policy "pf_online_settings_owner" on private_financing_online_payment_settings for all to authenticated using(has_workspace_access(owner_id)) with check(has_workspace_access(owner_id));
create policy "pf_online_settings_borrower_read" on private_financing_online_payment_settings for select to authenticated using(has_private_financing_borrower_account_access(owner_id,account_id));
create policy "pf_online_payments_owner_read" on private_financing_online_payments for select to authenticated using(has_workspace_access(owner_id));
create policy "pf_online_payments_borrower_read" on private_financing_online_payments for select to authenticated using(is_private_financing_borrower_identity(owner_id,borrower_id));
revoke all on private_financing_billing_customers,private_financing_online_payments from anon,authenticated;
grant select on private_financing_online_payments to authenticated;
grant select,insert,update on private_financing_online_payment_settings to authenticated;

create or replace function complete_private_financing_stripe_payment(
 p_payment_id text,p_provider_mode text,p_expected_ledger_sequence bigint,p_effective_date date,
 p_interest_paid_by_component_cents jsonb,p_principal_paid_by_component_cents jsonb,p_unallocated_cents bigint,
 p_principal_remaining_by_component_cents jsonb,p_selected_extra_component_id text default null
) returns jsonb language plpgsql security definer set search_path=public set row_security=off as $$
declare v_payment private_financing_online_payments;v_seq bigint;v_event_id text;
begin
 if auth.role()<>'service_role' then raise exception 'Service role required.' using errcode='42501';end if;
 select * into v_payment from private_financing_online_payments where id=p_payment_id and provider='stripe' and provider_mode=p_provider_mode for update;
 if v_payment.id is null then raise exception 'Online payment not found.';end if;
 if v_payment.status='succeeded' then return jsonb_build_object('duplicate',true,'eventId',v_payment.ledger_event_id);end if;
 select next_ledger_sequence into v_seq from private_financing_accounts where owner_id=v_payment.owner_id and id=v_payment.account_id for update;
 if v_seq<>p_expected_ledger_sequence then raise exception 'Ledger moved; retry webhook.' using errcode='40001';end if;
 v_event_id:='pf_evt_'||gen_random_uuid()::text;
 insert into private_financing_events(owner_id,id,account_id,event_type,event_origin,created_by,source_reference,idempotency_key,ledger_sequence,effective_date,borrower_visible_explanation,amount_cents,interest_paid_by_component_cents,principal_paid_by_component_cents,unallocated_cents,principal_remaining_by_component_cents,selected_extra_component_id)
 values(v_payment.owner_id,v_event_id,v_payment.account_id,'payment_posted','stripe_webhook',null,'stripe:'||p_provider_mode||':'||v_payment.provider_payment_id,'stripe_payment:'||p_provider_mode||':'||v_payment.provider_payment_id,v_seq,p_effective_date,'Online payment confirmed by Stripe.',v_payment.amount_cents,p_interest_paid_by_component_cents,p_principal_paid_by_component_cents,p_unallocated_cents,p_principal_remaining_by_component_cents,p_selected_extra_component_id);
 update private_financing_accounts set next_ledger_sequence=v_seq+1,updated_at=now() where owner_id=v_payment.owner_id and id=v_payment.account_id;
 update private_financing_online_payments set status='succeeded',ledger_event_id=v_event_id,succeeded_at=now(),updated_at=now() where owner_id=v_payment.owner_id and id=v_payment.id;
 return jsonb_build_object('duplicate',false,'eventId',v_event_id,'ownerId',v_payment.owner_id,'accountId',v_payment.account_id);
end$$;
revoke all on function complete_private_financing_stripe_payment(text,text,bigint,date,jsonb,jsonb,bigint,jsonb,text) from public,anon,authenticated;
grant execute on function complete_private_financing_stripe_payment(text,text,bigint,date,jsonb,jsonb,bigint,jsonb,text) to service_role;

create or replace function update_private_financing_stripe_payment_status(p_payment_id text,p_provider_mode text,p_status text,p_failure_code text default null,p_failure_message text default null)
returns void language plpgsql security definer set search_path=public set row_security=off as $$begin if auth.role()<>'service_role' then raise exception 'Service role required.';end if;update private_financing_online_payments set status=p_status,failure_code=p_failure_code,failure_message=p_failure_message,updated_at=now() where id=p_payment_id and provider_mode=p_provider_mode;end$$;
revoke all on function update_private_financing_stripe_payment_status(text,text,text,text,text) from public,anon,authenticated;grant execute on function update_private_financing_stripe_payment_status(text,text,text,text,text) to service_role;

create or replace function credit_private_financing_stripe_fee(p_payment_id text,p_provider_mode text,p_fee_cents bigint,p_expected_ledger_sequence bigint,p_effective_date date,p_component_id text,p_corrected_principal_cents bigint)
returns jsonb language plpgsql security definer set search_path=public set row_security=off as $$declare v_payment private_financing_online_payments;v_setting private_financing_online_payment_settings;v_seq bigint;v_event_id text;begin
 if auth.role()<>'service_role' then raise exception 'Service role required.';end if;if p_fee_cents<=0 then raise exception 'Positive fee required.';end if;
 select * into v_payment from private_financing_online_payments where id=p_payment_id and provider_mode=p_provider_mode for update;if v_payment.status<>'succeeded' then raise exception 'Payment is not succeeded.';end if;if v_payment.fee_credit_event_id is not null then return jsonb_build_object('duplicate',true,'eventId',v_payment.fee_credit_event_id);end if;
 select * into v_setting from private_financing_online_payment_settings where owner_id=v_payment.owner_id and account_id=v_payment.account_id;if not coalesce(v_setting.reimburse_stripe_fee_as_principal_credit,false) then return jsonb_build_object('ignored',true);end if;
 select next_ledger_sequence into v_seq from private_financing_accounts where owner_id=v_payment.owner_id and id=v_payment.account_id for update;if v_seq<>p_expected_ledger_sequence then raise exception 'Ledger moved; retry fee credit.' using errcode='40001';end if;
 v_event_id:='pf_evt_'||gen_random_uuid()::text;insert into private_financing_events(owner_id,id,account_id,event_type,event_origin,created_by,source_reference,idempotency_key,ledger_sequence,effective_date,reason,borrower_visible_explanation,component_id,correction_basis,delta_cents,corrected_component_principal_remaining_cents_after)
 values(v_payment.owner_id,v_event_id,v_payment.account_id,'principal_correction','stripe_webhook',null,'stripe_fee:'||p_provider_mode||':'||v_payment.provider_payment_id,'stripe_fee_credit:'||p_provider_mode||':'||v_payment.provider_payment_id,v_seq,p_effective_date,'Automatic reimbursement of actual Stripe processing fee','The seller credited the actual Stripe processing fee to your principal.',p_component_id,'discretionary_concession',-p_fee_cents,p_corrected_principal_cents);
 update private_financing_accounts set next_ledger_sequence=v_seq+1,updated_at=now() where owner_id=v_payment.owner_id and id=v_payment.account_id;update private_financing_online_payments set stripe_fee_cents=p_fee_cents,fee_credit_event_id=v_event_id,updated_at=now() where owner_id=v_payment.owner_id and id=v_payment.id;return jsonb_build_object('duplicate',false,'eventId',v_event_id);end$$;
revoke all on function credit_private_financing_stripe_fee(text,text,bigint,bigint,date,text,bigint) from public,anon,authenticated;grant execute on function credit_private_financing_stripe_fee(text,text,bigint,bigint,date,text,bigint) to service_role;

create or replace function reverse_private_financing_stripe_payment(p_payment_id text,p_provider_mode text,p_provider_refund_id text,p_expected_ledger_sequence bigint,p_effective_date date,p_interest_paid_by_component_cents jsonb,p_principal_paid_by_component_cents jsonb,p_unallocated_cents bigint,p_principal_remaining_by_component_cents jsonb)
returns jsonb language plpgsql security definer set search_path=public set row_security=off as $$declare v_payment private_financing_online_payments;v_seq bigint;v_event_id text;begin if auth.role()<>'service_role' then raise exception 'Service role required.';end if;select * into v_payment from private_financing_online_payments where id=p_payment_id and provider_mode=p_provider_mode for update;if v_payment.status='refunded' then return jsonb_build_object('duplicate',true);end if;if v_payment.status<>'succeeded' then raise exception 'Only a succeeded payment can be refunded.';end if;select next_ledger_sequence into v_seq from private_financing_accounts where owner_id=v_payment.owner_id and id=v_payment.account_id for update;if v_seq<>p_expected_ledger_sequence then raise exception 'Ledger moved; retry refund.' using errcode='40001';end if;v_event_id:='pf_evt_'||gen_random_uuid()::text;insert into private_financing_events(owner_id,id,account_id,event_type,event_origin,created_by,source_reference,idempotency_key,ledger_sequence,effective_date,reverses_event_id,reason,borrower_visible_explanation,amount_cents,interest_paid_by_component_cents,principal_paid_by_component_cents,unallocated_cents,principal_remaining_by_component_cents)values(v_payment.owner_id,v_event_id,v_payment.account_id,'payment_reversal','stripe_webhook',null,'stripe_refund:'||p_provider_mode||':'||p_provider_refund_id,'stripe_refund:'||p_provider_mode||':'||p_provider_refund_id,v_seq,p_effective_date,v_payment.ledger_event_id,'Stripe payment refunded','Stripe confirmed that this payment was refunded.',v_payment.amount_cents,p_interest_paid_by_component_cents,p_principal_paid_by_component_cents,p_unallocated_cents,p_principal_remaining_by_component_cents);update private_financing_accounts set next_ledger_sequence=v_seq+1,updated_at=now() where owner_id=v_payment.owner_id and id=v_payment.account_id;update private_financing_online_payments set status='refunded',updated_at=now() where owner_id=v_payment.owner_id and id=v_payment.id;return jsonb_build_object('duplicate',false,'eventId',v_event_id);end$$;
revoke all on function reverse_private_financing_stripe_payment(text,text,text,bigint,date,jsonb,jsonb,bigint,jsonb) from public,anon,authenticated;grant execute on function reverse_private_financing_stripe_payment(text,text,text,bigint,date,jsonb,jsonb,bigint,jsonb) to service_role;
