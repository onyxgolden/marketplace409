import { describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path";
const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260812000900_record_offline_rental_payment.sql"), "utf8");
describe("offline rental payment migration", () => {
  it("supports only evidenced cash and cashier's check payments", () => {
    expect(sql).toContain("('cash','cashiers_check')"); expect(sql).toContain("receipt_reference"); expect(sql).toContain("recorded_by");
  });
  it("locks and atomically updates the rent charge", () => {
    expect(sql).toMatch(/rent_charges[\s\S]*for update/i); expect(sql).toContain("paid_amount_cents = v_new_paid");
  });
  it("refuses overpayment", () => { expect(sql).toContain("Payment exceeds the remaining rent balance."); });
});
