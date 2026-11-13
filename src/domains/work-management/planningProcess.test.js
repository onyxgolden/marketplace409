// Domain tests: planning-process earned value (Josh's Packaged Planning
// Process PDF) + F2 transition rules (scope-review verdict, 2026-11-12).
import { describe, expect, it } from "vitest";
import {
  CONSTRUCTION_READINESS_NOT_ESTABLISHED,
  PLANNING_PROCESS_TEMPLATE,
  PLANNING_PROCESS_TEMPLATE_VERSION,
  computePlanningProgress,
  hasFreshEvidence,
  scaledMhrs,
  statusEarnsValue,
  validateAttestation,
  validateEvidenceLink,
  validatePlanningStatusChange,
  validatePlanningTemplate,
  validateReason,
} from "./planningProcess.js";

function instancesWith(statusByKey) {
  return PLANNING_PROCESS_TEMPLATE.map((step) => ({
    templateStepId: step.stepKey,
    status: statusByKey[step.stepKey] || "In-Progress",
  }));
}

function allStatus(status) {
  return instancesWith(Object.fromEntries(PLANNING_PROCESS_TEMPLATE.map((s) => [s.stepKey, status])));
}

describe("PLANNING_PROCESS_TEMPLATE (PDF, version 1)", () => {
  it("is version 1 with exactly 22 stable step keys in PDF order", () => {
    expect(PLANNING_PROCESS_TEMPLATE_VERSION).toBe(1);
    expect(PLANNING_PROCESS_TEMPLATE).toHaveLength(22);
    expect(PLANNING_PROCESS_TEMPLATE.map((s) => s.stepKey)).toEqual(
      Array.from({ length: 22 }, (_, i) => `pdf-${String(i + 1).padStart(2, "0")}`),
    );
    expect(PLANNING_PROCESS_TEMPLATE.map((s) => s.stepNumber)).toEqual(
      Array.from({ length: 22 }, (_, i) => i + 1),
    );
  });

  it("has 11 weighted steps (100% / 40 MHRS) and 11 reporting-only (0% / 0h)", () => {
    const weighted = PLANNING_PROCESS_TEMPLATE.filter((s) => s.creditPct > 0);
    const reporting = PLANNING_PROCESS_TEMPLATE.filter((s) => s.creditPct === 0);
    expect(weighted.map((s) => s.stepNumber)).toEqual([1, 2, 3, 4, 5, 7, 9, 11, 14, 15, 18]);
    expect(weighted.map((s) => s.creditPct)).toEqual([5, 5, 5, 10, 10, 10, 10, 10, 10, 15, 10]);
    expect(weighted.map((s) => s.mhrsStandard)).toEqual([2, 2, 2, 4, 4, 4, 4, 4, 4, 6, 4]);
    expect(reporting.map((s) => s.stepNumber)).toEqual([6, 8, 10, 12, 13, 16, 17, 19, 20, 21, 22]);
    expect(reporting.every((s) => s.mhrsStandard === null)).toBe(true);
    expect(weighted.reduce((sum, s) => sum + s.creditPct, 0)).toBe(100);
    expect(weighted.reduce((sum, s) => sum + s.mhrsStandard, 0)).toBe(40);
  });

  it("validates the shipped template", () => {
    expect(validatePlanningTemplate(PLANNING_PROCESS_TEMPLATE)).toEqual(
      { ok: true, totalCredit: 100, totalHours: 40 },
    );
  });

  it("rejects a short, duplicated-key, misnumbered, or wrong-sum template", () => {
    expect(validatePlanningTemplate(PLANNING_PROCESS_TEMPLATE.slice(0, 21)).ok).toBe(false);
    const dup = [...PLANNING_PROCESS_TEMPLATE];
    dup[1] = { ...dup[1], stepKey: "pdf-01" };
    expect(validatePlanningTemplate(dup).ok).toBe(false);
    const renumbered = PLANNING_PROCESS_TEMPLATE.map((s, i) => ({ ...s, stepNumber: i + 2 }));
    expect(validatePlanningTemplate(renumbered).ok).toBe(false);
    const wrongCredit = PLANNING_PROCESS_TEMPLATE.map((s) =>
      (s.stepKey === "pdf-01" ? { ...s, creditPct: 6 } : s));
    expect(validatePlanningTemplate(wrongCredit).error).toMatch(/sum to 100/);
    const wrongHours = PLANNING_PROCESS_TEMPLATE.map((s) =>
      (s.stepKey === "pdf-01" ? { ...s, mhrsStandard: 3 } : s));
    expect(validatePlanningTemplate(wrongHours).error).toMatch(/sum to 40/);
  });
});

