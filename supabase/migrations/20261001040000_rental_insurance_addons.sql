-- Rentec parity R24: insurance add-on TRACKING — the remainder of gap item 23.
--
-- What already existed (verified in repo — NOT duplicated here):
--   * renters_insurance_policies + evidence upload + tenant portal submission +
--     owner review (renters-insurance domain, /api/rental/insurance)
--   * renters_insurance_requirements (per-LEASE requirements)
--   * rental_animals (name, breed, classification) + approval workflow +
--     monthly_pet_fees (pet-liability + pet-fee domains)
--   * pet_liability_policies per animal
--   * insurance-referral domain (partner referral LINKS with disclosure text)
--   * Renters-insurance compliance report (evidence on file)
--
-- What R24 adds (the missing remainder):
--   1. Per-PROPERTY insurance requirements (renters insurance and/or pet
--      records) — owners set the default once per property; the existing
--      per-lease renters_insurance_requirements rows remain the lease override.
--   2. Pet-record detail fields on rental_animals: weight_lbs,
--      vaccination_record_on_file, vaccination_expires_on (vaccination/expiry
--      tracking for pet screening records).
--   3. rental_pet_deposits — one-time pet deposit records (held / applied /
--      refunded / forfeited). RECORD-ONLY: the money movement stays in the
--      existing deposit flows (RentalDepositsPanel); this table records the
--      pet-deposit facts so compliance and lease reviews see them.
--   4. rental_lease_deposit_choices — per-lease record of the owner's choice:
--      traditional security deposit vs deposit-insurance product (product
--      reference recorded; no money moves here).
--   5. In-app expiry reminders are served by the dashboard query layer
--      (buildInsuranceComplianceDashboard), which flags expired and
--      expiring-soon (<=30 days) renters-insurance policies per lease.
--
-- SPEND DECISION (Jason's build-spend motto, hard boundary): partner insurance
-- products (renters-insurance partners, deposit-insurance products) cost money
-- or require partnerships. Nothing in this migration, the domain layer, the
-- API routes, or the UI signs up for, configures, contacts, purchases, or binds
-- any partner insurance product. The partner layer is a design-only stub
-- (src/application/rental/insurancePartnerProducts.js) that always reports
-- "not connected" and refuses quotes. Jason must approve partner choice, costs,
-- and who pays before partner products go live.
--
-- NOT APPLIED — authored for the owner's explicit approval before touching production.

-- ---------------------------------------------------------------------------
-- 1. rental_property_insurance_requirements — per-property owner defaults
-- ---------------------------------------------------------------------------
create table if not exists rental_property_insurance_requirements (
  owner_id text not null,
  property_id text not null,
  requires_renters_insurance boolean not null default false,
  minimum_liability_cents bigint not null default 0 check (minimum_liability_cents >= 0),
  requires_pet_records boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, property_id),
  constraint rental_property_insurance_requirements_id_required check (btrim(property_id) <> '')
);

alter table rental_property_insurance_requirements enable row level security;
alter table rental_property_insurance_requirements force row level security;

drop policy if exists "rental_property_insurance_requirement_owner_all" on rental_property_insurance_requirements;
create policy "rental_property_insurance_requirement_owner_all" on rental_property_insurance_requirements for all to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

-- Tenants may read the requirement rows for properties they hold a lease on.
drop policy if exists "rental_property_insurance_requirement_tenant_select" on rental_property_insurance_requirements;
create policy "rental_property_insurance_requirement_tenant_select" on rental_property_insurance_requirements for select to authenticated
  using (exists (
    select 1 from rental_leases l
    where l.owner_id = rental_property_insurance_requirements.owner_id
      and l.property_id = rental_property_insurance_requirements.property_id
      and rental_actor_has_lease_access(l.owner_id, l.id)
  ));

drop trigger if exists trg_rental_property_insurance_requirements_updated_at on rental_property_insurance_requirements;
create trigger trg_rental_property_insurance_requirements_updated_at
  before update on rental_property_insurance_requirements
  for each row execute function public.touch_rental_vendor_updated_at();

-- ---------------------------------------------------------------------------
-- 2. rental_animals — pet-record detail fields (weight + vaccination tracking)
-- ---------------------------------------------------------------------------
alter table rental_animals add column if not exists weight_lbs numeric
  check (weight_lbs is null or (weight_lbs >= 0.5 and weight_lbs <= 500));
