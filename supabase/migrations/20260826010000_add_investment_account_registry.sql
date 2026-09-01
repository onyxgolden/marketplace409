create table if not exists public.investment_accounts (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  institution_name text,
  account_type text not null check (account_type in (
    'taxable_brokerage', 'ira', 'roth_ira', '401k', 'pension',
    'crypto_exchange', 'crypto_wallet', 'metals_vault', 'private_investment', 'other'
  )),
  tax_treatment text not null check (tax_treatment in (
    'taxable', 'tax_deferred', 'tax_exempt', 'unknown'
  )),
  ownership_scope text not null check (ownership_scope in ('business', 'personal', 'mixed')),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_investment_accounts_owner_type
  on public.investment_accounts(owner_id, account_type, name);

-- Prevents an accidental double-entry of the same account under the same name (typo re-add,
-- double-submit) from silently doubling it in Net Worth.
create unique index if not exists idx_investment_accounts_owner_name_active
  on public.investment_accounts(owner_id, name)
  where active;

create table if not exists public.investment_account_valuations (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  account_id text not null references public.investment_accounts(id) on delete cascade,
  amount_cents bigint not null check (amount_cents >= 0),
  effective_date date not null,
  source text not null check (source in (
    'manual', 'simplifi', 'plaid', 'brokerage', 'custodian_statement'
  )),
  notes text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_investment_account_valuations_snapshot
  on public.investment_account_valuations(owner_id, account_id, effective_date, source);

create index if not exists idx_investment_account_valuations_latest
  on public.investment_account_valuations(owner_id, account_id, effective_date desc, created_at desc);

alter table public.investment_accounts enable row level security;
alter table public.investment_accounts force row level security;
alter table public.investment_account_valuations enable row level security;
alter table public.investment_account_valuations force row level security;

create policy "investment_accounts_owner_all" on public.investment_accounts
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "investment_account_valuations_owner_all" on public.investment_account_valuations
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create or replace function public.create_investment_account_with_valuation(
  p_id text,
  p_name text,
  p_institution_name text,
  p_account_type text,
  p_tax_treatment text,
  p_ownership_scope text,
  p_notes text,
  p_valuation_id text,
  p_value_cents bigint,
  p_value_date date,
  p_value_source text
) returns public.investment_accounts
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_account public.investment_accounts;
begin
  if v_owner_id is null then raise exception 'Authenticated owner is required.'; end if;

  insert into public.investment_accounts (
    id, owner_id, name, institution_name, account_type, tax_treatment, ownership_scope, notes
  ) values (
    p_id, v_owner_id, trim(p_name), nullif(trim(coalesce(p_institution_name, '')), ''),
    p_account_type, p_tax_treatment, p_ownership_scope, nullif(trim(coalesce(p_notes, '')), '')
  ) returning * into v_account;

  insert into public.investment_account_valuations (
    id, owner_id, account_id, amount_cents, effective_date, source
  ) values (
    p_valuation_id, v_owner_id, p_id, p_value_cents, p_value_date, p_value_source
  );

  insert into public.financial_accounts (
    id, owner_id, connection_id, provider, provider_account_id, institution_id,
    name, official_name, mask, type, subtype, currency_code, active, created_at, updated_at
  ) values (
    p_id, v_owner_id::text, 'manual_investments', 'manual_investment', p_id, 'manual_investments',
    trim(p_name), null, null, 'investment', p_account_type, 'USD', true, now(), now()
  );

  insert into public.account_balances (
    id, owner_id, financial_account_id, connection_id, provider, provider_account_id,
    currency_code, current_balance_cents, available_balance_cents, as_of
  ) values (
    'account_balance_' || p_valuation_id, v_owner_id, p_id, 'manual_investments',
    'manual_investment', p_id, 'USD', p_value_cents, null, p_value_date::timestamptz
  );

  return v_account;
end;
$$;

grant execute on function public.create_investment_account_with_valuation(
  text, text, text, text, text, text, text, text, bigint, date, text
) to authenticated;

create or replace function public.update_investment_account_with_valuation(
  p_account_id text,
  p_name text,
  p_institution_name text,
  p_account_type text,
  p_tax_treatment text,
  p_ownership_scope text,
  p_notes text,
  p_valuation_id text,
  p_value_cents bigint,
  p_value_date date,
  p_value_source text
) returns public.investment_accounts
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_account public.investment_accounts;
begin
  if v_owner_id is null then raise exception 'Authenticated owner is required.'; end if;

  update public.investment_accounts
  set name = trim(p_name),
      institution_name = nullif(trim(coalesce(p_institution_name, '')), ''),
      account_type = p_account_type,
      tax_treatment = p_tax_treatment,
      ownership_scope = p_ownership_scope,
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where id = p_account_id and owner_id = v_owner_id and active = true
  returning * into v_account;

  if v_account.id is null then raise exception 'Active investment account was not found.'; end if;

  insert into public.investment_account_valuations (
    id, owner_id, account_id, amount_cents, effective_date, source
  ) values (
    p_valuation_id, v_owner_id, p_account_id, p_value_cents, p_value_date, p_value_source
  ) on conflict (owner_id, account_id, effective_date, source) do update
    set amount_cents = excluded.amount_cents,
        notes = excluded.notes,
        created_at = now();

  update public.financial_accounts
  set name = trim(p_name), subtype = p_account_type, updated_at = now()
  where id = p_account_id and owner_id = v_owner_id::text and provider = 'manual_investment';

  insert into public.account_balances (
    id, owner_id, financial_account_id, connection_id, provider, provider_account_id,
    currency_code, current_balance_cents, available_balance_cents, as_of
  ) values (
    'account_balance_' || p_valuation_id, v_owner_id, p_account_id, 'manual_investments',
    'manual_investment', p_account_id, 'USD', p_value_cents, null, p_value_date::timestamptz
  )
  on conflict (owner_id, financial_account_id, as_of) do update
    set current_balance_cents = excluded.current_balance_cents;

  return v_account;
end;
$$;

grant execute on function public.update_investment_account_with_valuation(
  text, text, text, text, text, text, text, text, bigint, date, text
) to authenticated;

create or replace function public.deactivate_investment_account(
  p_account_id text
) returns public.investment_accounts
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_account public.investment_accounts;
begin
  if v_owner_id is null then raise exception 'Authenticated owner is required.'; end if;

  update public.investment_accounts
  set active = false, updated_at = now()
  where id = p_account_id and owner_id = v_owner_id and active = true
  returning * into v_account;

  if v_account.id is null then raise exception 'Active investment account was not found.'; end if;

  update public.financial_accounts
  set active = false, updated_at = now()
  where id = p_account_id and owner_id = v_owner_id::text and provider = 'manual_investment';

  return v_account;
end;
$$;

grant execute on function public.deactivate_investment_account(text) to authenticated;
