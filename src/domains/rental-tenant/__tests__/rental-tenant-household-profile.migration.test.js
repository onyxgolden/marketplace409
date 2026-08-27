import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync("supabase/migrations/20260830000100_add_rental_tenant_household_profiles.sql", "utf8").toLowerCase();
describe("rental tenant household profile migration", () => {
  it("stores useful application fields but never a full SSN", () => {
    expect(sql).toContain("ssn_last_four");
    expect(sql).toContain("^[0-9]{4}$");
    expect(sql).not.toMatch(/add column if not exists (social_security_number|ssn)\s/);
  });
  it("creates one explicit primary tenant role per lease", () => {
    expect(sql).toContain("occupancy_role");
    expect(sql).toContain("where occupancy_role = 'primary'");
    expect(sql).toContain("set_rental_primary_tenant");
    expect(sql).toContain("has_workspace_access");
  });
});
