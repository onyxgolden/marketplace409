import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../../../supabase/migrations/20260830000700_grant_private_financing_authenticated_reads.sql",
    import.meta.url,
  ),
  "utf8",
);

const REQUIRED_READ_TARGETS = [
  "private_financing_accounts",
  "private_financing_components",
  "private_financing_borrowers",
  "private_financing_account_borrowers",
  "private_financing_events",
  "private_financing_payoff_offers",
  "private_financing_servicing_policy_versions",
  "private_financing_account_terms_versions",
  "private_financing_current_components",
];

describe("private-financing authenticated read grants", () => {
  it.each(REQUIRED_READ_TARGETS)("grants authenticated SELECT on %s", (table) => {
    expect(sql).toContain(`grant select on table public.${table} to authenticated;`);
  });

  it("contains exactly the expected nine grants", () => {
    expect(sql.match(/grant select on table public\./g)).toHaveLength(REQUIRED_READ_TARGETS.length);
  });

  it("never grants write or broad privileges", () => {
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|all)/i);
    expect(sql).not.toMatch(/grant\s+.*\s+to\s+(anon|public)/i);
  });

  it("does not alter, disable, or bypass RLS", () => {
    expect(sql).not.toMatch(/disable\s+row\s+level\s+security/i);
    expect(sql).not.toContain("row_security = off");
    expect(sql).not.toMatch(/alter\s+policy/i);
  });

  it("documents that the convenience view remains security-invoker governed", () => {
    expect(sql).toContain("security_invoker=true");
    expect(sql).toContain(
      "grant select on table public.private_financing_current_components to authenticated;",
    );
  });
});
