create table if not exists insurance_referral_links (
  owner_id text not null, id text not null, provider_name text not null,
  product text not null check(product in ('renters_insurance','dog_liability')),
  outbound_url text not null check(outbound_url like 'https://%'), referral_compensation_possible boolean not null default false,
  disclosure_text text not null, active boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(owner_id,id),
  unique(owner_id,provider_name,product)
);
comment on table insurance_referral_links is 'Outbound links only. FORGE does not quote, bind, sell, service, or collect premiums for insurance.';
alter table insurance_referral_links enable row level security; alter table insurance_referral_links force row level security;
create policy "insurance_referral_owner_all" on insurance_referral_links for all to authenticated
  using(owner_id=auth.uid()::text) with check(owner_id=auth.uid()::text);
create policy "insurance_referral_tenant_select" on insurance_referral_links for select to authenticated using(active=true);
