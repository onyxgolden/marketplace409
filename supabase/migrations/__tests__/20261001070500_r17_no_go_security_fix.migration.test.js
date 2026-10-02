// Static contract test for 20261001070500_r17_no_go_security_fix.sql (NO-GO fix, PR #522).
//
// Verifies the migration SQL text establishes the security invariants ChatGPT's 2026-10-01
// NO-GO verdict required, without needing a live database:
//   Finding 1 (CRITICAL): has_workspace_access() must be reverted to the privileged model
//     (owner + active co_owner) — the DB write boundary must not include all staff.
//   Finding 1: has_workspace_visibility() (read boundary) and has_rental_permission()
//     (DB-enforced permission predicate) must exist, with team.manage never granted to staff.
//   Finding 2: update_workspace_member's override catalog must exclude team.manage.
//   Finding 1: additive staff write policies must exist for the permission-gated tables.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../20261001070500_r17_no_go_security_fix.sql"
);
const sql = fs.readFileSync(migrationPath, "utf8");

describe("NO-GO fix migration contract (20261001070500)", () => {
  it("reverts has_workspace_access() to the privileged model (owner + active co_owner)", () => {
    // The reverted definition must contain the co_owner role filter.
    const revertBlock = sql.match(
      /create or replace function public\.has_workspace_access\(p_owner_id text\)[\s\S]*?\$\$;/
    );
    expect(revertBlock).not.toBeNull();
    expect(revertBlock[0]).toMatch(/role\s*=\s*'co_owner'/);
    // And it must NOT be the widened R17 version (no role filter).
    expect(revertBlock[0]).not.toMatch(/status\s*=\s*'active'\s*\n\s*\);/);
  });

  it("defines has_workspace_visibility() as owner OR any active member", () => {
    expect(sql).toMatch(/create or replace function public\.has_workspace_visibility\(p_owner_id text\)/);
    const visibilityBlock = sql.match(
      /create or replace function public\.has_workspace_visibility\(p_owner_id text\)[\s\S]*?\$\$;/
    );
    expect(visibilityBlock[0]).toMatch(/member_user_id\s*=\s*auth\.uid\(\)/);
    // No co_owner restriction — any active member gets visibility.
    expect(visibilityBlock[0]).not.toMatch(/role\s*=\s*'co_owner'/);
  });

  it("defines has_rental_permission() with deny-by-default and no team.manage for staff", () => {
    expect(sql).toMatch(/create or replace function public\.has_rental_permission\(p_owner_id text, p_permission_key text\)/);
    // Primary owner implicit full access.
    expect(sql).toMatch(/p_owner_id\s*=\s*auth\.uid\(\)::text/);
    // Co-owner full access.
    expect(sql).toMatch(/if v_role = 'co_owner' then\s*\n\s*return true;/);
    // team.manage never granted to staff.
    expect(sql).toMatch(/if p_permission_key = 'team\.manage' then\s*\n\s*return false;/);
  });

  it("removes team.manage from update_workspace_member's staff-overridable catalog", () => {
    const fnBlock = sql.match(
      /create or replace function public\.update_workspace_member\([\s\S]*?\n\$\$;\n/
    );
    expect(fnBlock).not.toBeNull();
    // The valid_permissions array must not contain team.manage.
    const arrayBlock = fnBlock[0].match(/valid_permissions text\[\] := array\[[\s\S]*?\];/);
    expect(arrayBlock).not.toBeNull();
    expect(arrayBlock[0]).not.toMatch(/'team\.manage'/);
    // Belt-and-braces: explicit rejection of team.manage=true on non-co_owner.
    expect(fnBlock[0]).toMatch(/team\.manage can only be held by the primary owner or a co-owner/);
  });

  it("adds additive staff SELECT (visibility) policies for rental tables", () => {
    // Spot-check a few core tables; the generator covers all 52.
    for (const table of ["rental_tenants", "rental_leases", "rental_units", "rental_vendor_bills"]) {
      expect(sql).toMatch(
        new RegExp(`create policy "rental_staff_visibility_select" on ${table} for select[\\s\\S]*?has_workspace_visibility\\(owner_id\\)`)
      );
    }
  });

  it("adds DB-enforced staff WRITE policies for the 9 gated routes' tables", () => {
    // financial_events: payments.record / transfers.record / vendor_payments.record.
    expect(sql).toMatch(/create policy "financial_events_staff_insert"[\s\S]*?has_rental_permission\(owner_id, 'payments\.record'\)/);
    expect(sql).toMatch(/create policy "financial_events_staff_insert"[\s\S]*?has_rental_permission\(owner_id, 'transfers\.record'\)/);
    // vendor bills: vendor_bills.manage.
    expect(sql).toMatch(/create policy "rental_vendor_bills_staff_write"[\s\S]*?has_rental_permission\(owner_id, 'vendor_bills\.manage'\)/);
    // vendor payments: vendor_payments.record.
    expect(sql).toMatch(/create policy "rental_vendor_payments_staff_insert"[\s\S]*?has_rental_permission\(owner_id, 'vendor_payments\.record'\)/);
    // maintenance work orders: maintenance.manage.
    expect(sql).toMatch(/create policy "rental_maintenance_work_orders_staff_write"[\s\S]*?has_rental_permission\(owner_id, 'maintenance\.manage'\)/);
  });

  it("updates the SECURITY DEFINER messaging RPCs to enforce the permission predicate", () => {
    // send_rental_conversation_owner_message: staff need messages.send.
    expect(sql).toMatch(
      /create or replace function send_rental_conversation_owner_message[\s\S]*?has_rental_permission\(v_owner_id, 'messages\.send'\)/
    );
    // send_rental_work_order_owner_message: staff need maintenance.manage or messages.send.
    expect(sql).toMatch(
      /create or replace function send_rental_work_order_owner_message[\s\S]*?has_rental_permission\(v_owner_id, 'maintenance\.manage'\)/
    );
  });

  it("is additive: drops no existing policy", () => {
    // The only DROP POLICY statements should be the idempotent "drop if exists" guards
    // for the NEW policies this migration creates (safe re-runs).
    const drops = [...sql.matchAll(/drop policy if exists "([^"]+)" on (\w+);/gi)];
    expect(drops.length).toBeGreaterThan(0);
    for (const [, policyName] of drops) {
      expect(policyName).toMatch(/(_staff_|_visibility_)/);
    }
  });
});
