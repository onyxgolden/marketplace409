-- Brain slice 7: deterministic debt-payoff optimizer persistence.
--
-- 1. debt_terms: owner-confirmed APR + minimum payment per debt account,
--    keyed by financial account id. The liability feed carries balances but
--    almost never carries rates, and the optimizer must never guess a rate --
--    a debt without a terms row is surfaced as "needs your rate" and excluded
--    from the simulation. tax_deductible marks debts like the mortgage so the
--    comparison can show the after-tax effective rate next to the sticker APR.
--    Fully reversible: rows are upserted/deleted by the owner, never by FORGE.
--
-- 2. brain_preferences: owner-scoped boolean toggles for Brain features,
--    keyed by preference name. Absence of a row means the default (ON for
--    debt_payoff_suggestions_enabled). The digest/inbox "top move" hook reads
--    this and stays silent when the owner opts out.
--
-- Both tables are owner-scoped via RLS (same pattern as
-- dismissed_brain_alerts): every policy ties owner_id to auth.uid().

create table if not exists debt_terms (
    owner_id text not null,
    financial_account_id text not null,
    apr numeric,
    minimum_payment numeric,
    tax_deductible boolean not null default false,
    updated_at timestamptz not null default now(),
    primary key (owner_id, financial_account_id)
);

create index if not exists
    idx_debt_terms_owner
on debt_terms(owner_id);

alter table debt_terms enable row level security;

alter table debt_terms force row level security;

create policy "debt_terms_owner_select"
on debt_terms
for select
to authenticated
using (
    owner_id = auth.uid()::text
);

create policy "debt_terms_owner_insert"
on debt_terms
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
);

create policy "debt_terms_owner_update"
on debt_terms
for update
to authenticated
using (
    owner_id = auth.uid()::text
)
with check (
    owner_id = auth.uid()::text
);

create policy "debt_terms_owner_delete"
on debt_terms
for delete
to authenticated
using (
    owner_id = auth.uid()::text
);

create table if not exists brain_preferences (
    owner_id text not null,
    preference_key text not null,
    enabled boolean not null,
    updated_at timestamptz not null default now(),
    primary key (owner_id, preference_key)
);

create index if not exists
    idx_brain_preferences_owner
on brain_preferences(owner_id);

alter table brain_preferences enable row level security;

alter table brain_preferences force row level security;

create policy "brain_preferences_owner_select"
on brain_preferences
for select
to authenticated
using (
    owner_id = auth.uid()::text
);

create policy "brain_preferences_owner_insert"
on brain_preferences
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
);

create policy "brain_preferences_owner_update"
on brain_preferences
for update
to authenticated
using (
    owner_id = auth.uid()::text
)
with check (
    owner_id = auth.uid()::text
);

create policy "brain_preferences_owner_delete"
on brain_preferences
for delete
to authenticated
using (
    owner_id = auth.uid()::text
);
