import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261108000000_rental_billing_audit_insert_policies.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

// Regression test for the live 2026-11-08 bug: clicking "Activate FORGE billing" failed with
// "new row violates row level security policy for the table
// rent_schedule_collection_cutover_audit". The activation RPC is SECURITY INVOKER and runs as
// `authenticated`, but the audit table had RLS + FORCE RLS with a SELECT policy only — no
// INSERT policy — so the audit row the RPC writes on every call was denied and the whole
// activation failed. The same SELECT-only gap blocked the other four owner settings RPCs,
// which upsert rental_billing_settings and insert one audit row each.
//
// This test pins the fix at the migration-text level, the same way the repo's other RLS
// migration tests do (see add-rent-schedule-collection-authority.migration.test.js and
// schedule-pet-fee.migration.test.js). A live PostgreSQL 16 behavioral check (scratch
// cluster, stubbed auth.uid()/has_workspace_access()) was also run during development:
// with these policies an authenticated owner can insert an audit row for their own workspace
// and gets 42501 inserting one for another workspace, and the
// INSERT ... ON CONFLICT DO UPDATE on rental_billing_settings succeeds for the owner and
// fails for anyone else. Without them, every one of those writes is denied — the bug.

const auditInsertPolicies = [
  {
    table: "rent_schedule_collection_cutover_audit",
    policy: "rent_schedule_cutover_audit_owner_insert",
    writer: "activate_forge_billing_collection()",
  },
  {
    table: "rental_billing_settings_audit",
    policy: "rental_billing_settings_audit_owner_insert",
    writer: "set_rental_billing_enabled()",
  },
  {
    table: "rental_late_fee_settings_audit",
    policy: "late_fee_settings_audit_owner_insert",
    writer: "set_rental_late_fee_auto_settings()",
  },
  {
    table: "rental_payment_policy_audit",
    policy: "payment_policy_audit_owner_insert",
    writer: "set_rental_payment_policy()",
  },
  {
    table: "rental_convenience_fee_audit",
    policy: "convenience_fee_audit_owner_insert",
    writer: "set_rental_card_convenience_fee()",
  },
];

describe("rental billing audit insert policies migration", () => {
  it.each(auditInsertPolicies)(
    "adds an owner-scoped INSERT policy on $table (written by $writer)",
    ({ table, policy }) => {
      expect(sql).toContain(`create policy "${policy}" on ${table}`);
      expect(sql).toContain(`"${policy}" on ${table} for insert to authenticated`);
      // The WITH CHECK must be the workspace-access check on the row's owner — never a
      // permissive `true`, and never keyed on the caller-supplied performed_by.
      const policyBlock = sql.slice(sql.indexOf(`"${policy}"`));
      expect(policyBlock).toContain("with check (has_workspace_access(owner_id))");
      expect(policyBlock).not.toContain("with check (true)");
    },
  );

  it("adds an owner-scoped INSERT policy on rental_billing_settings for the RPC upserts", () => {
    expect(sql).toContain('create policy "rental_billing_settings_owner_insert" on rental_billing_settings');
    expect(sql).toContain('"rental_billing_settings_owner_insert" on rental_billing_settings for insert to authenticated');
    expect(sql).toContain("with check (has_workspace_access(owner_id))");
  });

  it("adds an owner-scoped UPDATE policy on rental_billing_settings for the ON CONFLICT leg", () => {
    // INSERT ... ON CONFLICT DO UPDATE checks the UPDATE policy (USING + WITH CHECK) for the
    // conflict leg, so an INSERT policy alone would still leave every settings save denied
    // on the second call for the same owner.
    expect(sql).toContain('create policy "rental_billing_settings_owner_update" on rental_billing_settings');
    expect(sql).toContain('"rental_billing_settings_owner_update" on rental_billing_settings for update to authenticated');
    expect(sql).toContain("using (has_workspace_access(owner_id))");
    const updateBlock = sql.slice(sql.indexOf('"rental_billing_settings_owner_update"'));
    expect(updateBlock).toContain("with check (has_workspace_access(owner_id))");
    expect(updateBlock).not.toContain("using (true)");
  });

  it("does not widen access: no policy grants anon, service_role, public, or an unconditional check", () => {
    expect(sql).not.toMatch(/for (insert|update|select|all|delete) to (anon|service_role|public)\b/);
    expect(sql).not.toContain("with check (true)");
    expect(sql).not.toContain("using (true)");
  });

  it("does not flip any RPC to SECURITY DEFINER — the invoker + explicit owner-check design stands", () => {
    expect(sql).not.toContain("security definer");
  });

  it("only adds policies: no table, function, or existing-policy changes ride along", () => {
    expect(sql).not.toContain("create table");
    expect(sql).not.toContain("create or replace function");
    expect(sql).not.toContain("alter table");
    expect(sql).not.toContain("drop table");
    // The existing SELECT policies are untouched — the only DROP POLICY lines name the new
    // policies themselves (idempotency for re-runs).
    const drops = sql.match(/drop policy if exists "[^"]+"/g) || [];
    expect(drops.length).toBeGreaterThan(0);
    for (const drop of drops) {
      expect(drop).not.toMatch(/owner_select|tenant_select|owner_all/);
    }
  });
});
