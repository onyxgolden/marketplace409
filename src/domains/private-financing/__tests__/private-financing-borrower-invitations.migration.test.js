import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";
const sql=readFileSync(resolve(process.cwd(),"supabase/migrations/20260831000100_add_private_financing_borrower_invitations.sql"),"utf8").toLowerCase().replace(/\s+/g," ");
describe("private financing borrower invitations migration",()=>{
  it("authorizes only seller workspace actors and never accepts a borrower auth id",()=>{expect(sql).toContain("not has_workspace_access(p_owner_id)");expect(sql).not.toMatch(/p_auth_user_id|p_user_id/);});
  it("creates an account-scoped invited membership",()=>{expect(sql).toContain("insert into private_financing_account_borrowers");expect(sql).toContain("p_account_id,v_borrower.id,p_role,'invited'");});
  it("matches registration only by normalized auth email",()=>{expect(sql).toContain("from auth.users u where lower(u.email)=v_email");});
  it("preserves the confirmed-email claim boundary",()=>{expect(sql).not.toContain("status='active'");expect(sql).not.toContain("auth_user_id = v_auth_user");});
});
