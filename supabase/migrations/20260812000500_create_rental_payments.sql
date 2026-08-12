create table if not exists rental_payments (
    owner_id text not null, id text not null, charge_id text not null, lease_id text not null, tenant_id text not null,
    provider text not null, provider_customer_id text, provider_payment_id text,
    amount_cents bigint not null check (amount_cents > 0), refunded_amount_cents bigint not null default 0
      check (refunded_amount_cents >= 0 and refunded_amount_cents <= amount_cents),
    currency_code text not null check (currency_code = upper(currency_code) and char_length(currency_code) = 3),
    status text not null check (status in ('created','requires_payment_method','requires_action','processing','succeeded','failed','cancelled','partially_refunded','refunded','disputed')),
    idempotency_key text not null, failure_code text, failure_message text,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(), succeeded_at timestamptz,
    primary key (owner_id, id), unique (owner_id, idempotency_key), unique (provider, provider_payment_id),
    foreign key (owner_id, charge_id) references rent_charges(owner_id, id) on delete restrict,
    foreign key (owner_id, lease_id) references rental_leases(owner_id, id) on delete restrict,
    foreign key (owner_id, tenant_id) references rental_tenants(owner_id, id) on delete restrict,
    check (status <> 'succeeded' or succeeded_at is not null),
    check (status <> 'refunded' or refunded_amount_cents = amount_cents)
);

create table if not exists rental_settlements (
    owner_id text not null, id text not null, payment_id text not null, provider text not null,
    provider_balance_transaction_id text, provider_payout_id text,
    gross_amount_cents bigint not null check (gross_amount_cents >= 0), fee_amount_cents bigint not null check (fee_amount_cents >= 0),
    net_amount_cents bigint not null check (net_amount_cents >= 0), currency_code text not null,
    status text not null check (status in ('pending','available','paid_out','failed','reversed')),
    available_at timestamptz, paid_out_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (owner_id, id), unique (provider, provider_balance_transaction_id),
    foreign key (owner_id, payment_id) references rental_payments(owner_id, id) on delete restrict,
    check (net_amount_cents = gross_amount_cents - fee_amount_cents)
);

create table if not exists payment_webhook_events (
    id text primary key, provider text not null, provider_event_id text not null, event_type text not null,
    object_id text, status text not null check (status in ('received','processing','processed','ignored','failed')),
    received_at timestamptz not null default now(), processed_at timestamptz, failure_message text, payload_hash text not null,
    unique (provider, provider_event_id), check (status <> 'processed' or processed_at is not null)
);

create table if not exists ach_authorizations (
    owner_id text not null, id text not null, tenant_id text not null, lease_id text not null, provider text not null,
    provider_customer_id text not null, provider_payment_method_id text not null, mandate_reference text not null,
    authorization_text_version text not null, authorized_at timestamptz not null, revoked_at timestamptz,
    status text not null check (status in ('active','revoked','expired')), ip_address text, user_agent text,
    created_at timestamptz not null default now(), primary key (owner_id, id), unique (provider, mandate_reference),
    foreign key (owner_id, tenant_id) references rental_tenants(owner_id, id) on delete restrict,
    foreign key (owner_id, lease_id) references rental_leases(owner_id, id) on delete restrict,
    check (status <> 'revoked' or revoked_at is not null)
);

create index if not exists idx_rental_payments_owner_charge on rental_payments(owner_id, charge_id);
create unique index if not exists idx_rental_payments_one_pending_per_charge
on rental_payments(owner_id, charge_id)
where status in ('created','requires_payment_method','requires_action','processing');
create index if not exists idx_rental_settlements_owner_payment on rental_settlements(owner_id, payment_id);

alter table rental_payments enable row level security; alter table rental_payments force row level security;
alter table rental_settlements enable row level security; alter table rental_settlements force row level security;
alter table payment_webhook_events enable row level security; alter table payment_webhook_events force row level security;
alter table ach_authorizations enable row level security; alter table ach_authorizations force row level security;

create policy "rental_payments_owner_all" on rental_payments for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "rental_payments_tenant_select" on rental_payments for select to authenticated
using (rental_actor_has_lease_access(owner_id, lease_id));
create policy "rental_settlements_owner_all" on rental_settlements for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "ach_authorizations_owner_all" on ach_authorizations for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "ach_authorizations_tenant_select" on ach_authorizations for select to authenticated
using (rental_actor_has_lease_access(owner_id, lease_id));

-- Webhook events contain processor payload metadata and are service-role only; no authenticated policy is granted.
