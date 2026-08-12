create table if not exists landlord_payment_accounts (
    owner_id text not null, id text not null, provider text not null, provider_account_id text,
    status text not null check (status in ('not_started','onboarding','restricted','enabled','disabled')),
    details_submitted boolean not null default false, charges_enabled boolean not null default false,
    payouts_enabled boolean not null default false, ach_debit_enabled boolean not null default false,
    card_payments_enabled boolean not null default false, requirements_due jsonb not null default '[]'::jsonb
      check (jsonb_typeof(requirements_due) = 'array'),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (owner_id, id), unique (provider, provider_account_id), unique (owner_id, provider),
    check (status <> 'enabled' or (provider_account_id is not null and charges_enabled and payouts_enabled))
);

create table if not exists billing_customer_references (
    owner_id text not null, tenant_id text not null, provider text not null, connected_account_id text not null,
    customer_id text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (owner_id, tenant_id, provider), unique (provider, connected_account_id, customer_id),
    foreign key (owner_id, tenant_id) references rental_tenants(owner_id, id) on delete restrict
);

alter table landlord_payment_accounts enable row level security;
alter table landlord_payment_accounts force row level security;
alter table billing_customer_references enable row level security;
alter table billing_customer_references force row level security;

create policy "landlord_payment_accounts_owner_select" on landlord_payment_accounts for select to authenticated
using (owner_id = auth.uid()::text);
create policy "billing_customer_references_owner_select" on billing_customer_references for select to authenticated
using (owner_id = auth.uid()::text);

-- Provider mappings are mutated only by trusted server-side service-role operations after verified provider responses.
