import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static contract check for the Rentec-parity R17/R18 atomic un-void RPC
// migration: the bill reopen and the audit append happen in one SECURITY
// DEFINER transaction, authorized narrowly via has_rental_permission —
// never two separate requests, never broad staff workspace writes.
const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261001071000_unvoid_vendor_bill_atomic_rpc.sql"),
  "utf8",
);
const lower = sql.toLowerCase();

describe("atomic un-void RPC migration contract (20261001071000)", () => {
  it("defines unvoid_vendor_bill as SECURITY DEFINER with a fixed search_path", () => {
    expect(lower).toContain("create or replace function public.unvoid_vendor_bill(");
    expect(lower).toContain("security definer");
    expect(lower).toContain("set search_path = public");
  });

  it("authorizes narrowly via has_rental_permission(vendor_bills.manage)", () => {
    expect(lower).toContain("has_rental_permission(p_owner_id, 'vendor_bills.manage')");
    // Must NOT restore broad staff workspace writes.
    expect(lower).not.toMatch(/has_workspace_access\s*\(\s*p_owner_id\s*\)\s*or\s*true/);
  });

  it("guards the write: only a voided, untouched bill is reopened", () => {
    expect(lower).toContain("and status = 'voided'");
    expect(lower).toContain("and paid_amount_cents = 0");
  });

  it("appends the rental_void_audits row in the same transaction", () => {
    expect(lower).toContain("insert into rental_void_audits");
    expect(lower).toContain("'vendor_bill'");
    expect(lower).toContain("'unvoid'");
  });

  it("requires an authenticated caller and a non-empty reason", () => {
    expect(lower).toContain("auth.uid()");
    expect(lower).toContain("a reason is required to un-void a bill");
  });

  it("is executable by authenticated only, never anon or public", () => {
    expect(lower).toContain("revoke all on function public.unvoid_vendor_bill(text, text, text) from public, anon");
    expect(lower).toContain("grant execute on function public.unvoid_vendor_bill(text, text, text) to authenticated");
  });
});
