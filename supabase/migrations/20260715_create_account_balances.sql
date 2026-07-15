create table if not exists public.account_balances (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  financial_account_id text not null references public.financial_accounts(id) on delete cascade,
  connection_id text not null,
  provider text not null,
  provider_account_id text not null,
  currency_code text not null,
  current_balance_cents bigint not null,
  available_balance_cents bigint,
  as_of timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists
  idx_account_balances_owner_financial_account_as_of
on public.account_balances (
  owner_id,
  financial_account_id,
  as_of
);

create index if not exists
  idx_account_balances_financial_account_as_of
on public.account_balances (
  financial_account_id,
  as_of desc
);

create index if not exists
  idx_account_balances_connection_as_of
on public.account_balances (
  connection_id,
  as_of desc
);

alter table public.account_balances
  enable row level security;

alter table public.account_balances
  force row level security;

create policy "Users can select their own account balances"
on public.account_balances
for select
using (auth.uid() = owner_id);

create policy "Users can insert their own account balances"
on public.account_balances
for insert
with check (auth.uid() = owner_id);

create policy "Users can update their own account balances"
on public.account_balances
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "Users can delete their own account balances"
on public.account_balances
for delete
using (auth.uid() = owner_id);
