create table if not exists rental_security_deposits (
  owner_id text not null,id text not null,lease_id text not null,tenant_id text not null,
  required_amount_cents bigint not null check(required_amount_cents>=0),currency_code text not null default 'USD',
  status text not null check(status in ('required','partially_held','held','disposition_pending','closed')),
  jurisdiction_code text,received_deadline date,disposition_deadline date,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  primary key(owner_id,id),unique(owner_id,lease_id,tenant_id),foreign key(owner_id,lease_id) references rental_leases(owner_id,id) on delete restrict,
  foreign key(owner_id,tenant_id) references rental_tenants(owner_id,id) on delete restrict
);
create table if not exists rental_security_deposit_transactions (
  owner_id text not null,id text not null,deposit_id text not null,transaction_type text not null check(transaction_type in ('received','deduction','refunded','adjustment_increase','adjustment_decrease')),
  amount_cents bigint not null check(amount_cents>0),occurred_at timestamptz not null,description text not null check(btrim(description)<>''),
  evidence_document_id text,recorded_by text not null,created_at timestamptz not null default now(),primary key(owner_id,id),
  foreign key(owner_id,deposit_id) references rental_security_deposits(owner_id,id) on delete restrict,
  foreign key(owner_id,evidence_document_id) references rental_documents(owner_id,id) on delete restrict
);
create index if not exists idx_rental_deposit_owner_lease on rental_security_deposits(owner_id,lease_id);
create index if not exists idx_rental_deposit_tx_owner_deposit on rental_security_deposit_transactions(owner_id,deposit_id,occurred_at);
alter table rental_security_deposits enable row level security;alter table rental_security_deposits force row level security;
alter table rental_security_deposit_transactions enable row level security;alter table rental_security_deposit_transactions force row level security;
create policy "rental_deposit_owner_all" on rental_security_deposits for all to authenticated using(owner_id=auth.uid()::text) with check(owner_id=auth.uid()::text);
create policy "rental_deposit_tenant_select" on rental_security_deposits for select to authenticated using(rental_actor_has_lease_access(owner_id,lease_id));
create policy "rental_deposit_tx_owner_select" on rental_security_deposit_transactions for select to authenticated using(owner_id=auth.uid()::text);
create policy "rental_deposit_tx_tenant_select" on rental_security_deposit_transactions for select to authenticated using(exists(select 1 from rental_security_deposits deposit where deposit.owner_id=rental_security_deposit_transactions.owner_id and deposit.id=rental_security_deposit_transactions.deposit_id and rental_actor_has_lease_access(deposit.owner_id,deposit.lease_id)));

create or replace function record_rental_security_deposit_transaction(p_owner_id text,p_deposit_id text,p_transaction_type text,p_amount_cents bigint,p_occurred_at timestamptz,p_description text,p_evidence_document_id text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_deposit rental_security_deposits%rowtype;v_balance bigint;v_id text:='rental_deposit_tx_'||gen_random_uuid()::text;v_status text;
begin
if p_owner_id<>auth.uid()::text then raise exception 'Authenticated owner does not match deposit owner.';end if;
if p_transaction_type not in ('received','deduction','refunded','adjustment_increase','adjustment_decrease') then raise exception 'Unsupported deposit transaction type.';end if;
if p_amount_cents<=0 or btrim(coalesce(p_description,''))='' then raise exception 'Positive amount and description are required.';end if;
select * into v_deposit from rental_security_deposits where owner_id=p_owner_id and id=p_deposit_id for update;if not found then raise exception 'Security deposit was not found.';end if;
select coalesce(sum(case when transaction_type in ('received','adjustment_increase') then amount_cents else -amount_cents end),0) into v_balance from rental_security_deposit_transactions where owner_id=p_owner_id and deposit_id=p_deposit_id;
if p_transaction_type in ('deduction','refunded','adjustment_decrease') and p_amount_cents>v_balance then raise exception 'Deposit transaction exceeds the held balance.';end if;
insert into rental_security_deposit_transactions(owner_id,id,deposit_id,transaction_type,amount_cents,occurred_at,description,evidence_document_id,recorded_by)
values(p_owner_id,v_id,p_deposit_id,p_transaction_type,p_amount_cents,p_occurred_at,btrim(p_description),p_evidence_document_id,auth.uid()::text);
v_balance:=v_balance+case when p_transaction_type in ('received','adjustment_increase') then p_amount_cents else -p_amount_cents end;
v_status:=case when v_balance=0 and p_transaction_type in ('refunded','deduction','adjustment_decrease') then 'closed' when v_balance>=v_deposit.required_amount_cents then 'held' when v_balance>0 then 'partially_held' else 'required' end;
update rental_security_deposits set status=v_status,updated_at=now() where owner_id=p_owner_id and id=p_deposit_id;
return jsonb_build_object('id',v_id,'deposit_id',p_deposit_id,'balance_cents',v_balance,'status',v_status);
end;$$;
revoke all on function record_rental_security_deposit_transaction(text,text,text,bigint,timestamptz,text,text) from public,anon;
grant execute on function record_rental_security_deposit_transaction(text,text,text,bigint,timestamptz,text,text) to authenticated;
