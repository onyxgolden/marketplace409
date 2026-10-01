import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static contract check for the R21 transactional application-decision RPC
// (PR #526 CHANGES fix): the function must lock the application row, enforce
// owner/co-owner authorization internally, perform all five writes in one
// transaction, and use the P0001/42501/23505 error contract the route maps to
// 409/403.
const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261001140000_decide_rental_application.sql"),
  "utf8",
);
const lower = sql.toLowerCase();

describe("decide_rental_application RPC migration", () => {
  it("creates a security-definer RPC with the expected signature", () => {
    expect(lower).toContain("create or replace function public.decide_rental_application(");
    expect(lower).toContain("security definer");
    expect(lower).toContain("returns jsonb");
    for (const param of ["p_owner_id", "p_application_id", "p_action", "p_reason",
      "p_tenant_display_name", "p_tenant_email", "p_lease_start_date",
      "p_monthly_rent_cents", "p_rent_due_day"]) {
      expect(lower).toContain(param);
    }
  });

  it("serializes concurrent decisions with a row lock and pending re-check", () => {
    expect(lower).toMatch(/from rental_applications[\s\S]*?for update/);
    expect(lower).toContain("only a pending application can be decided");
    expect(lower).toContain("errcode = 'p0001'");
  });

  it("enforces owner/co-owner authorization inside the RPC", () => {
    expect(lower).toContain("auth.uid()");
    expect(lower).toContain("has_workspace_access(p_owner_id)");
    expect(lower).toContain("errcode = '42501'");
  });

  it("performs all decision writes atomically, including the audit row", () => {
    expect(lower).toContain("insert into rental_tenants");
    expect(lower).toContain("insert into rental_leases");
    expect(lower).toContain("insert into rental_lease_tenants");
    expect(lower).toMatch(/update rental_applications[\s\S]*?status = 'approved'/);
    expect(lower).toMatch(/update rental_applications[\s\S]*?status = 'denied'/);
    expect(lower).toContain("insert into rental_application_decisions");
    // Deny path requires the reason (stored on the audit row).
    expect(lower).toContain("a denial reason is required");
    // Duplicate applicant email surfaces as 23505 via unique(owner_id, email).
    expect(lower).toContain("23505");
  });

  it("grants execute narrowly: authenticated only, never anon", () => {
    expect(lower).toMatch(/grant execute on function public\.decide_rental_application\([\s\S]*?\) to authenticated/);
    expect(lower).toMatch(/revoke all on function public\.decide_rental_application\([\s\S]*?\) from public, anon/);
  });
});
