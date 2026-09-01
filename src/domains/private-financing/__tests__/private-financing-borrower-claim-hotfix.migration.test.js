import fs from "node:fs"; import path from "node:path"; import { describe, expect, it } from "vitest";
const sql=fs.readFileSync(path.join(process.cwd(),"supabase/migrations/20260901000500_harden_private_financing_borrower_claim.sql"),"utf8").toLowerCase().replace(/\s+/g," ");
describe("private financing borrower claim hotfix",()=>{
  it("serializes claims and normalizes the canonical authenticated email",()=>{expect(sql).toContain("pg_advisory_xact_lock");expect(sql).toContain("lower(nullif(btrim(coalesce(users.email, auth.jwt()->>'email'))");});
  it("retains confirmed-email and exact authenticated-user protections",()=>{expect(sql).toContain("email_confirmed is null");expect(sql).toContain("auth_user_id is null or auth_user_id = authenticated_user_id");});
  it("activates only invited memberships owned by the claimed identity",()=>{expect(sql).toContain("b.auth_user_id = authenticated_user_id");expect(sql).toContain("m.status = 'invited'");});
});
