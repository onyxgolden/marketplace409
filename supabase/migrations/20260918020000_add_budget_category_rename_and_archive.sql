-- Adds edit (rename) and delete (archive) for budget_categories, the two write operations the
-- 2026-09-18 budgeting foundation migration didn't cover. Mirrors that migration's exact
-- conventions (SECURITY DEFINER, has_workspace_access(owner_id) as the only authorization
-- boundary, owner-scoped lookups). Archiving rather than hard-deleting: a category's monthly
-- allocation history (budget_monthly_allocations) stays intact for any past month even after the
-- category is removed from the active budget view, consistent with this app's other
-- insert-preferring/soft-delete conventions (e.g. Private Financing's immutable ledger).

create or replace function rename_budget_category(
    p_owner_id text,
    p_category_id text,
    p_display_label text
)
returns budget_categories
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    v_authenticated_user uuid := auth.uid();
    v_row public.budget_categories%rowtype;
begin
    if v_authenticated_user is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;
    if not has_workspace_access(p_owner_id) then
        raise exception 'Owner does not match authenticated workspace.' using errcode = '42501';
    end if;
    if p_display_label is null or length(trim(p_display_label)) = 0 then
        raise exception 'display_label is required.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.budget_categories where owner_id = p_owner_id and id = p_category_id) then
        raise exception 'Unknown budget category for this owner.' using errcode = 'P0002';
    end if;

    update public.budget_categories
       set display_label = p_display_label, updated_by = v_authenticated_user::text, updated_at = now()
     where owner_id = p_owner_id and id = p_category_id
    returning * into v_row;

    return v_row;
end;
$$;

revoke all on function rename_budget_category(text, text, text) from public;
grant execute on function rename_budget_category(text, text, text) to authenticated;

create or replace function archive_budget_category(
    p_owner_id text,
    p_category_id text
)
returns budget_categories
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    v_authenticated_user uuid := auth.uid();
    v_row public.budget_categories%rowtype;
begin
    if v_authenticated_user is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;
    if not has_workspace_access(p_owner_id) then
        raise exception 'Owner does not match authenticated workspace.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.budget_categories where owner_id = p_owner_id and id = p_category_id) then
        raise exception 'Unknown budget category for this owner.' using errcode = 'P0002';
    end if;

    update public.budget_categories
       set is_archived = true, updated_by = v_authenticated_user::text, updated_at = now()
     where owner_id = p_owner_id and id = p_category_id
    returning * into v_row;

    return v_row;
end;
$$;

revoke all on function archive_budget_category(text, text) from public;
grant execute on function archive_budget_category(text, text) to authenticated;
