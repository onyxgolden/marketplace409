-- Fixes a bug in approve_rentec_financial_history_import() (20260823000000): the row-validation
-- query selected x.reason, but "reason" is a column produced by the `reasons` lateral subquery
-- alias, not by `x` (the jsonb_to_recordset alias) — every real call failed immediately with
-- "column x.reason does not exist" (Postgres 42703), before ever reaching the insert. Confirmed via
-- Vercel function logs: every approval attempt in Production hit this error; zero financial_events
-- rows and zero audit-batch rows were ever written by this function. No data is affected — this is a
-- pure fix, changing only the one column reference (x.reason -> reasons.reason). Everything else
-- (validation rules, insert shape, idempotency via financial_events' own unique index, audit-summary
-- write, security invoker, grants) is unchanged from the original migration.
--
-- NOT applied remotely by this change — local migration file only.

create or replace function approve_rentec_financial_history_import(
    p_owner_id text,
    p_import_batch_id text,
    p_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
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

    -- Fail closed on the whole batch if any row is structurally invalid, rather than silently
    -- dropping a malformed row — a malformed row here means the caller (app layer) has a bug, and
    -- that should surface loudly rather than partially import.
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
