create table if not exists renters_insurance_requirements (
  owner_id text not null, lease_id text not null, required boolean not null default false,
  minimum_liability_cents bigint not null default 0 check (minimum_liability_cents >= 0),
  purchase_url text, referral_compensation_enabled boolean not null default false,
  jurisdiction_code text not null default 'TX', lease_clause_evidence_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (owner_id, lease_id), foreign key (owner_id, lease_id) references rental_leases(owner_id,id) on delete restrict,
  check (not referral_compensation_enabled or purchase_url is not null)
);
create table if not exists renters_insurance_policies (
  owner_id text not null, id text not null, tenant_id text not null, lease_id text not null, carrier_name text not null,
  policy_number_masked text not null, liability_limit_cents bigint not null check (liability_limit_cents >= 0),
  effective_date date not null, expiration_date date not null, status text not null
    check (status in ('not_provided','pending_verification','verified','expired','cancelled','rejected')),
  verification_provider text, provider_verification_id text, evidence_id text, verified_at timestamptz, last_checked_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(owner_id,id),
  foreign key(owner_id,tenant_id) references rental_tenants(owner_id,id) on delete restrict,
  foreign key(owner_id,lease_id) references rental_leases(owner_id,id) on delete restrict,
  check (expiration_date >= effective_date), check (status <> 'verified' or (verified_at is not null and (evidence_id is not null or provider_verification_id is not null)))
);
alter table renters_insurance_requirements enable row level security; alter table renters_insurance_requirements force row level security;
alter table renters_insurance_policies enable row level security; alter table renters_insurance_policies force row level security;
create policy "insurance_requirement_owner_all" on renters_insurance_requirements for all to authenticated using(owner_id=auth.uid()::text) with check(owner_id=auth.uid()::text);
create policy "insurance_requirement_tenant_select" on renters_insurance_requirements for select to authenticated using(rental_actor_has_lease_access(owner_id,lease_id));
create policy "insurance_policy_owner_all" on renters_insurance_policies for all to authenticated using(owner_id=auth.uid()::text) with check(owner_id=auth.uid()::text);
create policy "insurance_policy_tenant_select" on renters_insurance_policies for select to authenticated using(rental_actor_has_lease_access(owner_id,lease_id));
