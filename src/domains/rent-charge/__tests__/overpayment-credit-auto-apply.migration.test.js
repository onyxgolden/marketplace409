import { describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path";
const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20261101220000_rental_overpayment_credit_auto_apply.sql"), "utf8");

describe("overpayment credit auto-apply migration", () => {
  it("creates the service-role auto-apply function", () => {
    expect(sql).toContain("create or replace function apply_overpayment_credits_to_charge(");
    expect(sql).toContain("p_owner_id text");
    expect(sql).toContain("p_charge_id text");
  });
  it("applies overpayment-sourced credits only, never manual ones", () => {
    expect(sql).toContain("and source = 'overpayment'");
    expect(sql).not.toMatch(/source = 'manual'/);
  });
  it("uses FIFO order with LEAST math and the established application conventions", () => {
    expect(sql).toContain("order by created_at asc, id asc");
    expect(sql).toContain("least(v_credit.remaining_cents, v_charge_remaining)");
    expect(sql).toContain("'rental_credit_application_' || gen_random_uuid()::text");
    expect(sql).toContain("'Auto-applied to generated charge ' || v_charge.period");
  });
  it("locks the charge before the credits and re-derives both statuses", () => {
    const chargeLock = sql.indexOf("from rent_charges");
    const creditLock = sql.indexOf("from rental_tenant_credits");
    expect(chargeLock).toBeGreaterThan(-1);
    expect(creditLock).toBeGreaterThan(chargeLock);
    expect(sql).toContain("case when v_new_credit_remaining = 0 then 'fully_applied' else 'open' end");
    expect(sql).toContain("case when v_charge_remaining = 0 then 'paid' else 'partially_paid' end");
  });
  it("refuses void charges and returns a no-op summary for paid ones", () => {
    expect(sql).toContain("Rent charge is not payable.");
    expect(sql).toContain("if v_charge.status = 'paid' then");
  });
  it("is executable by service_role only, never by public or anon", () => {
    expect(sql).toContain("revoke all on function apply_overpayment_credits_to_charge(text, text) from public;");
    expect(sql).toContain("grant execute on function apply_overpayment_credits_to_charge(text, text) to service_role;");
    expect(sql).not.toContain("to authenticated");
  });
});
