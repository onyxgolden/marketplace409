-- Shared FORGE workspace membership -- Checkpoint 3 (RPC half), group covering insurance/animals/deposits/late-fees.
-- Converts the owner-equality guard in each function from `p_owner_id <> auth.uid()::text` (or the
-- `authenticated_owner_id` local-variable equivalent) to `not has_workspace_access(p_owner_id)`, so
-- an active co-owner can call these exactly as the primary owner can. create or replace function
-- does not reset previously granted privileges, so the original migrations' revoke/grant statements
-- (where present) remain in effect -- nothing to repeat here.
--
-- Every function body below is otherwise byte-for-byte identical to its current live definition
-- (captured via pg_get_functiondef against the linked Production database) except for the single
-- guard substitution -- generated, not hand-transcribed, specifically to avoid introducing a subtle
-- error into business logic this large. Where a function also uses its authenticated actor id for
-- audit-trail purposes (e.g. `recorded_by`, `approved_by`, `forge_cutover_activated_by`), that usage
-- is deliberately left untouched -- it should keep recording the real acting user, not the resolved
-- workspace owner (requirement: record the acting user separately from the canonical owner).

create or replace function public.generate_monthly_pet_fee_charge(p_owner_id text, p_pet_fee_id text, p_period text, p_due_day integer DEFAULT 1)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare v_fee monthly_pet_fees%rowtype; v_animal rental_animals%rowtype; v_id text; v_due date; v_row monthly_pet_fee_charges%rowtype;
begin
  if not has_workspace_access(p_owner_id) then raise exception 'Authenticated owner id is required.'; end if;
  select * into v_fee from monthly_pet_fees where owner_id=p_owner_id and id=p_pet_fee_id for update;
  if not found or v_fee.status<>'active' then raise exception 'Active monthly pet fee is required.'; end if;
  select * into v_animal from rental_animals where owner_id=p_owner_id and id=v_fee.animal_id;
  if v_animal.approval_status<>'approved' then raise exception 'Landlord pet approval is required.'; end if;
  v_due:=to_date(p_period||'-'||least(greatest(p_due_day,1),28)::text,'YYYY-MM-DD'); v_id:='pet_fee_charge_'||gen_random_uuid()::text;
  insert into monthly_pet_fee_charges(owner_id,id,pet_fee_id,animal_id,lease_id,period,due_date,amount_cents,currency_code,status,source_key)
  values(p_owner_id,v_id,v_fee.id,v_fee.animal_id,v_fee.lease_id,p_period,v_due,v_fee.amount_cents,v_fee.currency_code,'scheduled','pet:'||v_fee.id||':'||p_period)
  on conflict(owner_id,source_key) do nothing;
  select * into v_row from monthly_pet_fee_charges where owner_id=p_owner_id and source_key='pet:'||v_fee.id||':'||p_period;
  return to_jsonb(v_row);
end; $function$;


