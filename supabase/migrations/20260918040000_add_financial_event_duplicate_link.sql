-- Purely additive: a nullable self-referencing link so a `financial_events` row can record which
-- other row it's a confirmed duplicate of, once a human (via the reconcile-duplicates feature)
-- explicitly applies that decision. Nothing in this migration marks any row as a duplicate -- that
-- only ever happens through mark_financial_event_as_duplicate(), called from the owner-triggered
-- apply action, never automatically and never inside a migration.
--
-- No RLS policy changes needed: the existing owner-scoped UPDATE policy
-- (financial_events_owner_update, added in 20260824010000) already restricts direct client updates
-- to source_system = 'manual' rows only. A 'transaction'-sourced row (the only kind this feature
-- marks) can only be updated through a SECURITY DEFINER function, exactly like
-- approve_rentec_financial_history_import already does for 'rentec_api' inserts -- this migration
-- follows that same established pattern rather than loosening RLS.

alter table financial_events
    add column if not exists duplicate_of_event_id text references financial_events(id);

create index if not exists idx_financial_events_duplicate_of
    on financial_events(duplicate_of_event_id)
    where duplicate_of_event_id is not null;

-- Marks one 'transaction'-sourced row as a confirmed duplicate of one rentec/rentec_api-sourced
-- row: soft-deletes the transaction row (is_deleted + deleted_at, matching the table's existing
-- deleted-state CHECK constraint) and links it via duplicate_of_event_id. The rentec/rentec_api row
-- itself is never modified -- it stays the canonical record. Idempotent: calling this again on an
-- already-marked row with the same target is a no-op success, not an error, so the owner-triggered
-- apply action can safely re-run.
create or replace function mark_financial_event_as_duplicate(
    p_owner_id text,
    p_event_id text,
    p_duplicate_of_event_id text
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
    v_canonical_source_system text;
    v_already_marked_target text;
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
    if p_duplicate_of_event_id is null or btrim(p_duplicate_of_event_id) = '' then
        raise exception 'duplicate_of_event_id is required.' using errcode = '22023';
    end if;
    if p_event_id = p_duplicate_of_event_id then
        raise exception 'An event cannot be marked as a duplicate of itself.' using errcode = '22023';
    end if;

    select source_system, duplicate_of_event_id into v_event_source_system, v_already_marked_target
      from public.financial_events
     where id = p_event_id and owner_id = p_owner_id;

    if not found then
        raise exception 'Unknown financial event for this owner.' using errcode = 'P0002';
    end if;
    -- Defense in depth: this apply path only ever touches the raw bank-feed source. Rentec,
    -- manual, or any other source_system is never eligible to be soft-deleted through this
    -- function, no matter what a caller passes.
    if v_event_source_system <> 'transaction' then
        raise exception 'Only transaction-sourced events can be marked as a duplicate through this function.' using errcode = '22023';
    end if;

    -- Idempotent short-circuit: already marked as a duplicate of exactly this target -- return the
    -- current row unchanged rather than erroring on a safe re-run.
    if v_already_marked_target = p_duplicate_of_event_id then
        select * into v_row from public.financial_events where id = p_event_id and owner_id = p_owner_id;
        return v_row;
    end if;
    if v_already_marked_target is not null and v_already_marked_target <> p_duplicate_of_event_id then
        raise exception 'This event is already marked as a duplicate of a different event.' using errcode = '22023';
    end if;

    select source_system into v_canonical_source_system
      from public.financial_events
     where id = p_duplicate_of_event_id and owner_id = p_owner_id;

    if not found then
        raise exception 'Unknown duplicate_of_event_id for this owner.' using errcode = 'P0002';
    end if;
    if v_canonical_source_system not in ('rentec', 'rentec_api') then
        raise exception 'duplicate_of_event_id must reference a rentec or rentec_api sourced event.' using errcode = '22023';
    end if;

    update public.financial_events
       set is_deleted = true,
           deleted_at = now(),
           duplicate_of_event_id = p_duplicate_of_event_id,
           updated_by = v_authenticated_user::text,
           updated_at = now()
     where id = p_event_id and owner_id = p_owner_id
    returning * into v_row;

    return v_row;
end;
$$;

revoke all on function mark_financial_event_as_duplicate(text, text, text) from public;
grant execute on function mark_financial_event_as_duplicate(text, text, text) to authenticated;
