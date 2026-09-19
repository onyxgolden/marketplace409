-- Brain slice 6: conversational actions behind the CONFIRM gate.
--
-- 1. categorize_financial_event: the category-only write path for Brain's
--    conversational actions ("categorize ... as ...", "apply suggestion").
--    The existing reclassify_transaction_financial_event whitelist only covers
--    transfer/distribution/debt categories, so it cannot write a plain expense
--    category like "groceries". This RPC writes any sane category slug while
--    leaving transaction_kind and amount untouched. Only unresolved rows
--    (normalized_category 'other'/null) can be categorized, and any row can be
--    un-categorized back to 'other' -- every write is reversible.
--
-- 2. dismissed_brain_alerts: owner-scoped dismissal records for anomaly
--    alerts, keyed by the Brain's deterministic alertKeyOf() so a dismissed
--    alert stays dismissed across recomputations.

create or replace function categorize_financial_event(
    p_owner_id text,
    p_event_id text,
    p_normalized_category text
)
returns financial_events
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    v_authenticated_user uuid := auth.uid();
    v_current_category text;
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
    -- Category-only write: a slug, not free text. The transfer/distribution/debt
    -- categories keep going through reclassify_transaction_financial_event.
    if p_normalized_category is null
        or p_normalized_category !~ '^[a-z0-9_]{1,64}$'
        or p_normalized_category in ('internal_transfer', 'owner_distribution', 'heloc_payment', 'mortgage_payment', 'loan_payment') then
        raise exception 'Unrecognized normalized_category for categorization: %', p_normalized_category using errcode = '22023';
    end if;

    select normalized_category into v_current_category
      from public.financial_events
     where id = p_event_id
       and owner_id = p_owner_id
       and source_system = 'transaction'
       and is_deleted = false;

    if not found then
        raise exception 'Unknown financial event for this owner.' using errcode = 'P0002';
    end if;
    -- Only blank rows can be filled in; any row can be blanked again. This is
    -- what keeps every conversational categorize reversible and prevents the
    -- Brain from clobbering a human's (or a previous apply's) decided category.
    if coalesce(v_current_category, 'other') <> 'other' and p_normalized_category <> 'other' then
        raise exception 'Only uncategorized events can be categorized through this function.' using errcode = '22023';
    end if;

    update public.financial_events
       set normalized_category = p_normalized_category,
           updated_by = v_authenticated_user::text,
           updated_at = now()
     where id = p_event_id and owner_id = p_owner_id
    returning * into v_row;

    return v_row;
end;
$$;

revoke all on function categorize_financial_event(text, text, text) from public;
grant execute on function categorize_financial_event(text, text, text) to authenticated;

create table if not exists dismissed_brain_alerts (
    owner_id text not null,
    alert_key text not null,
    dismissed_at timestamptz not null default now(),
    primary key (owner_id, alert_key)
);

create index if not exists
    idx_dismissed_brain_alerts_owner
on dismissed_brain_alerts(owner_id);

alter table dismissed_brain_alerts enable row level security;

alter table dismissed_brain_alerts force row level security;

create policy "dismissed_brain_alerts_owner_select"
on dismissed_brain_alerts
for select
to authenticated
using (
    owner_id = auth.uid()::text
);

create policy "dismissed_brain_alerts_owner_insert"
on dismissed_brain_alerts
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
);

create policy "dismissed_brain_alerts_owner_delete"
on dismissed_brain_alerts
for delete
to authenticated
using (
    owner_id = auth.uid()::text
);
