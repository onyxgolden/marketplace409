-- Adds a free-text note per budget category (e.g. "renews in March", "call to negotiate rate") --
-- persistent per-category, not per-month, since it's an annotation about the line itself rather
-- than a specific month's allocation. Mirrors rename_budget_category's exact shape/conventions.

alter table budget_categories add column if not exists note text;

create or replace function update_budget_category_note(
    p_owner_id text,
    p_category_id text,
    p_note text
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
       -- An empty/whitespace-only note clears it back to null rather than storing "".
       set note = nullif(trim(coalesce(p_note, '')), ''), updated_by = v_authenticated_user::text, updated_at = now()
     where owner_id = p_owner_id and id = p_category_id
    returning * into v_row;

    return v_row;
end;
$$;

revoke all on function update_budget_category_note(text, text, text) from public;
grant execute on function update_budget_category_note(text, text, text) to authenticated;
