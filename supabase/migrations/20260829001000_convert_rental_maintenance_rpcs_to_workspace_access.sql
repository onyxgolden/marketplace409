-- Shared FORGE workspace membership -- Checkpoint 3 (RPC half), group covering maintenance/contractors.
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

create or replace function public.update_rental_maintenance_work_order(p_owner_id text, p_work_order_id text, p_status text, p_scheduled_start timestamp with time zone, p_scheduled_end timestamp with time zone, p_estimated_cost_cents bigint, p_actual_cost_cents bigint, p_invoice_reference text, p_invoice_document_id text, p_completion_document_id text, p_public_note text, p_private_note text)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare w rental_maintenance_work_orders%rowtype;e text;
begin if not has_workspace_access(p_owner_id) then raise exception 'Authenticated owner does not match work-order owner.';end if;if p_status not in('assigned','scheduled','in_progress','completed','cancelled') then raise exception 'Unsupported work-order status.';end if;select * into w from rental_maintenance_work_orders where owner_id=p_owner_id and id=p_work_order_id for update;if not found then raise exception 'Work order was not found.';end if;e:=case p_status when'assigned'then'assigned' when'scheduled'then'scheduled' when'in_progress'then'started' when'completed'then'completed' else'cancelled'end;update rental_maintenance_work_orders set status=p_status,scheduled_start=coalesce(p_scheduled_start,scheduled_start),scheduled_end=coalesce(p_scheduled_end,scheduled_end),estimated_cost_cents=coalesce(p_estimated_cost_cents,estimated_cost_cents),actual_cost_cents=coalesce(p_actual_cost_cents,actual_cost_cents),invoice_reference=coalesce(nullif(btrim(p_invoice_reference),''),invoice_reference),invoice_document_id=coalesce(p_invoice_document_id,invoice_document_id),completion_document_id=coalesce(p_completion_document_id,completion_document_id),completed_at=case when p_status='completed' then now() else completed_at end,updated_at=now() where owner_id=p_owner_id and id=p_work_order_id;insert into rental_maintenance_work_events(owner_id,id,work_order_id,event_type,public_note,private_note,recorded_by)values(p_owner_id,'rental_work_event_'||gen_random_uuid()::text,p_work_order_id,e,nullif(btrim(p_public_note),''),nullif(btrim(p_private_note),''),auth.uid()::text);return jsonb_build_object('workOrderId',p_work_order_id,'status',p_status);end;$function$;


create or replace function public.create_rental_maintenance_work_order(p_owner_id text, p_work_order jsonb)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare w rental_maintenance_work_orders%rowtype;request_id text:=p_work_order->>'requestId';contractor_id text:=nullif(p_work_order->>'contractorId','');
begin if not has_workspace_access(p_owner_id) then raise exception 'Authenticated owner does not match work-order owner.';end if;
if not exists(select 1 from rental_maintenance_requests where owner_id=p_owner_id and id=request_id)then raise exception 'Maintenance request was not found.';end if;
if contractor_id is not null and not exists(select 1 from rental_contractors where owner_id=p_owner_id and id=contractor_id and status='active')then raise exception 'Active contractor was not found.';end if;
insert into rental_maintenance_work_orders(owner_id,id,request_id,contractor_id,status,scope_of_work,scheduled_start,scheduled_end,entry_instructions,estimated_cost_cents)
values(p_owner_id,p_work_order->>'id',request_id,contractor_id,case when contractor_id is null then'draft'else'assigned'end,p_work_order->>'scopeOfWork',nullif(p_work_order->>'scheduledStart','')::timestamptz,nullif(p_work_order->>'scheduledEnd','')::timestamptz,nullif(btrim(p_work_order->>'entryInstructions'),''),nullif(p_work_order->>'estimatedCostCents','')::bigint)returning * into w;
insert into rental_maintenance_work_events(owner_id,id,work_order_id,event_type,public_note,private_note,recorded_by)values(p_owner_id,'rental_work_event_'||gen_random_uuid()::text,w.id,case when contractor_id is null then'created'else'assigned'end,nullif(btrim(p_work_order->>'publicNote'),''),nullif(btrim(p_work_order->>'privateNote'),''),auth.uid()::text);
return to_jsonb(w);end;$function$;


create or replace function public.record_rental_contractor_payment(p_owner_id text, p_contractor_id text, p_work_order_id text, p_property_id text, p_paid_at date, p_amount_cents bigint, p_payment_method text, p_reference text, p_invoice_reference text, p_invoice_document_id text, p_notes text)
 returns rental_contractor_payments
 language plpgsql
 set search_path to 'public'
as $function$declare result rental_contractor_payments;begin if not has_workspace_access(p_owner_id) then raise exception 'Owner identity mismatch.';end if;if p_amount_cents<=0 or not exists(select 1 from rental_contractors where owner_id=p_owner_id and id=p_contractor_id)then raise exception 'Valid contractor payment is required.';end if;insert into rental_contractor_payments(owner_id,id,contractor_id,work_order_id,property_id,paid_at,amount_cents,payment_method,reference,invoice_reference,invoice_document_id,notes)values(p_owner_id,'rental_contractor_payment_'||gen_random_uuid()::text,p_contractor_id,p_work_order_id,p_property_id,p_paid_at,p_amount_cents,btrim(p_payment_method),nullif(btrim(p_reference),''),nullif(btrim(p_invoice_reference),''),p_invoice_document_id,nullif(btrim(p_notes),''))returning * into result;insert into rental_1099_reviews(owner_id,id,contractor_id,tax_year)values(p_owner_id,'rental_1099_review_'||gen_random_uuid()::text,p_contractor_id,extract(year from p_paid_at)::smallint)on conflict(owner_id,contractor_id,tax_year)do nothing;return result;end$function$;
