create table if not exists public.financial_assets (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  asset_class text not null check (asset_class in (
    'real_estate', 'vehicle', 'equipment', 'trailer', 'collectible', 'crypto', 'other'
  )),
  ownership_scope text not null check (ownership_scope in ('business', 'personal', 'mixed')),
  linked_property_id text,
  purchase_date date,
  purchase_cost_cents bigint check (purchase_cost_cents is null or purchase_cost_cents >= 0),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_financial_assets_owner_class
  on public.financial_assets(owner_id, asset_class, name);

create table if not exists public.financial_asset_valuations (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  asset_id text not null references public.financial_assets(id) on delete cascade,
  amount_cents bigint not null check (amount_cents >= 0),
  effective_date date not null,
  source text not null check (source in (
    'manual', 'simplifi', 'plaid', 'brokerage', 'appraisal', 'market'
  )),
  notes text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_financial_asset_valuations_snapshot
  on public.financial_asset_valuations(owner_id, asset_id, effective_date, source);

create index if not exists idx_financial_asset_valuations_latest
  on public.financial_asset_valuations(owner_id, asset_id, effective_date desc, created_at desc);

alter table public.financial_assets enable row level security;
alter table public.financial_assets force row level security;
alter table public.financial_asset_valuations enable row level security;
alter table public.financial_asset_valuations force row level security;

create policy "financial_assets_owner_all" on public.financial_assets
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "financial_asset_valuations_owner_all" on public.financial_asset_valuations
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create or replace function public.create_financial_asset_with_valuation(
  p_id text,
  p_name text,
  p_asset_class text,
  p_ownership_scope text,
  p_linked_property_id text,
  p_purchase_date date,
  p_purchase_cost_cents bigint,
  p_notes text,
  p_valuation_id text,
  p_value_cents bigint,
  p_value_date date,
  p_value_source text
) returns public.financial_assets
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_asset public.financial_assets;
begin
  if v_owner_id is null then raise exception 'Authenticated owner is required.'; end if;

  insert into public.financial_assets (
    id, owner_id, name, asset_class, ownership_scope, linked_property_id,
    purchase_date, purchase_cost_cents, notes
  ) values (
    p_id, v_owner_id, trim(p_name), p_asset_class, p_ownership_scope,
    nullif(trim(coalesce(p_linked_property_id, '')), ''), p_purchase_date,
    p_purchase_cost_cents, nullif(trim(coalesce(p_notes, '')), '')
  ) returning * into v_asset;

  insert into public.financial_asset_valuations (
    id, owner_id, asset_id, amount_cents, effective_date, source
  ) values (
    p_valuation_id, v_owner_id, p_id, p_value_cents, p_value_date, p_value_source
  );

  insert into public.financial_accounts (
    id, owner_id, connection_id, provider, provider_account_id, institution_id,
    name, official_name, mask, type, subtype, currency_code, active, created_at, updated_at
  ) values (
    p_id, v_owner_id::text, 'manual_assets', 'manual_asset', p_id, 'manual_assets',
    trim(p_name), null, null, 'other', p_asset_class, 'USD', true, now(), now()
  );

  insert into public.account_balances (
    id, owner_id, financial_account_id, connection_id, provider, provider_account_id,
    currency_code, current_balance_cents, available_balance_cents, as_of
  ) values (
    'account_balance_' || p_valuation_id, v_owner_id, p_id, 'manual_assets',
    'manual_asset', p_id, 'USD', p_value_cents, null, p_value_date::timestamptz
  );

  return v_asset;
end;
$$;

grant execute on function public.create_financial_asset_with_valuation(
  text, text, text, text, text, date, bigint, text, text, bigint, date, text
) to authenticated;
