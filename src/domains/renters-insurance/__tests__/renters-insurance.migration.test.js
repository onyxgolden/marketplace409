import { describe, expect, it } from "vitest"; import fs from "node:fs"; import path from "node:path";
const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260812001000_create_renters_insurance_compliance.sql"), "utf8");
describe("renters insurance persistence", () => {
  it("separates lease requirements from policy evidence", () => { expect(sql).toContain("renters_insurance_requirements"); expect(sql).toContain("renters_insurance_policies"); });
  it("tracks Texas jurisdiction and referral compensation explicitly", () => { expect(sql).toContain("jurisdiction_code"); expect(sql).toContain("referral_compensation_enabled"); });
  it("requires evidence for verified coverage", () => { expect(sql).toContain("status <> 'verified'"); expect(sql).toContain("provider_verification_id"); });
});
