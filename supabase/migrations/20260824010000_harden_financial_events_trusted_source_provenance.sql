-- Closes a real (if not previously exploited) provenance gap: financial_events_owner_insert had
-- no restriction on source_system, so any authenticated owner could INSERT a row directly through
-- the Supabase client claiming source_system = 'rentec_api' (or 'rentec', or the FORGE-payment
-- sources) without that data ever actually coming from Rentec or a real payment. This was not a
-- privilege escalation relative to what the owner could already do to their OWN financial_events
-- rows in general, but it meant Rentec/FORGE provenance was a convention, not something the
-- database actually enforced.
--
-- Every "trusted, automated" source_system already has (or, after this migration, has) a
-- SECURITY DEFINER write path that performs its own full validation and sets row_security = off,
-- so it never depended on the owner-scoped RLS policies in the first place:
--   - "forge_rental_payment" / "forge_rental_payment_adjustment" — both already SECURITY DEFINER
--     triggers (post_succeeded_rental_payment_to_financial_event,
--     reconcile_rental_payment_reversal), unaffected by this migration.
--   - "rentec_api" — approve_rentec_financial_history_import() was SECURITY INVOKER, meaning its
--     own insert relied on financial_events_owner_insert exactly like a raw client insert would.
--     Promoted to SECURITY DEFINER here; every check it already performed (authenticated owner
--     matches p_owner_id, every row's shape/semantics, hardcoded source_system) is unchanged and
--     already made it safe to elevate — this migration does not touch its logic, only its
--     security context.
--   - "rentec" — the one-time historical CSV bulk import has no live application write path at
--     all (confirmed by grep); it was loaded directly against the database outside RLS. Nothing
--     currently running depends on owner-scoped client inserts for this source.
--   - "manual" — the one source_system genuinely meant to be written by the owner directly, via
--     /api/rental/manual-financial-event. Remains fully owner-writable; this is the only value the
--     tightened policies below still allow through the plain authenticated role.
--
-- The owner-scoped UPDATE and DELETE policies are tightened the same way, not just INSERT: an
-- unrestricted UPDATE would otherwise let an owner silently retag an existing 'manual' row's
-- source_system to 'rentec_api' after the fact (or edit the amount/description of a real,
-- already-imported Rentec/FORGE-payment row), which would defeat the INSERT restriction entirely.
-- After this migration, only 'manual' rows are the owner's to insert, update, or delete directly;
-- everything else can only ever be written by a SECURITY DEFINER function/trigger that performs
-- its own validation, matching the pattern already established for the two payment triggers.

drop policy if exists "financial_events_owner_insert" on financial_events;
create policy "financial_events_owner_insert"
on financial_events
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
    and source_system = 'manual'
);

drop policy if exists "financial_events_owner_update" on financial_events;
create policy "financial_events_owner_update"
on financial_events
for update
to authenticated
using (
    owner_id = auth.uid()::text
    and source_system = 'manual'
)
with check (
    owner_id = auth.uid()::text
    and source_system = 'manual'
);

drop policy if exists "financial_events_owner_delete" on financial_events;
create policy "financial_events_owner_delete"
on financial_events
for delete
to authenticated
using (
    owner_id = auth.uid()::text
    and source_system = 'manual'
);

create or replace function approve_rentec_financial_history_import(
    p_owner_id text,
    p_import_batch_id text,
    p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    authenticated_owner_id text := auth.uid()::text;
    v_requested_count integer;
    v_inserted_count integer;
    v_skipped_count integer;
    v_batch_row_id text;
    v_invalid_reason text;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or p_owner_id <> authenticated_owner_id then
        raise exception 'Rentec financial history import owner does not match authenticated owner.' using errcode = '42501';
    end if;
    if p_import_batch_id is null or btrim(p_import_batch_id) = '' then
        raise exception 'An import batch id is required.' using errcode = '22023';
    end if;
    if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
        raise exception 'At least one row is required.' using errcode = '22023';
    end if;
    if jsonb_array_length(p_rows) > 1000 then
        raise exception 'Approve at most 1000 rows per batch.' using errcode = '22023';
    end if;

    v_requested_count := jsonb_array_length(p_rows);

    select reasons.reason into v_invalid_reason
    from jsonb_to_recordset(p_rows) as x(
        property_id text, event_date date, description text, amount numeric,
        transaction_kind text, normalized_category text,
        tax_deductible boolean, affects_noi boolean, capitalized boolean,
        source_record_id text, metadata jsonb
    )
    cross join lateral (
        select case
            when x.event_date is null then 'event_date is required'
            when x.description is null or btrim(x.description) = '' then 'description is required'
            when x.amount is null or x.amount <= 0 then 'amount must be a positive number'
            when x.transaction_kind is null or x.transaction_kind not in
                ('income', 'expense', 'asset_purchase', 'asset_sale', 'liability_payment', 'transfer')
                then 'transaction_kind is not a recognized value'
            when x.normalized_category is null or btrim(x.normalized_category) = '' then 'normalized_category is required'
            when x.source_record_id is null or btrim(x.source_record_id) = '' then 'source_record_id is required'
            else null
        end as reason
    ) reasons
    where reasons.reason is not null
    limit 1;

    if v_invalid_reason is not null then
        raise exception 'Invalid Rentec financial history row: %', v_invalid_reason using errcode = '22023';
    end if;

    with inserted as (
        insert into financial_events (
            owner_id, property_id, event_date, description, amount,
            transaction_kind, normalized_category,
            tax_deductible, affects_noi, capitalized,
            source_system, source_record_id, metadata,
            status, created_by, updated_by
        )
        select
            p_owner_id, x.property_id, x.event_date, x.description, x.amount,
            x.transaction_kind, x.normalized_category,
            coalesce(x.tax_deductible, false), coalesce(x.affects_noi, false), coalesce(x.capitalized, false),
            'rentec_api', x.source_record_id, coalesce(x.metadata, '{}'::jsonb),
            'active', authenticated_owner_id, authenticated_owner_id
        from jsonb_to_recordset(p_rows) as x(
            property_id text, event_date date, description text, amount numeric,
            transaction_kind text, normalized_category text,
            tax_deductible boolean, affects_noi boolean, capitalized boolean,
            source_record_id text, metadata jsonb
        )
        on conflict (owner_id, source_system, source_record_id) where source_record_id is not null do nothing
        returning id
    )
    select count(*) into v_inserted_count from inserted;

    v_skipped_count := v_requested_count - v_inserted_count;

    v_batch_row_id := 'rentec_fin_hist_batch_' || gen_random_uuid()::text;
    insert into rentec_financial_history_import_batches
      (id, owner_id, import_batch_id, requested_count, inserted_count, skipped_count, approved_by)
    values (v_batch_row_id, p_owner_id, p_import_batch_id, v_requested_count, v_inserted_count, v_skipped_count, authenticated_owner_id);

    return jsonb_build_object(
        'status', 'applied',
        'batchRowId', v_batch_row_id,
        'importBatchId', p_import_batch_id,
        'requestedCount', v_requested_count,
        'insertedCount', v_inserted_count,
        'skippedCount', v_skipped_count
    );
end;
$$;

revoke all on function approve_rentec_financial_history_import(text, text, jsonb) from public;
grant execute on function approve_rentec_financial_history_import(text, text, jsonb) to authenticated;
