create table if not exists rental_inspections (
  owner_id text not null,id text not null,lease_id text not null,unit_id text not null,tenant_id text not null,
  inspection_type text not null check(inspection_type in ('move_in','move_out','periodic')),
  inspection_date date not null,status text not null default 'draft' check(status in ('draft','finalized','acknowledged')),
  general_notes text,finalized_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  primary key(owner_id,id),unique(owner_id,lease_id,inspection_type,inspection_date),
  foreign key(owner_id,lease_id) references rental_leases(owner_id,id) on delete restrict,
  foreign key(owner_id,unit_id) references rental_units(owner_id,id) on delete restrict,
  foreign key(owner_id,tenant_id) references rental_tenants(owner_id,id) on delete restrict);
create table if not exists rental_inspection_items (
  owner_id text not null,id text not null,inspection_id text not null,area text not null,component text not null,
  condition_rating text not null check(condition_rating in ('excellent','good','fair','poor','damaged','not_inspected')),
  notes text,damage_observed boolean not null default false,deposit_review_recommended boolean not null default false,
  estimated_cost_cents bigint check(estimated_cost_cents is null or estimated_cost_cents>=0),evidence_document_id text,
  created_at timestamptz not null default now(),primary key(owner_id,id),
  foreign key(owner_id,inspection_id) references rental_inspections(owner_id,id) on delete cascade,
  foreign key(owner_id,evidence_document_id) references rental_documents(owner_id,id) on delete restrict);
create table if not exists rental_inspection_acknowledgements (
  owner_id text not null,inspection_id text not null,tenant_id text not null,acknowledged_at timestamptz not null default now(),
  acknowledgement_text text not null,primary key(owner_id,inspection_id,tenant_id),
  foreign key(owner_id,inspection_id) references rental_inspections(owner_id,id) on delete restrict,
  foreign key(owner_id,tenant_id) references rental_tenants(owner_id,id) on delete restrict);
create index if not exists idx_rental_inspections_owner_lease on rental_inspections(owner_id,lease_id,inspection_date);
create index if not exists idx_rental_inspection_items_owner_inspection on rental_inspection_items(owner_id,inspection_id);

create or replace function rental_actor_tenant_id(p_owner_id text)
returns text language sql stable security definer set search_path=public set row_security=off as $$
  select tenant.id from rental_tenants tenant
  where tenant.owner_id=p_owner_id and tenant.auth_user_id=auth.uid()
  limit 1
$$;
revoke all on function rental_actor_tenant_id(text) from public,anon;
grant execute on function rental_actor_tenant_id(text) to authenticated;

alter table rental_inspections enable row level security;alter table rental_inspections force row level security;
alter table rental_inspection_items enable row level security;alter table rental_inspection_items force row level security;
alter table rental_inspection_acknowledgements enable row level security;alter table rental_inspection_acknowledgements force row level security;
create policy "rental_inspection_owner_all" on rental_inspections for all to authenticated using(owner_id=auth.uid()::text) with check(owner_id=auth.uid()::text);
create policy "rental_inspection_tenant_select" on rental_inspections for select to authenticated using(status in ('finalized','acknowledged') and rental_actor_has_lease_access(owner_id,lease_id));
create policy "rental_inspection_item_owner_all" on rental_inspection_items for all to authenticated using(owner_id=auth.uid()::text) with check(owner_id=auth.uid()::text);
create policy "rental_inspection_item_tenant_select" on rental_inspection_items for select to authenticated using(exists(select 1 from rental_inspections inspection where inspection.owner_id=rental_inspection_items.owner_id and inspection.id=rental_inspection_items.inspection_id and inspection.status in ('finalized','acknowledged') and rental_actor_has_lease_access(inspection.owner_id,inspection.lease_id)));
create policy "rental_inspection_ack_owner_select" on rental_inspection_acknowledgements for select to authenticated using(owner_id=auth.uid()::text);
create policy "rental_inspection_ack_tenant_select" on rental_inspection_acknowledgements for select to authenticated using(tenant_id=rental_actor_tenant_id(owner_id));

create or replace function save_rental_inspection(p_owner_id text,p_inspection jsonb,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_id text:=coalesce(nullif(p_inspection->>'id',''),'rental_inspection_'||gen_random_uuid()::text);v_item jsonb;
begin
if p_owner_id<>auth.uid()::text then raise exception 'Authenticated owner does not match inspection owner.';end if;
if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one inspection item is required.';end if;
insert into rental_inspections(owner_id,id,lease_id,unit_id,tenant_id,inspection_type,inspection_date,status,general_notes)
values(p_owner_id,v_id,p_inspection->>'leaseId',p_inspection->>'unitId',p_inspection->>'tenantId',p_inspection->>'inspectionType',(p_inspection->>'inspectionDate')::date,'draft',nullif(btrim(p_inspection->>'generalNotes'),''));
for v_item in select * from jsonb_array_elements(p_items) loop
insert into rental_inspection_items(owner_id,id,inspection_id,area,component,condition_rating,notes,damage_observed,deposit_review_recommended,estimated_cost_cents,evidence_document_id)
values(p_owner_id,'rental_inspection_item_'||gen_random_uuid()::text,v_id,btrim(v_item->>'area'),btrim(v_item->>'component'),v_item->>'conditionRating',nullif(btrim(v_item->>'notes'),''),coalesce((v_item->>'damageObserved')::boolean,false),coalesce((v_item->>'depositReviewRecommended')::boolean,false),nullif(v_item->>'estimatedCostCents','')::bigint,nullif(v_item->>'evidenceDocumentId',''));
end loop;return jsonb_build_object('id',v_id,'status','draft');end;$$;
create or replace function acknowledge_rental_inspection(p_inspection_id text)
returns jsonb language plpgsql security definer set search_path=public set row_security=off as $$
declare v_inspection rental_inspections%rowtype;v_tenant_id text;
begin if auth.uid() is null then raise exception 'Authentication is required.';end if;select * into v_inspection from rental_inspections where id=p_inspection_id and status in ('finalized','acknowledged');if not found then raise exception 'Finalized inspection was not found.';end if;
v_tenant_id:=rental_actor_tenant_id(v_inspection.owner_id);if v_tenant_id is null or v_tenant_id<>v_inspection.tenant_id then raise exception 'Tenant does not have access to this inspection.';end if;
insert into rental_inspection_acknowledgements(owner_id,inspection_id,tenant_id,acknowledgement_text) values(v_inspection.owner_id,v_inspection.id,v_tenant_id,'Receipt acknowledged; acknowledgement is not agreement with findings or charges.') on conflict do nothing;
update rental_inspections set status='acknowledged',updated_at=now() where owner_id=v_inspection.owner_id and id=v_inspection.id;
return jsonb_build_object('inspection_id',v_inspection.id,'acknowledged',true);end;$$;
revoke all on function save_rental_inspection(text,jsonb,jsonb),function acknowledge_rental_inspection(text) from public,anon;
grant execute on function save_rental_inspection(text,jsonb,jsonb),function acknowledge_rental_inspection(text) to authenticated;
