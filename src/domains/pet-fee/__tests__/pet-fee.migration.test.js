import{describe,expect,it}from"vitest";import fs from"node:fs";import path from"node:path";
const sql=fs.readFileSync(path.join(process.cwd(),"supabase/migrations/20260812001200_create_monthly_pet_fees.sql"),"utf8");
describe("monthly pet fee persistence",()=>{
  it("requires individual landlord approval evidence",()=>{expect(sql).toContain("approval_status <> 'approved'");expect(sql).toContain("approval_evidence_id");});
  it("creates one recurring fee per animal",()=>expect(sql).toContain("unique(owner_id,animal_id)"));
  it("generates idempotent monthly charges only for approved animals",()=>{expect(sql).toContain("Landlord pet approval is required.");expect(sql).toContain("on conflict(owner_id,source_key) do nothing");});
});
