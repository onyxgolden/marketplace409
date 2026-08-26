-- Shared FORGE workspace membership -- Checkpoint 4 (RPC half, part 2). Fixes a real write-time
-- bug found during Phase 1 inspection, not just an access-check gap: these 6 RPCs take no
-- p_owner_id parameter at all -- they derive `v_owner_id uuid := auth.uid();` internally and use
-- that value as what they WRITE (the owner_id of a newly created/updated financial_assets or
-- investment_accounts row), not just as a check. Unchanged, a co-owner calling any of these would
-- silently create or modify data under her own owner_id instead of the shared workspace's --
-- invisible to the primary owner, and a real data-correctness bug, not merely an access gap.
--
-- Fix: `v_owner_id uuid := auth.uid();` becomes
-- `v_owner_id uuid := public.resolve_effective_owner_id()::uuid;` -- resolve_effective_owner_id()
-- returns the primary owner's id unchanged for a primary owner or an unauthenticated caller (it can
-- still return null when auth.uid() is null, preserving each function's existing
-- `if v_owner_id is null then raise exception` guard exactly as before), and the actual workspace
-- owner's id for an active co-owner. Every function body below is otherwise byte-for-byte identical
-- to its current live definition except for this single substitution.

create or replace function public.create_financial_asset_with_valuation(p_id text, p_name text, p_asset_class text, p_ownership_scope text, p_linked_property_id text, p_purchase_date date, p_purchase_cost_cents bigint, p_notes text, p_valuation_id text, p_value_cents bigint, p_value_date date, p_value_source text)
 returns financial_assets
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_owner_id uuid := public.resolve_effective_owner_id()::uuid;
  v_asset public.financial_assets;
begin
  if v_owner_id is null then raise exception 'Authenticated owner is required.'; end if;
  if nullif(trim(coalesce(p_linked_property_id, '')), '') is not null and not exists (
    select 1 from public.rental_units
    where owner_id = v_owner_id::text
      and property_id = trim(p_linked_property_id)
  ) then
    raise exception 'Linked property does not belong to authenticated owner.';
  end if;
  if nullif(trim(coalesce(p_linked_property_id, '')), '') is not null and exists (
    select 1 from public.financial_assets
    where owner_id = v_owner_id
      and active = true
      and linked_property_id = trim(p_linked_property_id)
  ) then
    raise exception 'This property is already linked to another active asset. Retire that asset first, or leave this one unlinked, to avoid double-counting it in Net Worth.';
  end if;

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
$function$;


create or replace function public.update_financial_asset_with_valuation(p_asset_id text, p_name text, p_asset_class text, p_ownership_scope text, p_linked_property_id text, p_purchase_date date, p_purchase_cost_cents bigint, p_notes text, p_valuation_id text, p_value_cents bigint, p_value_date date, p_value_source text)
 returns financial_assets
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_owner_id uuid := public.resolve_effective_owner_id()::uuid;
  v_asset public.financial_assets;
begin
  if v_owner_id is null then raise exception 'Authenticated owner is required.'; end if;
  if nullif(trim(coalesce(p_linked_property_id, '')), '') is not null and not exists (
    select 1 from public.rental_units
    where owner_id = v_owner_id::text
      and property_id = trim(p_linked_property_id)
  ) then
    raise exception 'Linked property does not belong to authenticated owner.';
  end if;
  if nullif(trim(coalesce(p_linked_property_id, '')), '') is not null and exists (
    select 1 from public.financial_assets
    where owner_id = v_owner_id
      and active = true
      and id != p_asset_id
      and linked_property_id = trim(p_linked_property_id)
  ) then
    raise exception 'This property is already linked to another active asset. Retire that asset first, or leave this one unlinked, to avoid double-counting it in Net Worth.';
  end if;

  update public.financial_assets
  set name = trim(p_name),
      asset_class = p_asset_class,
      ownership_scope = p_ownership_scope,
      linked_property_id = nullif(trim(coalesce(p_linked_property_id, '')), ''),
      purchase_date = p_purchase_date,
      purchase_cost_cents = p_purchase_cost_cents,
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where id = p_asset_id and owner_id = v_owner_id and active = true
  returning * into v_asset;

  if v_asset.id is null then raise exception 'Active asset was not found.'; end if;

  insert into public.financial_asset_valuations (
    id, owner_id, asset_id, amount_cents, effective_date, source
  ) values (
    p_valuation_id, v_owner_id, p_asset_id, p_value_cents, p_value_date, p_value_source
  ) on conflict (owner_id, asset_id, effective_date, source) do update
    set amount_cents = excluded.amount_cents,
        notes = excluded.notes,
        created_at = now();

  update public.financial_accounts
  set name = trim(p_name), subtype = p_asset_class, updated_at = now()
  where id = p_asset_id and owner_id = v_owner_id::text and provider = 'manual_asset';

  insert into public.account_balances (
    id, owner_id, financial_account_id, connection_id, provider, provider_account_id,
    currency_code, current_balance_cents, available_balance_cents, as_of
  ) values (
    'account_balance_' || p_valuation_id, v_owner_id, p_asset_id, 'manual_assets',
    'manual_asset', p_asset_id, 'USD', p_value_cents, null, p_value_date::timestamptz
  )
  on conflict (owner_id, financial_account_id, as_of) do update
    set current_balance_cents = excluded.current_balance_cents;

  return v_asset;
end;
$function$;


create or replace function public.deactivate_financial_asset(p_asset_id text)
 returns financial_assets
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_owner_id uuid := public.resolve_effective_owner_id()::uuid;
  v_asset public.financial_assets;
begin
  if v_owner_id is null then raise exception 'Authenticated owner is required.'; end if;

  update public.financial_assets
  set active = false, updated_at = now()
  where id = p_asset_id and owner_id = v_owner_id and active = true
  returning * into v_asset;

  if v_asset.id is null then raise exception 'Active asset was not found.'; end if;

  update public.financial_accounts
  set active = false, updated_at = now()
  where id = p_asset_id and owner_id = v_owner_id::text and provider = 'manual_asset';

  return v_asset;
end;
$function$;


create or replace function public.create_investment_account_with_valuation(p_id text, p_name text, p_institution_name text, p_account_type text, p_tax_treatment text, p_ownership_scope text, p_notes text, p_valuation_id text, p_value_cents bigint, p_value_date date, p_value_source text)
 returns investment_accounts
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_owner_id uuid := public.resolve_effective_owner_id()::uuid;
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
$function$;


create or replace function public.update_investment_account_with_valuation(p_account_id text, p_name text, p_institution_name text, p_account_type text, p_tax_treatment text, p_ownership_scope text, p_notes text, p_valuation_id text, p_value_cents bigint, p_value_date date, p_value_source text)
 returns investment_accounts
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_owner_id uuid := public.resolve_effective_owner_id()::uuid;
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
$function$;


create or replace function public.deactivate_investment_account(p_account_id text)
 returns investment_accounts
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_owner_id uuid := public.resolve_effective_owner_id()::uuid;
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
$function$;
