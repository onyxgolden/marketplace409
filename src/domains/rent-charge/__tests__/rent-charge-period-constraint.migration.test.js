import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260812001500_fix_rent_charge_period_constraint.sql"), "utf8")
  .toLowerCase().replace(/\s+/g, " ");
describe("rent charge period constraint repair", () => {
  it("replaces the over-escaped constraint with an unambiguous numeric pattern", () => {
    expect(sql).toContain("drop constraint if exists rent_charges_period_check");
    expect(sql).toContain("add constraint rent_charges_period_check");
    expect(sql).toContain("period ~ '^[0-9]{4}-[0-9]{2}$'");
    expect(sql).not.toContain("\\\\d");
  });
});
