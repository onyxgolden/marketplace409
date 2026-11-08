-- Rental billing write policies: unblock the owner flows that were denied by SELECT-only RLS.
--
-- BUG (verified live 2026-11-08): clicking "Activate FORGE billing" on a lease fails with
-- "new row violates row level security policy for the table
-- rent_schedule_collection_cutover_audit", and the schedule stays 'external'. The activation RPC
-- activate_forge_billing_collection() is SECURITY INVOKER and runs as the `authenticated` role,
-- and rent_schedule_collection_cutover_audit has RLS + FORCE RLS with exactly ONE policy — a
-- SELECT policy. There is no INSERT policy, so the audit row the RPC writes on every call
-- (including the idempotent no-op path) is denied, and the whole activation fails.
--
-- The same SELECT-only gap blocks the other four owner settings RPCs, which share the exact
-- shape (SECURITY INVOKER, called via the authenticated client, upsert rental_billing_settings
-- and insert one audit row):
--   set_rental_billing_enabled()          -> rental_billing_settings (upsert) + rental_billing_settings_audit
--   set_rental_late_fee_auto_settings()   -> rental_billing_settings (upsert) + rental_late_fee_settings_audit
--   set_rental_payment_policy()           -> rental_billing_settings (upsert) + rental_payment_policy_audit
--   set_rental_card_convenience_fee()     -> rental_billing_settings (upsert) + rental_convenience_fee_audit
-- All five RPCs enforce owner access themselves (auth.uid() + has_workspace_access(p_owner_id))
-- before writing, so the policies below add the missing RLS permission without widening who can
-- write: an owner can insert/update only rows in workspaces they have access to.
--
-- WHY POLICIES AND NOT A DEFINER FUNCTION: the codebase deliberately runs these RPCs as SECURITY
-- INVOKER with explicit owner checks (see 20260822010000 and the 20260829 workspace-access
-- conversion), and the established pattern for authenticated writes is an owner-scoped INSERT
-- policy with `with check (has_workspace_access(owner_id))` (e.g.
-- rentec_transaction_imports_owner_insert). Flipping the RPCs to run as DEFINER would bypass
-- RLS entirely and drop the defense-in-depth the invoker design provides. This migration keeps
-- that design and adds only the missing permissions.
--
-- rental_billing_settings needs BOTH an INSERT and an UPDATE policy: the RPCs write it with
-- INSERT ... ON CONFLICT DO UPDATE, and Postgres checks the INSERT policy (WITH CHECK) for the
-- insert leg and the UPDATE policy (USING + WITH CHECK) for the conflict leg.
--
-- IDEMPOTENCY: every policy below is created only if pg_policies shows it missing, so a
-- re-run — including a run against a database where one of these policies was already applied
-- by hand (the cutover-audit INSERT policy was applied live 2026-11-08 before this migration
-- landed) — is a pure no-op for the policies that already exist. Nothing is ever dropped.
--
-- No policy is added for any table no user flow writes to (health_audit_log is written only by
-- a DEFINER trigger; mfa_audit_log belongs to the auth-recovery subsystem). No
-- function, table, or existing policy is changed here.

-- 1. Cutover audit: written by activate_forge_billing_collection() on every activation.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rent_schedule_collection_cutover_audit'
      AND policyname = 'rent_schedule_cutover_audit_owner_insert'
  ) THEN
    CREATE POLICY "rent_schedule_cutover_audit_owner_insert" ON rent_schedule_collection_cutover_audit
      FOR INSERT TO authenticated
      WITH CHECK (has_workspace_access(owner_id));
  END IF;
END $$;

-- 2. Master-pause audit: written by set_rental_billing_enabled() on every call.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rental_billing_settings_audit'
      AND policyname = 'rental_billing_settings_audit_owner_insert'
  ) THEN
    CREATE POLICY "rental_billing_settings_audit_owner_insert" ON rental_billing_settings_audit
      FOR INSERT TO authenticated
      WITH CHECK (has_workspace_access(owner_id));
  END IF;
END $$;

-- 3. Late-fee settings audit: written by set_rental_late_fee_auto_settings() on every call.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rental_late_fee_settings_audit'
      AND policyname = 'late_fee_settings_audit_owner_insert'
  ) THEN
    CREATE POLICY "late_fee_settings_audit_owner_insert" ON rental_late_fee_settings_audit
      FOR INSERT TO authenticated
      WITH CHECK (has_workspace_access(owner_id));
  END IF;
END $$;

-- 4. Payment-policy audit: written by set_rental_payment_policy() on every call.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rental_payment_policy_audit'
      AND policyname = 'payment_policy_audit_owner_insert'
  ) THEN
    CREATE POLICY "payment_policy_audit_owner_insert" ON rental_payment_policy_audit
      FOR INSERT TO authenticated
      WITH CHECK (has_workspace_access(owner_id));
  END IF;
END $$;

-- 5. Convenience-fee audit: written by set_rental_card_convenience_fee() on every call.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rental_convenience_fee_audit'
      AND policyname = 'convenience_fee_audit_owner_insert'
  ) THEN
    CREATE POLICY "convenience_fee_audit_owner_insert" ON rental_convenience_fee_audit
      FOR INSERT TO authenticated
      WITH CHECK (has_workspace_access(owner_id));
  END IF;
END $$;

-- 6. Billing settings: upserted by all five RPCs above. INSERT covers the insert leg of
-- INSERT ... ON CONFLICT DO UPDATE; UPDATE covers the conflict leg.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rental_billing_settings'
      AND policyname = 'rental_billing_settings_owner_insert'
  ) THEN
    CREATE POLICY "rental_billing_settings_owner_insert" ON rental_billing_settings
      FOR INSERT TO authenticated
      WITH CHECK (has_workspace_access(owner_id));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rental_billing_settings'
      AND policyname = 'rental_billing_settings_owner_update'
  ) THEN
    CREATE POLICY "rental_billing_settings_owner_update" ON rental_billing_settings
      FOR UPDATE TO authenticated
      USING (has_workspace_access(owner_id))
      WITH CHECK (has_workspace_access(owner_id));
  END IF;
END $$;
