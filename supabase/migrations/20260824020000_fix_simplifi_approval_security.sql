-- Restores the reviewed Simplifi approval path after
-- 20260824010000_harden_financial_events_trusted_source_provenance.sql limited direct
-- authenticated writes to manual financial events. The approval function already authenticates
-- auth.uid(), requires it to match p_owner_id, validates every row, and hardcodes the trusted
-- source_system. Run only that function with elevated table access; keep the hardened RLS policies
-- unchanged.

alter function approve_simplifi_csv_import(text, text, text, text, jsonb)
    security definer;

alter function approve_simplifi_csv_import(text, text, text, text, jsonb)
    set search_path = public;

alter function approve_simplifi_csv_import(text, text, text, text, jsonb)
    set row_security = off;
