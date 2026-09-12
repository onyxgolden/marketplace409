-- Corrects the event_date of exactly two production financial_events rows imported with a
-- manually-mistyped year of 2005 (source_system = 'rentec', historical CSV backfill, imported
-- 2026-07-15). Root-cause investigation (this PR, and the deployment doc it produced) proved 2005
-- is impossible for either row: "Tools (TEMU)" cannot predate TEMU's ~2022 US launch, and this
-- household's own Rentec ledger has no real activity anywhere before 2014 -- these two rows, at
-- source_record_id sequence 0 and 1, are literally the first two rows of the entire historical
-- import file. One of the two preserves its raw, uncorrected source value in metadata.rawRow.DATE:
-- "11/17/0005" -- a year that is numerically 5, not a real year, most plausibly a 2-digit "15"
-- (2015) that lost its leading digit before the import ever ran. Jason confirmed on 2026-09-11 that
-- his wife mistyped the year while entering these two transactions, and that the intended year for
-- both is 2015. The month and day components were never in question and are preserved unchanged;
-- only the year is corrected.
--
-- Targeted by source_record_id ONLY -- these two exact, immutable Rentec CSV row identifiers --
-- never by amount, description, or date, so this can never touch any other row even if a new,
-- superficially similar transaction (another "Tools (TEMU)" or "Utilities (VERIZON WIRELESS)" line)
-- is imported later with its own, different source_record_id.
--
-- Idempotent: the WHERE clause requires the CURRENT event_date to still differ from the corrected
-- target, so re-running this migration after it has already applied finds zero matching rows and
-- changes nothing. No other column is touched -- amount, description, category, and every other
-- field are exactly as originally imported.
update financial_events
set
  event_date = case source_record_id
    when 'rentec-2005-01-25-1-expense' then date '2015-01-25'
    when 'rentec-0005-11-17-0-expense' then date '2015-11-17'
  end,
  updated_at = now(),
  updated_by = 'system:rentec-2005-to-2015-date-correction-2026-09-11'
where source_record_id in ('rentec-2005-01-25-1-expense', 'rentec-0005-11-17-0-expense')
  and source_system = 'rentec'
  and status = 'active'
  and is_deleted = false
  and event_date <> case source_record_id
    when 'rentec-2005-01-25-1-expense' then date '2015-01-25'
    when 'rentec-0005-11-17-0-expense' then date '2015-11-17'
  end;
