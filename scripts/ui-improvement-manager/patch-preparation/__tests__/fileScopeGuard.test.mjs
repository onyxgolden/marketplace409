import { describe, expect, it } from "vitest";
import { FileOutOfScopeError, assertFileInScope, classifyFileScope } from "../fileScopeGuard.mjs";

// Deliberately NOT under a financial/rental/tenant path -- those are legitimately protected_domain
// under rule 6 (confirmed by the dedicated tests below), so an "ordinary, unrelated, allowed" fixture
// needs a genuinely neutral component, matching protectedOperationClassifier.test.mjs's own choice of
// example for the same reason.
const NEUTRAL_FILE = "src/components/home/HomePetOfWeek.js";

function proposal(overrides = {}) {
  return { allowedPaths: [NEUTRAL_FILE], forbiddenPaths: [], ...overrides };
}

describe("classifyFileScope", () => {
  it("allows a file that is exactly on the allowlist", () => {
    const result = classifyFileScope(proposal(), NEUTRAL_FILE);
    expect(result.allowed).toBe(true);
  });

  it("allows a file under an allowlisted directory prefix", () => {
    const result = classifyFileScope(proposal({ allowedPaths: ["src/components/home/"] }), NEUTRAL_FILE);
    expect(result.allowed).toBe(true);
  });

  // Required test: out-of-scope file modification
  it("denies a file that is not on the allowlist at all", () => {
    const result = classifyFileScope(proposal(), "src/components/home/HomeCategories.js");
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("not_on_approved_allowlist");
  });

  it("does not allow a sibling file with a similar name prefix (no partial-match bypass)", () => {
    const result = classifyFileScope(proposal({ allowedPaths: [NEUTRAL_FILE] }), "src/components/home/HomePetOfWeekExtra.js");
    expect(result.allowed).toBe(false);
  });

  it("denies a file explicitly listed in the proposal's own forbiddenPaths, even if it would otherwise match the allowlist directory", () => {
    const result = classifyFileScope(
      proposal({ allowedPaths: ["src/components/home/"], forbiddenPaths: [NEUTRAL_FILE] }),
      NEUTRAL_FILE,
    );
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("explicitly_forbidden_by_proposal");
  });

  // Required test: prohibited-file modification (rule 6 -- permanently protected domains)
  it("denies a database migration even if it is on the proposal's own allowlist", () => {
    const result = classifyFileScope(proposal({ allowedPaths: ["supabase/migrations/x.sql"] }), "supabase/migrations/x.sql");
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("protected_domain");
    expect(result.protectedReasons).toContain("database_migration");
  });

  it("denies an authorization/RLS helper even if allowlisted", () => {
    const result = classifyFileScope(proposal({ allowedPaths: ["src/lib/supabase/resolveEffectiveOwnerId.js"] }), "src/lib/supabase/resolveEffectiveOwnerId.js");
    expect(result.allowed).toBe(false);
    expect(result.protectedReasons).toContain("authorization_or_rls");
  });

  it("denies a Stripe/payment path even if allowlisted", () => {
    const result = classifyFileScope(proposal({ allowedPaths: ["src/app/api/rental/stripe-webhook/route.js"] }), "src/app/api/rental/stripe-webhook/route.js");
    expect(result.allowed).toBe(false);
    expect(result.protectedReasons).toContain("financial_logic");
  });

  it("denies an accounting-calculation path even if allowlisted", () => {
    const result = classifyFileScope(proposal({ allowedPaths: ["src/domains/ledger/accountingCalculations.js"] }), "src/domains/ledger/accountingCalculations.js");
    expect(result.allowed).toBe(false);
    expect(result.protectedReasons).toContain("financial_logic");
  });

  it("denies a secrets/credentials path even if allowlisted", () => {
    const result = classifyFileScope(proposal({ allowedPaths: [".env.local"] }), ".env.local");
    expect(result.allowed).toBe(false);
    expect(result.protectedReasons).toContain("secrets_or_credentials");
  });

  it("denies a private-financing/contractual path even if allowlisted (the FB-UI-0-identified gap, now fixed)", () => {
    const result = classifyFileScope(proposal({ allowedPaths: ["src/app/api/private-financing/portal/route.js"] }), "src/app/api/private-financing/portal/route.js");
    expect(result.allowed).toBe(false);
    expect(result.protectedReasons).toEqual(expect.arrayContaining(["financial_logic", "contractual_workflow"]));
  });

  it("cannot be bypassed by a path-traversal or case-variation rename", () => {
    const result = classifyFileScope(proposal({ allowedPaths: ["SUPABASE/migrations/../MIGRATIONS/x.sql"] }), "SUPABASE/migrations/../MIGRATIONS/x.sql");
    expect(result.allowed).toBe(false);
    expect(result.protectedReasons).toContain("database_migration");
  });
});

describe("assertFileInScope", () => {
  it("returns the classification result for an allowed file", () => {
    expect(assertFileInScope(proposal(), NEUTRAL_FILE).allowed).toBe(true);
  });

  it("throws FileOutOfScopeError for a disallowed file", () => {
    expect(() => assertFileInScope(proposal(), "supabase/migrations/x.sql")).toThrow(FileOutOfScopeError);
  });
});