alter table rental_animals add column if not exists vaccination_record_on_file boolean not null default false;
alter table rental_animals add column if not exists vaccination_expires_on date;

-- ---------------------------------------------------------------------------
-- 3. rental_pet_deposits — one-time pet deposit records (record-only)
-- ---------------------------------------------------------------------------
create table if not exists rental_pet_deposits (
  owner_id text not null,
  id text not null,
  animal_id text not null,
  tenant_id text not null,
  lease_id text not null,
  amount_cents bigint not null check (amount_cents > 0),
  status text not null default 'held'
    check (status in ('held', 'applied_to_balance', 'refunded', 'forfeited')),
  collected_at timestamptz not null default now(),
  released_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, animal_id),
  foreign key (owner_id, animal_id) references rental_animals (owner_id, id) on delete restrict,
  foreign key (owner_id, tenant_id) references rental_tenants (owner_id, id) on delete restrict,
  foreign key (owner_id, lease_id) references rental_leases (owner_id, id) on delete restrict,
  constraint rental_pet_deposits_id_required check (btrim(id) <> ''),
  check (released_at is null or status in ('applied_to_balance', 'refunded', 'forfeited'))
);

alter table rental_pet_deposits enable row level security;
alter table rental_pet_deposits force row level security;

drop policy if exists "rental_pet_deposit_owner_all" on rental_pet_deposits;
create policy "rental_pet_deposit_owner_all" on rental_pet_deposits for all to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists "rental_pet_deposit_tenant_select" on rental_pet_deposits;
create policy "rental_pet_deposit_tenant_select" on rental_pet_deposits for select to authenticated
  using (rental_actor_has_lease_access(owner_id, lease_id));

-- Pet deposits are prohibited for assistance-animal review records — reuse the
-- same guard as monthly_pet_fees (function reads NEW.owner_id/NEW.animal_id,
-- so it attaches cleanly to a second table).
drop trigger if exists prevent_assistance_animal_pet_deposit_trigger on rental_pet_deposits;
create trigger prevent_assistance_animal_pet_deposit_trigger before insert or update on rental_pet_deposits
  for each row execute function prevent_assistance_animal_pet_fee();

drop trigger if exists trg_rental_pet_deposits_updated_at on rental_pet_deposits;
create trigger trg_rental_pet_deposits_updated_at
  before update on rental_pet_deposits
  for each row execute function public.touch_rental_vendor_updated_at();

-- ---------------------------------------------------------------------------
-- 4. rental_lease_deposit_choices — traditional deposit vs deposit-insurance
-- ---------------------------------------------------------------------------
create table if not exists rental_lease_deposit_choices (
  owner_id text not null,
  lease_id text not null,
  choice text not null
    check (choice in ('traditional_security_deposit', 'deposit_insurance_product')),
  product_reference text,
  note text,
  recorded_by text,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, lease_id),
  foreign key (owner_id, lease_id) references rental_leases (owner_id, id) on delete restrict,
  -- A deposit-insurance product choice must name the product reference; the
  -- traditional choice carries none. The reference is a record of the owner's
  -- choice, not a binding — no partner is contacted (see spend decision above).
  check (choice = 'traditional_security_deposit' or (product_reference is not null and btrim(product_reference) <> ''))
);

alter table rental_lease_deposit_choices enable row level security;
alter table rental_lease_deposit_choices force row level security;

drop policy if exists "rental_lease_deposit_choice_owner_all" on rental_lease_deposit_choices;
create policy "rental_lease_deposit_choice_owner_all" on rental_lease_deposit_choices for all to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists "rental_lease_deposit_choice_tenant_select" on rental_lease_deposit_choices;
create policy "rental_lease_deposit_choice_tenant_select" on rental_lease_deposit_choices for select to authenticated
  using (rental_actor_has_lease_access(owner_id, lease_id));

drop trigger if exists trg_rental_lease_deposit_choices_updated_at on rental_lease_deposit_choices;
create trigger trg_rental_lease_deposit_choices_updated_at
  before update on rental_lease_deposit_choices
  for each row execute function public.touch_rental_vendor_updated_at();
