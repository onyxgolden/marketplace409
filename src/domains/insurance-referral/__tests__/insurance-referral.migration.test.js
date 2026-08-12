import{describe,expect,it}from"vitest";import fs from"node:fs";import path from"node:path";
const sql=fs.readFileSync(path.join(process.cwd(),"supabase/migrations/20260812001300_create_insurance_referral_links.sql"),"utf8");
describe("insurance referrals",()=>{
  it("stores outbound links and compensation disclosure",()=>{expect(sql).toContain("outbound_url");expect(sql).toContain("referral_compensation_possible");expect(sql).toContain("disclosure_text");});
  it("explicitly excludes premium collection",()=>expect(sql).toContain("does not quote, bind, sell, service, or collect premiums"));
  it("exposes only active links to tenants",()=>expect(sql).toContain("using(active=true)"));
});
