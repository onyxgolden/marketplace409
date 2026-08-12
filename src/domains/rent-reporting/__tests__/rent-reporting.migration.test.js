import { describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path";
const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260812000800_create_rent_reporting_enrollments.sql"), "utf8");
describe("rent reporting persistence", () => {
  it("keeps reporting enrollment and fees separate from rent", () => {
    expect(sql).toContain("create table if not exists rent_reporting_enrollments");
    expect(sql).toContain("create table if not exists rent_reporting_fees");
  });
  it("retains consent and furnisher evidence", () => {
    expect(sql).toContain("consent_text_version text not null"); expect(sql).toContain("furnisher_name text not null");
  });
  it("allows tenants to read only reporting tied to their lease", () => {
    expect(sql).toContain("rental_actor_has_lease_access(owner_id, lease_id)");
  });
});
