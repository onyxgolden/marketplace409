-- Controls-sweep G6 (M-05 + M-06): deposit corrections with an audit trail.
-- A voided transaction stays in the history (voided_at + void_reason) and is
-- excluded from every balance computation, including the record RPC's own
-- sum — otherwise recording the next transaction after a void would count
-- the voided row again. Requirements gain a 'void' status for cancelled
-- obligations; voided requirements keep their transaction history.
alter table rental_security_deposit_transactions
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text;

alter table rental_security_deposits drop constraint if exists rental_security_deposits_status_check;
alter table rental_security_deposits
  add constraint rental_security_deposits_status_check
  check (status in ('required', 'partially_held', 'held', 'disposition_pending', 'closed', 'void'));

create or replace function public.record_rental_security_deposit_transaction(p_owner_id text, p_deposit_id text, p_transaction_type text, p_amount_cents bigint, p_occurred_at timestamp with time zone, p_description text, p_evidence_document_id text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare v_deposit rental_security_deposits%rowtype;v_balance bigint;v_id text:='rental_deposit_tx_'||gen_random_uuid()::text;v_status text;
begin
if not has_workspace_access(p_owner_id) then raise exception 'Authenticated owner does not match deposit owner.'; end if;
if p_transaction_type not in ('received','deduction','refunded','adjustment_increase','adjustment_decrease') then raise exception 'Unsupported deposit transaction type.'; end if;
if p_amount_cents<=0 or btrim(coalesce(p_description,''))='' then raise exception 'Positive amount and description are required.'; end if;
select * into v_deposit from rental_security_deposits where owner_id=p_owner_id and id=p_deposit_id for update;if not found then raise exception 'Security deposit was not found.'; end if;
select coalesce(sum(case when transaction_type in ('received','adjustment_increase') then amount_cents else -amount_cents end),0) into v_balance from rental_security_deposit_transactions where owner_id=p_owner_id and deposit_id=p_deposit_id and voided_at is null;
if p_transaction_type in ('deduction','refunded','adjustment_decrease') and p_amount_cents>v_balance then raise exception 'Deposit transaction exceeds the held balance.'; end if;
insert into rental_security_deposit_transactions(owner_id,id,deposit_id,transaction_type,amount_cents,occurred_at,description,evidence_document_id,recorded_by)
values(p_owner_id,v_id,p_deposit_id,p_transaction_type,p_amount_cents,p_occurred_at,btrim(p_description),p_evidence_document_id,auth.uid()::text);
v_balance:=v_balance+case when p_transaction_type in ('received','adjustment_increase') then p_amount_cents else -p_amount_cents end;
v_status:=case when v_balance=0 and p_transaction_type in ('refunded','deduction','adjustment_decrease') then 'closed' when v_balance>=v_deposit.required_amount_cents then 'held' when v_balance>0 then 'partially_held' else 'required' end;
update rental_security_deposits set status=v_status,updated_at=now() where owner_id=p_owner_id and id=p_deposit_id;
return jsonb_build_object('id',v_id,'deposit_id',p_deposit_id,'balance_cents',v_balance,'status',v_status);
end;$function$;
