import { describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path";
const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20261101210000_rental_schedule_pet_fee.sql"), "utf8");

describe("schedule pet fee migration", () => {
  it("adds pet_fee_cents to rent_schedules, default 0, never negative", () => {
    expect(sql).toContain("add column if not exists pet_fee_cents bigint not null default 0");
    expect(sql).toContain("check (pet_fee_cents >= 0)");
  });
  it("refuses a fee above the monthly total at the database", () => {
    expect(sql).toContain("rent_schedules_pet_fee_le_amount_check");
    expect(sql).toContain("check (pet_fee_cents <= amount_cents)");
  });
  it("redefines update_lease_terms with a nullable pet-fee parameter that keeps the current value when omitted", () => {
    expect(sql).toContain("p_pet_fee_cents bigint default null");
    expect(sql).toContain("pet_fee_cents = coalesce(p_pet_fee_cents, pet_fee_cents)");
    expect(sql).toContain("pet fee cannot exceed the monthly total");
  });
  it("drops the old 8-arg overload first so no stale signature survives", () => {
    expect(sql).toContain("drop function if exists update_lease_terms(text, text, bigint, integer, date, date, integer, date);");
  });
  it("returns the fee in the schedule JSON and keeps the authenticated grant", () => {
    expect(sql).toContain("amount_cents, pet_fee_cents, due_day");
    expect(sql).toContain("grant execute on function update_lease_terms(text, text, bigint, integer, date, date, integer, date, bigint) to authenticated;");
  });
});
