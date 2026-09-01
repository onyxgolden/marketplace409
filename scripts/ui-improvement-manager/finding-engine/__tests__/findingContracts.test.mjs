import { describe, expect, it } from "vitest";
import {
  FINDING_CATEGORY, FINDING_CLASS, FINDING_CONFIDENCE, FINDING_SEVERITY, MalformedFindingError,
  PROPOSAL_STATUS, validateFindingsManifest, validateUiFinding,
} from "../findingContracts.mjs";

function validDeterministicFinding(overrides = {}) {
  return {
    findingId: "finding_abc123", ruleId: "horizontal-overflow", category: FINDING_CATEGORY.HORIZONTAL_OVERFLOW,
    findingClass: FINDING_CLASS.DETERMINISTIC, application: "409 Marketplace FORGE", routeId: "home", routePath: "/",
    viewport: "mobile", screenshotHash: `sha256:${"a".repeat(64)}`, probableSourceFiles: ["src/app/page.js"],
    affectedComponent: null, severity: FINDING_SEVERITY.MEDIUM, confidence: FINDING_CONFIDENCE.HIGH,
    explanation: "The page is wider than the viewport.", proposedImprovement: "Constrain the overflowing element.",
    validationRequirements: ["Re-capture and confirm no overflow."], prohibitedScope: ["Must not change financial calculations."],
    rollbackDescription: "Revert the CSS change.", status: PROPOSAL_STATUS.NEW, detectedAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("validateUiFinding", () => {
  it("accepts a well-formed deterministic finding", () => {
    const finding = validateUiFinding(validDeterministicFinding());
    expect(finding.category).toBe(FINDING_CATEGORY.HORIZONTAL_OVERFLOW);
    expect(finding.severity).toBe(FINDING_SEVERITY.MEDIUM);
  });

  it("rejects an unknown category", () => {
    expect(() => validateUiFinding(validDeterministicFinding({ category: "made-up" }))).toThrow(MalformedFindingError);
  });

  it("rejects a deterministic finding missing severity", () => {
    expect(() => validateUiFinding(validDeterministicFinding({ severity: undefined }))).toThrow(/severity must be one of/);
  });

  it("rejects a subjective finding that carries a severity -- never represent a suggestion as a defect", () => {
    const subjective = validDeterministicFinding({ findingClass: FINDING_CLASS.SUBJECTIVE, severity: FINDING_SEVERITY.HIGH });
    expect(() => validateUiFinding(subjective)).toThrow(/must never be represented as a defect/);
  });

  it("accepts a subjective finding with no severity at all", () => {
    const subjective = validDeterministicFinding({ findingClass: FINDING_CLASS.SUBJECTIVE, severity: undefined });
    const validated = validateUiFinding(subjective);
    expect(validated.severity).toBeNull();
    expect(validated.findingClass).toBe(FINDING_CLASS.SUBJECTIVE);
  });

  it("rejects a malformed screenshotHash", () => {
    expect(() => validateUiFinding(validDeterministicFinding({ screenshotHash: "not-a-hash" }))).toThrow(/screenshotHash/);
  });

  it("rejects an empty probableSourceFiles array", () => {
    expect(() => validateUiFinding(validDeterministicFinding({ probableSourceFiles: [] }))).toThrow(/probableSourceFiles/);
  });

  it("rejects an empty validationRequirements array", () => {
    expect(() => validateUiFinding(validDeterministicFinding({ validationRequirements: [] }))).toThrow(/validationRequirements/);
  });

  it("rejects an empty prohibitedScope array", () => {
    expect(() => validateUiFinding(validDeterministicFinding({ prohibitedScope: [] }))).toThrow(/prohibitedScope/);
  });

  it("rejects a missing rollbackDescription", () => {
    expect(() => validateUiFinding(validDeterministicFinding({ rollbackDescription: "" }))).toThrow(/rollbackDescription/);
  });

  it("rejects an unknown status", () => {
    expect(() => validateUiFinding(validDeterministicFinding({ status: "in_progress" }))).toThrow(/status/);
  });

  it("returns a frozen object", () => {
    const finding = validateUiFinding(validDeterministicFinding());
    expect(() => { finding.severity = "critical"; }).toThrow();
  });
});

describe("validateFindingsManifest", () => {
  it("sorts findings deterministically by findingId", () => {
    const a = validDeterministicFinding({ findingId: "finding_zzz" });
    const b = validDeterministicFinding({ findingId: "finding_aaa" });
    const manifest = validateFindingsManifest({ schemaVersion: "1.0", findings: [a, b] });
    expect(manifest.findings.map((f) => f.findingId)).toEqual(["finding_aaa", "finding_zzz"]);
  });

  it("rejects the wrong schema version", () => {
    expect(() => validateFindingsManifest({ schemaVersion: "9.9", findings: [] })).toThrow(/schemaVersion/);
  });
});
