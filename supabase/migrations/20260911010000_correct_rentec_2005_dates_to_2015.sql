-- Corrects the event_date of exactly two production financial_events rows imported with a
-- manually-mistyped year of 2005 (source_system = 'rentec', historical CSV backfill, imported
-- 2026-07-15). Root-cause investigation (this PR, and the deployment doc it produced) proved 2005
-- is impossible for either row: "Tools (TEMU)" cannot predate TEMU's ~2022 US launch, and this
-- household's own Rentec ledger has no real activity anywhere before 2014 -- these two rows, at
-- source_record_id sequence 0 and 1, are literally the first two rows of the entire historical
-- import file. One of the two preserves its raw, uncorrected source value in metadata.rawRow.DATE:
-- "11/17/0005" -- a year that is numerically 5, not a real year, most plausibly a 2-digit "15"
-- (2015) that lost its leading digit before the import ever ran. Jason confirmed directly: he and
-- his wife did not begin using the source application (Rentec) until 2014, these were manual
-- year-entry mistakes on both transactions, and the intended year for both is 2015. The month and
-- day components were never in question and are preserved unchanged; only the year is corrected.
--
-- Targeted by source_record_id ONLY -- these two exact, immutable Rentec CSV row identifiers --
-- never by amount, description, or date, so this can never touch any other row even if a new,
-- superficially similar transaction (another "Tools (TEMU)" or "Utilities (VERIZON WIRELESS)" line)
-- is imported later with its own, different source_record_id.
--
-- Fail-closed (revised after review): before touching either row, this verifies BOTH rows exist,
-- are active (status='active', is_deleted=false), and still match every piece of identifying
-- evidence actually reviewed and approved (amount, source_system, description, normalized_category,
-- transaction_kind, property_id) -- "provider" in this rentec-sourced context is source_system,
-- since these rows carry no separate metadata.provider key. If any of this has drifted since the
-- review (a different amount, a changed description, a deleted row, a missing row), the migration
-- raises an exception and makes no change at all, rather than silently applying a correction to
-- something that is no longer provably the record that was reviewed.
--
-- Idempotent: each row's event_date is checked against BOTH the known pre-correction value and this
-- migration's own corrected value. A second run recognizes the already-corrected state (event_date
-- already at target AND metadata.dateRepair.migrationId already stamped by this exact migration)
-- and no-ops for that row -- changing nothing, including the audit record's own repairedAt
-- timestamp, which must never appear to re-fire on a later run. Any OTHER event_date (neither the
-- reviewed original nor this migration's own target) also fails closed, since that would mean the
-- row was altered by something else since the review.
--
-- Auditable (added after review): each corrected row's metadata gains a `dateRepair` object
-- recording the original date, the corrected date, why, which migration did it, a repair version,
-- and when -- preserved forever alongside the row, not just in this migration file's own history.
do $$
declare
  v_row_1 record;
  v_row_2 record;
  v_migration_id text := '20260911010000_correct_rentec_2005_dates_to_2015';
  v_repair_version integer := 1;
  v_repair_reason text := 'manually entered year predates use of the source application';
begin
  select id, event_date, amount, source_system, description, normalized_category, transaction_kind,
    property_id, status, is_deleted, metadata
  into v_row_1
  from financial_events
  where source_record_id = 'rentec-2005-01-25-1-expense';

  if not found then
    raise exception 'rentec 2005->2015 date repair: expected row source_record_id=rentec-2005-01-25-1-expense not found -- stopping without making any change.';
  end if;

  select id, event_date, amount, source_system, description, normalized_category, transaction_kind,
    property_id, status, is_deleted, metadata
  into v_row_2
  from financial_events
  where source_record_id = 'rentec-0005-11-17-0-expense';

  if not found then
    raise exception 'rentec 2005->2015 date repair: expected row source_record_id=rentec-0005-11-17-0-expense not found -- stopping without making any change.';
  end if;

  if v_row_1.status <> 'active' or v_row_1.is_deleted then
    raise exception 'rentec 2005->2015 date repair: row % is not an active record (status=%, is_deleted=%) -- stopping without making any change.',
      v_row_1.id, v_row_1.status, v_row_1.is_deleted;
  end if;

  if v_row_2.status <> 'active' or v_row_2.is_deleted then
    raise exception 'rentec 2005->2015 date repair: row % is not an active record (status=%, is_deleted=%) -- stopping without making any change.',
      v_row_2.id, v_row_2.status, v_row_2.is_deleted;
  end if;

  if v_row_1.amount <> 87.76
    or v_row_1.source_system <> 'rentec'
    or v_row_1.description <> 'Tools (TEMU)'
    or v_row_1.normalized_category <> 'tools'
    or v_row_1.transaction_kind <> 'expense'
    or v_row_1.property_id <> 'business-expenses'
  then
    raise exception 'rentec 2005->2015 date repair: row % no longer matches the reviewed evidence (amount=%, source_system=%, description=%, category=%, kind=%, property=%) -- stopping without making any change.',
      v_row_1.id, v_row_1.amount, v_row_1.source_system, v_row_1.description, v_row_1.normalized_category, v_row_1.transaction_kind, v_row_1.property_id;
  end if;

  if v_row_2.amount <> 97.23
    or v_row_2.source_system <> 'rentec'
    or v_row_2.description <> 'Utilities (VERIZON WIRELESS)'
    or v_row_2.normalized_category <> 'utilities'
    or v_row_2.transaction_kind <> 'expense'
    or v_row_2.property_id <> 'business-expenses'
  then
    raise exception 'rentec 2005->2015 date repair: row % no longer matches the reviewed evidence (amount=%, source_system=%, description=%, category=%, kind=%, property=%) -- stopping without making any change.',
      v_row_2.id, v_row_2.amount, v_row_2.source_system, v_row_2.description, v_row_2.normalized_category, v_row_2.transaction_kind, v_row_2.property_id;
  end if;

  if v_row_1.event_date = date '2005-01-25' then
    update financial_events
    set
      event_date = date '2015-01-25',
      metadata = metadata || jsonb_build_object(
        'dateRepair', jsonb_build_object(
          'version', v_repair_version,
          'migrationId', v_migration_id,
          'reason', v_repair_reason,
          'originalEventDate', '2005-01-25',
          'correctedEventDate', '2015-01-25',
          'repairedAt', now()
        )
      ),
      updated_at = now(),
      updated_by = 'system:' || v_migration_id
    where id = v_row_1.id;
  elsif v_row_1.event_date = date '2015-01-25'
    and v_row_1.metadata->'dateRepair'->>'migrationId' = v_migration_id
  then
    raise notice 'rentec 2005->2015 date repair: row % already corrected by this migration -- no change.', v_row_1.id;
  else
    raise exception 'rentec 2005->2015 date repair: row % has an unexpected event_date (%) that is neither the reviewed original (2005-01-25) nor this migration''s own corrected date (2015-01-25) -- stopping without making any change.',
      v_row_1.id, v_row_1.event_date;
  end if;

  if v_row_2.event_date = date '2005-11-17' then
    update financial_events
    set
      event_date = date '2015-11-17',
      metadata = metadata || jsonb_build_object(
        'dateRepair', jsonb_build_object(
          'version', v_repair_version,
          'migrationId', v_migration_id,
          'reason', v_repair_reason,
          'originalEventDate', '2005-11-17',
          'correctedEventDate', '2015-11-17',
          'repairedAt', now()
        )
      ),
      updated_at = now(),
      updated_by = 'system:' || v_migration_id
    where id = v_row_2.id;
  elsif v_row_2.event_date = date '2015-11-17'
    and v_row_2.metadata->'dateRepair'->>'migrationId' = v_migration_id
  then
    raise notice 'rentec 2005->2015 date repair: row % already corrected by this migration -- no change.', v_row_2.id;
  else
    raise exception 'rentec 2005->2015 date repair: row % has an unexpected event_date (%) that is neither the reviewed original (2005-11-17) nor this migration''s own corrected date (2015-11-17) -- stopping without making any change.',
      v_row_2.id, v_row_2.event_date;
  end if;
end $$;