create or replace function public.review_rental_animal(p_owner_id text, p_animal_id text, p_decision text, p_classification text, p_approval_evidence_id text, p_monthly_fee_cents bigint DEFAULT NULL::bigint, p_effective_start_date date DEFAULT NULL::date)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$declare a rental_animals;fee monthly_pet_fees;begin if not has_workspace_access(p_owner_id) or p_decision not in('approved','denied')then raise exception 'Owner animal review is invalid.';end if;select * into a from rental_animals where owner_id=p_owner_id and id=p_animal_id for update;if a.id is null then raise exception 'Animal request was not found.';end if;
if a.classification='assistance_review_requested' then if p_classification not in('assistance_animal_approved','assistance_request_denied')then raise exception 'Assistance request requires a human classification decision.';end if;if p_monthly_fee_cents is not null then raise exception 'Pet fees cannot be assigned through an assistance-animal review.';end if;update rental_animals set classification=p_classification,approval_status=p_decision,approved_at=case when p_decision='approved'then now()else null end,approved_by=case when p_decision='approved'then p_owner_id else null end,approval_evidence_id=case when p_decision='approved'then p_approval_evidence_id else null end,human_review_required=false,updated_at=now()where owner_id=p_owner_id and id=a.id;
else if p_classification<>'pet'then raise exception 'Pet review cannot change to an assistance classification.';end if;update rental_animals set approval_status=p_decision,approved_at=case when p_decision='approved'then now()else null end,approved_by=case when p_decision='approved'then p_owner_id else null end,approval_evidence_id=case when p_decision='approved'then p_approval_evidence_id else null end,updated_at=now()where owner_id=p_owner_id and id=a.id;if p_decision='approved'and p_monthly_fee_cents is not null then if p_monthly_fee_cents<=0 or p_effective_start_date is null then raise exception 'A positive pet fee and start date are required.';end if;insert into monthly_pet_fees(owner_id,id,animal_id,lease_id,amount_cents,status,effective_start_date,approval_evidence_id,approved_at)values(p_owner_id,'monthly_pet_fee_'||gen_random_uuid()::text,a.id,a.lease_id,p_monthly_fee_cents,'active',p_effective_start_date,p_approval_evidence_id,now())on conflict(owner_id,animal_id)do update set amount_cents=excluded.amount_cents,status='active',effective_start_date=excluded.effective_start_date,approval_evidence_id=excluded.approval_evidence_id,approved_at=excluded.approved_at,updated_at=now()returning * into fee;end if;end if;return jsonb_build_object('animal_id',a.id,'decision',p_decision,'classification',p_classification,'pet_fee_id',fee.id);end$function$;


create or replace function public.review_renters_insurance_policy(p_owner_id text, p_policy_id text, p_decision text, p_note text)
 returns renters_insurance_policies
 language plpgsql
 set search_path to 'public'
as $function$declare result renters_insurance_policies;begin if not has_workspace_access(p_owner_id) or p_decision not in('verified','rejected')then raise exception 'Owner review is invalid.';end if;update renters_insurance_policies set status=p_decision,verification_provider='owner_review',verified_at=case when p_decision='verified'then now()else null end,last_checked_at=now(),updated_at=now()where owner_id=p_owner_id and id=p_policy_id and status='pending_verification'returning * into result;if result.id is null then raise exception 'Pending policy was not found.';end if;return result;end$function$;


create or replace function public.queue_renters_insurance_renewal_reminders(p_owner_id text, p_as_of date DEFAULT CURRENT_DATE)
 returns integer
 language plpgsql
 set search_path to 'public'
as $function$declare count_rows integer;begin if not has_workspace_access(p_owner_id) then raise exception 'Owner identity mismatch.';end if;insert into rental_notification_outbox(owner_id,id,tenant_id,lease_id,event_key,notification_type,recipient,subject,body_text,status,scheduled_for,max_attempts)select p.owner_id,'rental_notification_'||gen_random_uuid()::text,p.tenant_id,p.lease_id,'insurance:'||p.id||':'||(p.expiration_date-p_as_of)::text,'document_published',t.email,'Renters insurance renewal reminder','Your renters insurance policy expires on '||p.expiration_date||'. Submit renewed proof in your FORGE tenant portal.','queued',now(),3 from renters_insurance_policies p join rental_tenants t on t.owner_id=p.owner_id and t.id=p.tenant_id where p.owner_id=p_owner_id and p.status='verified'and p.expiration_date-p_as_of in(30,7)on conflict(event_key)do nothing;get diagnostics count_rows=row_count;return count_rows;end$function$;


