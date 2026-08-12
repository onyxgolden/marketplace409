import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260812001700_reject_pre_effective_rent_charges.sql"), "utf8")
  .toLowerCase().replace(/\s+/g, " ");
describe("pre-effective rent charge guard", () => {
  it("voids only unpaid charges whose due date precedes the schedule", () => {
    expect(sql).toContain("charge.due_date < schedule.effective_start_date");
    expect(sql).toContain("charge.paid_amount_cents = 0");
    expect(sql).toContain("charge.status not in ('paid', 'void')");
    expect(sql).toContain("status = 'void', voided_at = now()");
  });
  it("prevents future generation before the effective date", () => {
    expect(sql).toContain("if required_due_date < schedule.effective_start_date");
    expect(sql).not.toContain("date_trunc('month', required_due_date)");
  });
  it("does not return a previously voided source-key charge", () => {
    expect(sql).toContain("source_key = required_source_key and status <> 'void'");
  });
});
