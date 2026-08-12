import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260812001600_claim_rental_tenant_portal.sql"), "utf8")
  .toLowerCase().replace(/\s+/g, " ");
describe("rental tenant portal claim RPC", () => {
  it("binds only the authenticated user's verified email", () => {
    expect(sql).toContain("authenticated_user_id uuid := auth.uid()");
    expect(sql).toContain("from auth.users users where users.id = authenticated_user_id");
    expect(sql).toContain("confirmed_at is null");
    expect(sql).not.toContain("auth.jwt()");
    expect(sql).toContain("lower(email) = authenticated_email");
  });
  it("refuses ambiguous invitations and never accepts caller-supplied identity", () => {
    expect(sql).toContain("if matching_count > 1");
    expect(sql).toContain("multiple tenant invitations match this email");
    expect(sql).toContain("create or replace function claim_rental_tenant_portal()");
  });
  it("activates the invitation before granting self-service RLS access", () => {
    expect(sql).toContain("set auth_user_id = authenticated_user_id, status = 'active'");
    expect(sql).toContain("grant execute on function claim_rental_tenant_portal() to authenticated");
  });
});
