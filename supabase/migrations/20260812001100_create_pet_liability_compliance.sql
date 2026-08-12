create table if not exists rental_animals (
  owner_id text not null, id text not null, tenant_id text not null, lease_id text not null, name text not null,
  species text not null check(species='dog'), breed_description text not null,
  classification text not null check(classification in ('pet','assistance_review_requested','assistance_animal_approved','assistance_request_denied')),
  insurer_risk_flag boolean not null default false, human_review_required boolean not null default true,
  review_evidence_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(owner_id,id), foreign key(owner_id,tenant_id) references rental_tenants(owner_id,id) on delete restrict,
  foreign key(owner_id,lease_id) references rental_leases(owner_id,id) on delete restrict,
  check(classification <> 'assistance_review_requested' or human_review_required)
);
create table if not exists pet_liability_policies (
  owner_id text not null, id text not null, animal_id text not null, tenant_id text not null, lease_id text not null,
  required boolean not null, status text not null check(status in ('not_required','required','pending_verification','verified','expired','cancelled','rejected')),
  carrier_name text, policy_number_masked text, liability_limit_cents bigint check(liability_limit_cents >= 0),
  bodily_injury_covered boolean, property_damage_covered boolean, breed_exclusion_confirmed_absent boolean,
  landlord_additional_insured boolean, effective_date date, expiration_date date, evidence_id text,
  verification_provider text, provider_verification_id text, verified_at timestamptz, last_checked_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(owner_id,id),
  unique(owner_id,animal_id), foreign key(owner_id,animal_id) references rental_animals(owner_id,id) on delete restrict,
  foreign key(owner_id,tenant_id) references rental_tenants(owner_id,id) on delete restrict,
  foreign key(owner_id,lease_id) references rental_leases(owner_id,id) on delete restrict,
  check(status <> 'verified' or (carrier_name is not null and policy_number_masked is not null and liability_limit_cents is not null
    and bodily_injury_covered and property_damage_covered and breed_exclusion_confirmed_absent and evidence_id is not null and verified_at is not null)),
  check(expiration_date is null or effective_date is null or expiration_date >= effective_date)
);
alter table rental_animals enable row level security; alter table rental_animals force row level security;
alter table pet_liability_policies enable row level security; alter table pet_liability_policies force row level security;
create policy "rental_animals_owner_all" on rental_animals for all to authenticated using(owner_id=auth.uid()::text) with check(owner_id=auth.uid()::text);
create policy "rental_animals_tenant_select" on rental_animals for select to authenticated using(rental_actor_has_lease_access(owner_id,lease_id));
create policy "pet_liability_owner_all" on pet_liability_policies for all to authenticated using(owner_id=auth.uid()::text) with check(owner_id=auth.uid()::text);
create policy "pet_liability_tenant_select" on pet_liability_policies for select to authenticated using(rental_actor_has_lease_access(owner_id,lease_id));