describe("computePlanningProgress (fixed denominator 100)", () => {
  it("steps 1–3 Complete at standard = 15%, 6 of 40h", () => {
    const p = computePlanningProgress({
      template: PLANNING_PROCESS_TEMPLATE,
      instances: instancesWith({ "pdf-01": "Complete", "pdf-02": "Complete", "pdf-03": "Complete" }),
      complexity: "standard",
    });
    expect(p.percentComplete).toBe(15);
    expect(p.earnedCreditPct).toBe(15);
    expect(p.totalCreditPct).toBe(100);
    expect(p.earnedMhrs).toBe(6);
    expect(p.totalMhrs).toBe(40);
    expect(p.initialized).toBe(true);
  });

  it("same three steps at Mid = 15%, 9 of 60h (percent fixed, hours scaled)", () => {
    const p = computePlanningProgress({
      template: PLANNING_PROCESS_TEMPLATE,
      instances: instancesWith({ "pdf-01": "Complete", "pdf-02": "Complete", "pdf-03": "Complete" }),
      complexity: "mid",
    });
    expect(p.percentComplete).toBe(15);
    expect(p.earnedMhrs).toBe(9);
    expect(p.totalMhrs).toBe(60);
  });

  it("50% earned at Standard = 20 MHRS and at Mid = 30 MHRS (verdict acceptance test 1)", () => {
    const earned = { "pdf-01": "Complete", "pdf-02": "Complete", "pdf-03": "Complete", "pdf-04": "Complete", "pdf-14": "Complete", "pdf-15": "Complete" };
    const atStandard = computePlanningProgress({ template: PLANNING_PROCESS_TEMPLATE, instances: instancesWith(earned), complexity: "standard" });
    const atMid = computePlanningProgress({ template: PLANNING_PROCESS_TEMPLATE, instances: instancesWith(earned), complexity: "mid" });
    expect(atStandard.percentComplete).toBe(50);
    expect(atStandard.earnedMhrs).toBe(20);
    expect(atStandard.totalMhrs).toBe(40);
    expect(atMid.percentComplete).toBe(50);
    expect(atMid.earnedMhrs).toBe(30);
    expect(atMid.totalMhrs).toBe(60);
  });

  it("step 15 (15%) N/A earns, Needs Revision earns nothing, Reviewed earns", () => {
    const na = computePlanningProgress({ template: PLANNING_PROCESS_TEMPLATE, instances: instancesWith({ "pdf-15": "N/A" }), complexity: "standard" });
    expect(na.percentComplete).toBe(15);
    expect(na.earnedMhrs).toBe(6);
    const nr = computePlanningProgress({ template: PLANNING_PROCESS_TEMPLATE, instances: instancesWith({ "pdf-15": "Needs Revision" }), complexity: "standard" });
    expect(nr.percentComplete).toBe(0);
    expect(nr.earnedMhrs).toBe(0);
    const rv = computePlanningProgress({ template: PLANNING_PROCESS_TEMPLATE, instances: instancesWith({ "pdf-15": "Reviewed" }), complexity: "standard" });
    expect(rv.percentComplete).toBe(15);
  });

  it("all reporting-only Complete = 0% (0 of 40h)", () => {
    const reporting = Object.fromEntries(
      PLANNING_PROCESS_TEMPLATE.filter((s) => s.creditPct === 0).map((s) => [s.stepKey, "Complete"]),
    );
    const p = computePlanningProgress({ template: PLANNING_PROCESS_TEMPLATE, instances: instancesWith(reporting), complexity: "standard" });
    expect(p.percentComplete).toBe(0);
    expect(p.earnedMhrs).toBe(0);
  });

  it("all weighted Complete = 100%, 40 of 40h at standard and 120 of 120h at H-High", () => {
    const weighted = Object.fromEntries(
      PLANNING_PROCESS_TEMPLATE.filter((s) => s.creditPct > 0).map((s) => [s.stepKey, "Complete"]),
    );
    const atStandard = computePlanningProgress({ template: PLANNING_PROCESS_TEMPLATE, instances: instancesWith(weighted), complexity: "standard" });
    expect(atStandard.percentComplete).toBe(100);
    expect(atStandard.earnedMhrs).toBe(40);
    const atHigh = computePlanningProgress({ template: PLANNING_PROCESS_TEMPLATE, instances: instancesWith(weighted), complexity: "h_high" });
    expect(atHigh.percentComplete).toBe(100);
    expect(atHigh.earnedMhrs).toBe(120);
    expect(atHigh.totalMhrs).toBe(120);
  });

  it("every complexity yields 30/40/60/80/120 total MHRS", () => {
    const expected = { low: 30, standard: 40, mid: 60, high: 80, h_high: 120 };
    for (const [complexity, total] of Object.entries(expected)) {
      const p = computePlanningProgress({ template: PLANNING_PROCESS_TEMPLATE, instances: allStatus("In-Progress"), complexity });
      expect(p.totalMhrs).toBe(total);
    }
  });

  it("zero instances is 'not started' (initialized false, 0%) — not an error", () => {
    const p = computePlanningProgress({ template: PLANNING_PROCESS_TEMPLATE, instances: [], complexity: "standard" });
    expect(p.percentComplete).toBe(0);
    expect(p.initialized).toBe(false);
  });

  it("fails closed on a partial, duplicated, or unknown-step instance set", () => {
    expect(() => computePlanningProgress({
      template: PLANNING_PROCESS_TEMPLATE,
      instances: instancesWith({ "pdf-01": "Complete" }).slice(0, 5),
      complexity: "standard",
    })).toThrow(/incomplete/);
    const dup = instancesWith({});
    dup[1] = { ...dup[1], templateStepId: "pdf-01" };
    expect(() => computePlanningProgress({ template: PLANNING_PROCESS_TEMPLATE, instances: dup, complexity: "standard" })).toThrow(/duplicated/);
    const unknown = instancesWith({});
    unknown[0] = { templateStepId: "pdf-99", status: "Complete" };
    expect(() => computePlanningProgress({ template: PLANNING_PROCESS_TEMPLATE, instances: unknown, complexity: "standard" })).toThrow(/unknown step/);
    expect(() => computePlanningProgress({ template: PLANNING_PROCESS_TEMPLATE, instances: allStatus("In-Progress"), complexity: "extreme" })).toThrow(/Unknown planning complexity/);
  });
});