create or replace function public.record_rental_security_deposit_transaction(p_owner_id text, p_deposit_id text, p_transaction_type text, p_amount_cents bigint, p_occurred_at timestamp with time zone, p_description text, p_evidence_document_id text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare v_deposit rental_security_deposits%rowtype;v_balance bigint;v_id text:='rental_deposit_tx_'||gen_random_uuid()::text;v_status text;
begin
if not has_workspace_access(p_owner_id) then raise exception 'Authenticated owner does not match deposit owner.';end if;
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
end;$function$;


create or replace function public.assess_rental_late_fee(p_owner_id text, p_rule_id text, p_charge_id text, p_reason text)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare r rental_late_fee_rules%rowtype;c rent_charges%rowtype;fee bigint;fee_id text:='rent_charge_late_'||gen_random_uuid()::text;a_id text:='rental_late_assessment_'||gen_random_uuid()::text;
begin if not has_workspace_access(p_owner_id) then raise exception 'Authenticated owner does not match lease owner.';end if;select * into r from rental_late_fee_rules where owner_id=p_owner_id and id=p_rule_id and status='active' for update;if not found or not r.requires_manual_approval then raise exception 'An active manually approved late-fee rule is required.';end if;select * into c from rent_charges where owner_id=p_owner_id and id=p_charge_id and lease_id=r.lease_id for update;if not found or c.status in('paid','void') or c.due_date+r.grace_days>=current_date then raise exception 'Charge is not eligible for a late fee.';end if;fee:=case when r.calculation_type='fixed' then r.fixed_amount_cents else ceil((c.amount_cents-c.paid_amount_cents)*r.percentage_basis_points/10000.0)::bigint end;fee:=least(fee,coalesce(r.maximum_amount_cents,fee));insert into rent_charges(owner_id,id,lease_id,schedule_id,period,due_date,amount_cents,paid_amount_cents,currency_code,status,source_key,notes,charge_type,related_charge_id)values(p_owner_id,fee_id,c.lease_id,c.schedule_id,to_char(current_date,'YYYY-MM'),current_date,fee,0,c.currency_code,'due','latefee:'||r.id||':'||c.id,p_reason,'late_fee',c.id);insert into rental_late_fee_assessments(owner_id,id,rule_id,lease_id,source_charge_id,fee_charge_id,approved_by,approved_at,reason)values(p_owner_id,a_id,r.id,c.lease_id,c.id,fee_id,auth.uid()::text,now(),btrim(p_reason));return jsonb_build_object('assessmentId',a_id,'feeChargeId',fee_id,'amountCents',fee);end;$function$;


create or replace function public.save_rental_inspection(p_owner_id text, p_inspection jsonb, p_items jsonb)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare v_id text:=coalesce(nullif(p_inspection->>'id',''),'rental_inspection_'||gen_random_uuid()::text);v_item jsonb;
begin
if not has_workspace_access(p_owner_id) then raise exception 'Authenticated owner does not match inspection owner.';end if;
if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one inspection item is required.';end if;
insert into rental_inspections(owner_id,id,lease_id,unit_id,tenant_id,inspection_type,inspection_date,status,general_notes)
values(p_owner_id,v_id,p_inspection->>'leaseId',p_inspection->>'unitId',p_inspection->>'tenantId',p_inspection->>'inspectionType',(p_inspection->>'inspectionDate')::date,'draft',nullif(btrim(p_inspection->>'generalNotes'),''));
for v_item in select * from jsonb_array_elements(p_items) loop
insert into rental_inspection_items(owner_id,id,inspection_id,area,component,condition_rating,notes,damage_observed,deposit_review_recommended,estimated_cost_cents,evidence_document_id)
values(p_owner_id,'rental_inspection_item_'||gen_random_uuid()::text,v_id,btrim(v_item->>'area'),btrim(v_item->>'component'),v_item->>'conditionRating',nullif(btrim(v_item->>'notes'),''),coalesce((v_item->>'damageObserved')::boolean,false),coalesce((v_item->>'depositReviewRecommended')::boolean,false),nullif(v_item->>'estimatedCostCents','')::bigint,nullif(v_item->>'evidenceDocumentId',''));
end loop;return jsonb_build_object('id',v_id,'status','draft');end;$function$;
