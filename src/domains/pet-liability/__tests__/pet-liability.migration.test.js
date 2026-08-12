import { describe, expect, it } from "vitest"; import fs from "node:fs"; import path from "node:path";
const sql=fs.readFileSync(path.join(process.cwd(),"supabase/migrations/20260812001100_create_pet_liability_compliance.sql"),"utf8");
describe("pet liability persistence",()=>{
  it("keeps animal classification separate from insurer risk",()=>{expect(sql).toContain("classification text");expect(sql).toContain("insurer_risk_flag boolean");});
  it("requires human review for assistance requests",()=>expect(sql).toContain("human_review_required"));
  it("verifies bite, property, exclusion, and evidence fields",()=>{expect(sql).toContain("bodily_injury_covered");expect(sql).toContain("breed_exclusion_confirmed_absent");expect(sql).toContain("landlord_additional_insured");});
});
