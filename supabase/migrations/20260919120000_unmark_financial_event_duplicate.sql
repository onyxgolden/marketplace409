-- UX slice 2 (demote CONFIRM): the undo path for duplicate exclusion.
--
-- unmark_financial_event_as_duplicate reverses mark_financial_event_as_duplicate
-- (20260918040000): it clears duplicate_of_event_id and restores the soft-deleted
-- row (is_deleted = false, deleted_at = null, set together to satisfy the
-- table's deleted-state CHECK constraint). Only rows currently marked as
-- duplicates for this owner can be unmarked -- a row that was never marked is
-- rejected rather than silently "succeeding", and non-transaction sources are
-- never eligible, mirroring the mark function's defense in depth.
--
-- Purely additive: no existing rows are touched by this migration itself.

create or replace function unmark_financial_event_as_duplicate(
    p_owner_id text,
    p_event_id text
)
returns financial_events
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    v_authenticated_user uuid := auth.uid();
    v_event_source_system text;
    v_marked_target text;
    v_row public.financial_events%rowtype;
begin
    if v_authenticated_user is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or p_owner_id <> v_authenticated_user::text then
        raise exception 'Owner does not match authenticated workspace.' using errcode = '42501';
    end if;
    if p_event_id is null or btrim(p_event_id) = '' then
        raise exception 'event_id is required.' using errcode = '22023';
    end if;

    select source_system, duplicate_of_event_id into v_event_source_system, v_marked_target
      from public.financial_events
     where id = p_event_id
       and owner_id = p_owner_id;

    if not found then
        raise exception 'Unknown financial event for this owner.' using errcode = 'P0002';
    end if;
    if v_event_source_system <> 'transaction' then
        raise exception 'Only transaction-sourced events can be unmarked through this function.' using errcode = '22023';
    end if;
    if v_marked_target is null then
        raise exception 'This event is not marked as a duplicate.' using errcode = '22023';
    end if;

    update public.financial_events
       set is_deleted = false,
           deleted_at = null,
           duplicate_of_event_id = null,
           updated_by = v_authenticated_user::text,
           updated_at = now()
     where id = p_event_id and owner_id = p_owner_id
    returning * into v_row;

    return v_row;
end;
$$;

revoke all on function unmark_financial_event_as_duplicate(text, text) from public;
grant execute on function unmark_financial_event_as_duplicate(text, text) to authenticated;
