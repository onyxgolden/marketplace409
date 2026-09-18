-- Personal budgeting foundation: two owner-scoped tables (budget_categories,
-- budget_monthly_allocations) plus two SECURITY DEFINER RPCs to write them. Reads a category's
-- actual spend by joining against the existing financial_events table at query time (via
-- SupabaseFinancialEventRepository.findExpenseEventsSince) -- this migration owns no actuals data
-- of its own. Mirrors 20260830000200_create_private_financing_foundation.sql's conventions:
-- text/text composite primary keys, server-generated ids inside guarded RPCs (never
-- client-supplied), text + CHECK for enumerated values, has_workspace_access(owner_id) as the
-- only authorization boundary.
--
-- linked_source_type/linked_source_id on budget_categories are nullable and written by NO logic in
-- this migration or its application layer -- they exist only so a later feature (auto-populating a
-- budget line from a Private Financing loan payment or a Rental Manager lease, already planned)
-- can attach a category to its real FORGE source without a further schema migration.

create table if not exists budget_categories (
    owner_id text not null,
    id text not null,
    normalized_category text not null,
    display_label text not null,
    business_scope text not null check (business_scope in ('personal', 'business')) default 'personal',
    source_type text not null check (source_type in ('manual', 'history_suggested', 'forge_linked')) default 'manual',
    linked_source_type text,
    linked_source_id text,
    is_archived boolean not null default false,
    created_by text,
    updated_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    unique (owner_id, normalized_category, business_scope)
);

create table if not exists budget_monthly_allocations (
    owner_id text not null,
    id text not null,
    category_id text not null,
    -- Always the 1st of the month -- enforced by the check below and by the RPC normalizing via
    -- date_trunc('month', ...) before every insert/update, never trusted verbatim from a caller.
    period_month date not null,
    planned_amount_cents bigint not null check (planned_amount_cents >= 0 and planned_amount_cents < 100000000000),
    created_by text,
    updated_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    foreign key (owner_id, category_id) references budget_categories (owner_id, id) on delete cascade,
    unique (owner_id, category_id, period_month),
    check (period_month = date_trunc('month', period_month)::date)
);

alter table budget_categories enable row level security;
alter table budget_monthly_allocations enable row level security;

create policy "budget_categories_owner_all" on budget_categories
    for all to authenticated
    using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

create policy "budget_monthly_allocations_owner_all" on budget_monthly_allocations
    for all to authenticated
    using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

-- Idempotent by (owner_id, normalized_category, business_scope): a second call for a category that
-- already exists updates its display_label/un-archives it rather than raising a uniqueness error,
-- since the UI's "add a suggested category" action and a later "rename/restore" action both go
-- through this same entry point.
create or replace function upsert_budget_category(
    p_owner_id text,
    p_normalized_category text,
    p_display_label text,
    p_business_scope text default 'personal',
    p_source_type text default 'manual'
)
returns budget_categories
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    v_authenticated_user uuid := auth.uid();
    v_category_id text;
    v_row public.budget_categories%rowtype;
begin
    if v_authenticated_user is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;
    if not has_workspace_access(p_owner_id) then
        raise exception 'Owner does not match authenticated workspace.' using errcode = '42501';
    end if;
    if p_business_scope not in ('personal', 'business') then
        raise exception 'Unrecognized business_scope: %', p_business_scope using errcode = '22023';
    end if;
    if p_source_type not in ('manual', 'history_suggested', 'forge_linked') then
        raise exception 'Unrecognized source_type: %', p_source_type using errcode = '22023';
    end if;
    if p_normalized_category is null or length(trim(p_normalized_category)) = 0 then
        raise exception 'normalized_category is required.' using errcode = '22023';
    end if;
    if p_display_label is null or length(trim(p_display_label)) = 0 then
        raise exception 'display_label is required.' using errcode = '22023';
    end if;

    select id into v_category_id
      from public.budget_categories
     where owner_id = p_owner_id and normalized_category = p_normalized_category and business_scope = p_business_scope;

    if v_category_id is not null then
        update public.budget_categories
           set display_label = p_display_label, is_archived = false, updated_by = v_authenticated_user::text, updated_at = now()
         where owner_id = p_owner_id and id = v_category_id
        returning * into v_row;
        return v_row;
    end if;

    v_category_id := 'budget_cat_' || gen_random_uuid()::text;

    insert into public.budget_categories (
        owner_id, id, normalized_category, display_label, business_scope, source_type, created_by, updated_by
    ) values (
        p_owner_id, v_category_id, p_normalized_category, p_display_label, p_business_scope, p_source_type,
        v_authenticated_user::text, v_authenticated_user::text
    ) returning * into v_row;

    return v_row;
end;
$$;

revoke all on function upsert_budget_category(text, text, text, text, text) from public;
grant execute on function upsert_budget_category(text, text, text, text, text) to authenticated;

-- Idempotent by (owner_id, category_id, period_month): re-saving the same month's amount updates
-- the existing allocation rather than raising a uniqueness error.
create or replace function upsert_budget_monthly_allocation(
    p_owner_id text,
    p_category_id text,
    p_period_month date,
    p_planned_amount_cents bigint
)
returns budget_monthly_allocations
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    v_authenticated_user uuid := auth.uid();
    v_normalized_month date;
    v_allocation_id text;
    v_row public.budget_monthly_allocations%rowtype;
begin
    if v_authenticated_user is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;
    if not has_workspace_access(p_owner_id) then
        raise exception 'Owner does not match authenticated workspace.' using errcode = '42501';
    end if;
    if p_planned_amount_cents is null or p_planned_amount_cents < 0 then
        raise exception 'planned_amount_cents must be a non-negative integer.' using errcode = '22023';
    end if;
    if p_period_month is null then
        raise exception 'period_month is required.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.budget_categories where owner_id = p_owner_id and id = p_category_id) then
        raise exception 'Unknown budget category for this owner.' using errcode = 'P0002';
    end if;

    v_normalized_month := date_trunc('month', p_period_month)::date;

    select id into v_allocation_id
      from public.budget_monthly_allocations
     where owner_id = p_owner_id and category_id = p_category_id and period_month = v_normalized_month;

    if v_allocation_id is not null then
        update public.budget_monthly_allocations
           set planned_amount_cents = p_planned_amount_cents, updated_by = v_authenticated_user::text, updated_at = now()
         where owner_id = p_owner_id and id = v_allocation_id
        returning * into v_row;
        return v_row;
    end if;

    v_allocation_id := 'budget_alloc_' || gen_random_uuid()::text;

    insert into public.budget_monthly_allocations (
        owner_id, id, category_id, period_month, planned_amount_cents, created_by, updated_by
    ) values (
        p_owner_id, v_allocation_id, p_category_id, v_normalized_month, p_planned_amount_cents,
        v_authenticated_user::text, v_authenticated_user::text
    ) returning * into v_row;

    return v_row;
end;
$$;

revoke all on function upsert_budget_monthly_allocation(text, text, date, bigint) from public;
grant execute on function upsert_budget_monthly_allocation(text, text, date, bigint) to authenticated;
