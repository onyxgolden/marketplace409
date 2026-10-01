import { describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path";
const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20261001021000_rental_payment_policies.sql"), "utf8");
describe("R11 payment policies migration", () => {
  it("adds a portfolio-level policy defaulting to allow_any_amount", () => {
    expect(sql).toContain("alter table rental_billing_settings");
    expect(sql).toContain("payment_policy text not null default 'allow_any_amount'");
    expect(sql).toContain("('allow_any_amount', 'require_rent', 'require_balance')");
  });
  it("adds a nullable per-tenant override (null = inherit)", () => {
    expect(sql).toContain("alter table rental_tenants");
    expect(sql).toContain("add column if not exists payment_policy text");
    expect(sql).toContain("payment_policy is null");
  });
  it("audits portfolio policy changes like the R1 late-fee settings", () => {
    expect(sql).toContain("rental_payment_policy_audit");
    expect(sql).toContain("has_workspace_access(owner_id)");
  });
  it("provides an audited owner-scoped RPC for the policy write", () => {
    expect(sql).toContain("create or replace function public.set_rental_payment_policy(p_owner_id text, p_policy text)");
    expect(sql).toContain("grant execute on function public.set_rental_payment_policy(text, text) to authenticated;");
    expect(sql).toContain("revoke all on function public.set_rental_payment_policy(text, text) from public, anon;");
    expect(sql).toContain("Payment policy must be allow_any_amount, require_rent, or require_balance.");
  });
  it("documents the autopay exemption decision", () => {
    expect(sql).toMatch(/autopay.*exempt/i);
  });
});
