import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260820001000_void_rental_rent_charge.sql"), "utf8")
  .toLowerCase().replace(/\s+/g, " ");
describe("void rental rent charge RPC", () => {
  it("uses authenticated owner authority", () => {
    expect(sql).toContain("security invoker");
    expect(sql).toContain("p_owner_id <> authenticated_owner_id");
    expect(sql).not.toContain("security definer");
  });
  it("requires a charge id and a non-blank reason", () => {
    expect(sql).toContain("nullif(btrim(p_charge_id), '')");
    expect(sql).toContain("nullif(btrim(p_reason), '')");
  });
  it("only voids an unpaid, not-already-void charge, without ever deleting the row", () => {
    expect(sql).toContain("update rent_charges");
    expect(sql).toContain("and paid_amount_cents = 0");
    expect(sql).toContain("and status <> 'void'");
    expect(sql).not.toContain("delete from rent_charges");
  });
  it("preserves the original amount, period, due date, lease, and schedule (never assigns them)", () => {
    expect(sql).not.toContain("set amount_cents");
    expect(sql).not.toContain("period =");
    expect(sql).not.toContain("due_date =");
    expect(sql).not.toContain("lease_id =");
    expect(sql).not.toContain("schedule_id =");
  });
  it("sets voided_at and records the reason in notes without discarding any existing notes", () => {
    expect(sql).toContain("status = 'void'");
    expect(sql).toContain("voided_at = now()");
    expect(sql).toContain("concat_ws(' ', nullif(btrim(notes), ''), 'voided: ' || required_reason)");
  });
  it("limits execution to authenticated callers", () => {
    expect(sql).toContain("revoke all on function void_rental_rent_charge");
    expect(sql).toContain("grant execute on function void_rental_rent_charge");
    expect(sql).toContain("to authenticated");
  });
});
