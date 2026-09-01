import { describe, expect, it } from "vitest";
import {
  normalizeRepositoryPath, classifyProtectedPath, classifyProtectedPaths, classifyTestIntegritySignals,
} from "../protectedOperationClassifier.mjs";

describe("normalizeRepositoryPath", () => {
  it("lower-cases and normalizes separators", () => {
    expect(normalizeRepositoryPath("SUPABASE/MIGRATIONS/x.sql")).toBe("supabase/migrations/x.sql");
  });

  it("resolves a path-traversal attempt to a stable, comparable path", () => {
    expect(normalizeRepositoryPath("supabase/other/../migrations/x.sql")).toBe("supabase/migrations/x.sql");
  });

  it("resolves an attempt to escape the repo root back to a comparable relative path", () => {
    // Even a traversal aimed outside the repo still normalizes deterministically rather than throwing --
    // classify against whatever it resolves to, rather than crashing on unexpected input.
    expect(normalizeRepositoryPath("../../../etc/passwd")).toBe("etc/passwd");
  });

  it("returns an empty string for empty or non-string input rather than throwing", () => {
    expect(normalizeRepositoryPath("")).toBe("");
    expect(normalizeRepositoryPath(null)).toBe("");
    expect(normalizeRepositoryPath(undefined)).toBe("");
  });
});

describe("classifyProtectedPath", () => {
  it("flags a migration file as protected", () => {
    const result = classifyProtectedPath("supabase/migrations/20260828000000_x.sql");
    expect(result.protected).toBe(true);
    expect(result.reasons).toContain("database_migration");
  });

  it("cannot be bypassed by case variation", () => {
    const result = classifyProtectedPath("SUPABASE/MIGRATIONS/20260828000000_X.SQL");
    expect(result.protected).toBe(true);
    expect(result.reasons).toContain("database_migration");
  });

  it("cannot be bypassed by a path-traversal rename", () => {
    const result = classifyProtectedPath("supabase/not-migrations/../migrations/x.sql");
    expect(result.protected).toBe(true);
    expect(result.reasons).toContain("database_migration");
  });

  it("cannot be bypassed by a backslash-separated (Windows-style) path", () => {
    const result = classifyProtectedPath("supabase\\migrations\\x.sql");
    expect(result.protected).toBe(true);
    expect(result.reasons).toContain("database_migration");
  });

  it("flags an authorization helper as protected", () => {
    expect(classifyProtectedPath("src/lib/supabase/resolveEffectiveOwnerId.js").protected).toBe(true);
    expect(classifyProtectedPath("supabase/migrations/x_add_workspace_authorization_helpers.sql").reasons)
      .toEqual(expect.arrayContaining(["database_migration", "authorization_or_rls"]));
  });

  it("flags a Stripe/financial path as protected", () => {
    expect(classifyProtectedPath("src/app/api/rental/stripe-webhook/route.js").protected).toBe(true);
    expect(classifyProtectedPath("src/domains/financial-position/FinancialPositionQueryService.js").protected).toBe(true);
  });

  // Regression for a real gap found during the FB-UI-0 checkpoint's inspection and documented as
  // needing a fix before any FB-UI authority above read-only relies on this classifier: "financing"
  // is not a substring of "financial", so a real, live path this session shipped
  // (src/app/api/private-financing/portal/route.js) previously passed through unclassified.
  it("flags a private-financing path as protected (financial_logic and contractual_workflow both)", () => {
    const result = classifyProtectedPath("src/app/api/private-financing/portal/route.js");
    expect(result.protected).toBe(true);
    expect(result.reasons).toEqual(expect.arrayContaining(["financial_logic", "contractual_workflow"]));
  });

  it("flags a promissory note / loan note / lease agreement path as a protected contractual workflow", () => {
    expect(classifyProtectedPath("src/domains/private-financing/promissoryNoteTerms.js").reasons).toContain("contractual_workflow");
    expect(classifyProtectedPath("src/domains/rental/leaseAgreementRenewal.js").reasons).toContain("contractual_workflow");
  });

  it("flags an accounting-calculation path as financial_logic", () => {
    expect(classifyProtectedPath("src/domains/ledger/accountingCalculations.js").reasons).toContain("financial_logic");
  });

  it("flags an env/secrets path as protected", () => {
    expect(classifyProtectedPath(".env.local").protected).toBe(true);
    expect(classifyProtectedPath("scripts/deploy/rotate-service-role-key.mjs").protected).toBe(true);
  });

  it("flags a tenant/lease/insurance path as protected", () => {
    expect(classifyProtectedPath("src/domains/rental-tenant/index.js").protected).toBe(true);
    expect(classifyProtectedPath("src/components/forge/rental/RentalInsurancePanel.jsx").protected).toBe(true);
  });

  it("flags the repair controller's own code as protected against self-modification", () => {
    expect(classifyProtectedPath("scripts/repair-controller/repairContracts.mjs").protected).toBe(true);
    expect(classifyProtectedPath("scripts/repair-controller/repairContracts.mjs").reasons)
      .toContain("repair_controller_self_modification");
  });

  it("flags the governance updater's own code as protected", () => {
    expect(classifyProtectedPath("scripts/governance/synchronizeAuthoritativeGovernance.mjs").protected).toBe(true);
  });

  it("flags a dependency manifest as protected", () => {
    expect(classifyProtectedPath("package.json").protected).toBe(true);
    expect(classifyProtectedPath("package-lock.json").protected).toBe(true);
  });

  it("does not flag an ordinary, unrelated application file", () => {
    const result = classifyProtectedPath("src/components/home/HomePetOfWeek.js");
    expect(result.protected).toBe(false);
    expect(result.reasons).toEqual([]);
  });
});

describe("classifyProtectedPaths", () => {
  it("classifies a batch and preserves order", () => {
    const results = classifyProtectedPaths(["package.json", "src/components/home/HomePetOfWeek.js"]);
    expect(results.map((r) => r.protected)).toEqual([true, false]);
  });
});

describe("classifyTestIntegritySignals", () => {
  it("flags removed tests", () => {
    expect(classifyTestIntegritySignals({ testsRemoved: 3 }).protected).toBe(true);
  });

  it("flags newly-skipped tests", () => {
    expect(classifyTestIntegritySignals({ testsNewlySkipped: 1 }).protected).toBe(true);
  });

  it("flags a lowered coverage threshold", () => {
    expect(classifyTestIntegritySignals({ coverageThresholdLowered: true }).protected).toBe(true);
  });

  it("flags a removed validation step", () => {
    expect(classifyTestIntegritySignals({ validationStepRemoved: true }).protected).toBe(true);
  });

  it("does not flag a clean signal set", () => {
    const result = classifyTestIntegritySignals({ testsRemoved: 0, testsNewlySkipped: 0 });
    expect(result.protected).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it("defaults to a clean result when called with no arguments", () => {
    expect(classifyTestIntegritySignals().protected).toBe(false);
  });
});