describe("statusEarnsValue / scaledMhrs", () => {
  it("earning set is exactly Complete, N/A, Reviewed", () => {
    expect(["Complete", "N/A", "Reviewed"].every(statusEarnsValue)).toBe(true);
    expect(statusEarnsValue("In-Progress")).toBe(false);
    expect(statusEarnsValue("Needs Revision")).toBe(false);
  });

  it("scales hours by the complexity multiplier, never per-step overrides", () => {
    expect(scaledMhrs(2, "low")).toBe(1.5);
    expect(scaledMhrs(2, "standard")).toBe(2);
    expect(scaledMhrs(6, "mid")).toBe(9);
    expect(scaledMhrs(null, "standard")).toBeNull();
  });
});

describe("CONSTRUCTION_READINESS_NOT_ESTABLISHED (F1)", () => {
  it("is never a ready badge", () => {
    expect(CONSTRUCTION_READINESS_NOT_ESTABLISHED.status).toBe("not_established");
    expect(CONSTRUCTION_READINESS_NOT_ESTABLISHED.detail).toMatch(/never authorizes construction/);
  });
});

describe("validatePlanningStatusChange (F2 pre-check)", () => {
  const base = { canUpdate: true, canReview: true, oldStatus: "In-Progress", storedEvidenceLink: null };

  it("rejects an unknown status", () => {
    expect(validatePlanningStatusChange({ ...base, status: "Pending" })).toMatch(/must be one of/);
  });

  it("Reviewed needs the reviewer capability", () => {
    expect(validatePlanningStatusChange({ ...base, status: "Reviewed", canReview: false })).toMatch(/Only a reviewer/);
    expect(validatePlanningStatusChange({ ...base, status: "Reviewed" })).toBeNull();
  });

  it("a reviewer cannot review their own latest submission; an owner override needs a reason", () => {
    expect(validatePlanningStatusChange({ ...base, status: "Reviewed", isSelfSubmission: true }))
      .toMatch(/different reviewer/);
    expect(validatePlanningStatusChange({ ...base, status: "Reviewed", isSelfSubmission: true, isOwner: true }))
      .toMatch(/needs a reason/);
    expect(validatePlanningStatusChange({ ...base, status: "Reviewed", isSelfSubmission: true, isOwner: true, reason: "I checked the drawings myself." }))
      .toBeNull();
  });

  it("Complete needs an evidence link or an attestation", () => {
    expect(validatePlanningStatusChange({ ...base, status: "Complete" })).toMatch(/evidence link or a completion attestation/);
    expect(validatePlanningStatusChange({ ...base, status: "Complete", storedEvidenceLink: "https://example.invalid/pid" })).toBeNull();
    expect(validatePlanningStatusChange({ ...base, status: "Complete", attestation: "I walked the plot plan and it matches." })).toBeNull();
    expect(validatePlanningStatusChange({ ...base, status: "Complete", newEvidenceLink: "https://example.invalid/pid" })).toBeNull();
  });

  it("returning from Needs Revision needs FRESH evidence — a stored link does not count", () => {
    const returning = { ...base, oldStatus: "Needs Revision", storedEvidenceLink: "https://example.invalid/old" };
    expect(validatePlanningStatusChange({ ...returning, status: "Complete" })).toMatch(/fresh evidence/);
    expect(validatePlanningStatusChange({ ...returning, status: "Reviewed" })).toMatch(/fresh evidence/);
    expect(validatePlanningStatusChange({ ...returning, status: "Complete", newEvidenceLink: "https://example.invalid/new" })).toBeNull();
    expect(validatePlanningStatusChange({ ...returning, status: "Complete", attestation: "Re-did the walk after the revision." })).toBeNull();
    expect(hasFreshEvidence({ newEvidenceLink: "", attestation: "" })).toBe(false);
    expect(hasFreshEvidence({ newEvidenceLink: "https://example.invalid/x", attestation: "" })).toBe(true);
  });

  it("N/A and Needs Revision need a nonempty reason", () => {
    expect(validatePlanningStatusChange({ ...base, status: "N/A" })).toMatch(/reason is required/);
    expect(validatePlanningStatusChange({ ...base, status: "N/A", reason: "No MOC scope on this package." })).toBeNull();
    expect(validatePlanningStatusChange({ ...base, status: "Needs Revision" })).toMatch(/reason is required/);
    expect(validatePlanningStatusChange({ ...base, status: "Needs Revision", reason: "Plot plan elevation is wrong." })).toBeNull();
  });

  it("In-Progress needs no evidence or reason, but does need the update capability", () => {
    expect(validatePlanningStatusChange({ ...base, status: "In-Progress" })).toBeNull();
    expect(validatePlanningStatusChange({ ...base, status: "In-Progress", canUpdate: false })).toMatch(/don't have permission/);
  });

  it("over-long reason / attestation / evidence link are rejected", () => {
    expect(validateReason("x".repeat(501), { required: true }).ok).toBe(false);
    expect(validateAttestation("x".repeat(501)).ok).toBe(false);
    expect(validateEvidenceLink(`https://example.invalid/${"x".repeat(2000)}`).ok).toBe(false);
    expect(validateEvidenceLink("https://example.invalid/pid").ok).toBe(true);
  });
});
