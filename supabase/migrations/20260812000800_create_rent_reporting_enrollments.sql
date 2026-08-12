create table if not exists rent_reporting_enrollments (
  owner_id text not null, id text not null, tenant_id text not null, lease_id text not null,
  provider text not null, provider_enrollment_id text, furnisher_name text not null,
  status text not null check (status in ('pending','active','paused','cancelled','failed')),
  monthly_fee_cents bigint not null check (monthly_fee_cents >= 0), currency_code text not null,
  consent_text_version text not null, consented_at timestamptz not null, cancelled_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (owner_id, id), unique (owner_id, tenant_id, lease_id, provider),
  unique (provider, provider_enrollment_id),
  foreign key (owner_id, tenant_id) references rental_tenants(owner_id, id) on delete restrict,
  foreign key (owner_id, lease_id) references rental_leases(owner_id, id) on delete restrict,
  check (status <> 'active' or provider_enrollment_id is not null),
  check (status <> 'cancelled' or cancelled_at is not null)
);
create table if not exists rent_reporting_fees (
  owner_id text not null, id text not null, enrollment_id text not null, rental_payment_id text,
  service_period text not null check (service_period ~ '^\\d{4}-\\d{2}$'), amount_cents bigint not null check (amount_cents >= 0),
  currency_code text not null, status text not null check (status in ('scheduled','due','paid','waived','void')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (owner_id, id), unique (owner_id, enrollment_id, service_period),
  foreign key (owner_id, enrollment_id) references rent_reporting_enrollments(owner_id, id) on delete restrict,
  foreign key (owner_id, rental_payment_id) references rental_payments(owner_id, id) on delete restrict
);
alter table rent_reporting_enrollments enable row level security; alter table rent_reporting_enrollments force row level security;
alter table rent_reporting_fees enable row level security; alter table rent_reporting_fees force row level security;
create policy "rent_reporting_owner_all" on rent_reporting_enrollments for all to authenticated
  using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "rent_reporting_tenant_select" on rent_reporting_enrollments for select to authenticated
  using (rental_actor_has_lease_access(owner_id, lease_id));
create policy "rent_reporting_fee_owner_all" on rent_reporting_fees for all to authenticated
  using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "rent_reporting_fee_tenant_select" on rent_reporting_fees for select to authenticated
  using (exists (select 1 from rent_reporting_enrollments e where e.owner_id = rent_reporting_fees.owner_id
    and e.id = rent_reporting_fees.enrollment_id and rental_actor_has_lease_access(e.owner_id, e.lease_id)));
