alter table rental_animals add column if not exists approval_status text not null default 'requested'
  check(approval_status in ('requested','approved','denied','withdrawn'));
alter table rental_animals add column if not exists approved_at timestamptz;
alter table rental_animals add column if not exists approved_by text;
alter table rental_animals add column if not exists approval_evidence_id text;
alter table rental_animals add constraint rental_animals_approved_evidence_check
  check(approval_status <> 'approved' or (approved_at is not null and approved_by is not null and approval_evidence_id is not null));

create table if not exists monthly_pet_fees (
  owner_id text not null, id text not null, animal_id text not null, lease_id text not null,
  amount_cents bigint not null check(amount_cents > 0), currency_code text not null default 'USD',
  status text not null check(status in ('draft','active','paused','ended')),
  effective_start_date date not null, effective_end_date date, approval_evidence_id text not null, approved_at timestamptz not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(owner_id,id),
  unique(owner_id,animal_id), foreign key(owner_id,animal_id) references rental_animals(owner_id,id) on delete restrict,
  foreign key(owner_id,lease_id) references rental_leases(owner_id,id) on delete restrict,
  check(effective_end_date is null or effective_end_date >= effective_start_date)
);
create table if not exists monthly_pet_fee_charges (
  owner_id text not null, id text not null, pet_fee_id text not null, animal_id text not null, lease_id text not null,
  period text not null check(period ~ '^\\d{4}-\\d{2}$'), due_date date not null, amount_cents bigint not null check(amount_cents > 0),
  paid_amount_cents bigint not null default 0 check(paid_amount_cents >= 0 and paid_amount_cents <= amount_cents),
  currency_code text not null, status text not null check(status in ('scheduled','due','partially_paid','paid','overdue','void')),
  source_key text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(owner_id,id), unique(owner_id,source_key), foreign key(owner_id,pet_fee_id) references monthly_pet_fees(owner_id,id) on delete restrict,
  foreign key(owner_id,animal_id) references rental_animals(owner_id,id) on delete restrict,
  foreign key(owner_id,lease_id) references rental_leases(owner_id,id) on delete restrict
);
alter table monthly_pet_fees enable row level security; alter table monthly_pet_fees force row level security;
alter table monthly_pet_fee_charges enable row level security; alter table monthly_pet_fee_charges force row level security;
create policy "pet_fees_owner_all" on monthly_pet_fees for all to authenticated using(owner_id=auth.uid()::text) with check(owner_id=auth.uid()::text);
create policy "pet_fees_tenant_select" on monthly_pet_fees for select to authenticated using(rental_actor_has_lease_access(owner_id,lease_id));
create policy "pet_fee_charges_owner_all" on monthly_pet_fee_charges for all to authenticated using(owner_id=auth.uid()::text) with check(owner_id=auth.uid()::text);
create policy "pet_fee_charges_tenant_select" on monthly_pet_fee_charges for select to authenticated using(rental_actor_has_lease_access(owner_id,lease_id));

create or replace function generate_monthly_pet_fee_charge(p_owner_id text,p_pet_fee_id text,p_period text,p_due_day integer default 1)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_fee monthly_pet_fees%rowtype; v_animal rental_animals%rowtype; v_id text; v_due date; v_row monthly_pet_fee_charges%rowtype;
begin
  if auth.uid() is null or auth.uid()::text<>p_owner_id then raise exception 'Authenticated owner id is required.'; end if;
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
end; $$;
