import { describe, expect, it } from "vitest";
import {
  MalformedFeedbackEntryError,
  TESTER_ROLE, FEEDBACK_ENVIRONMENT, MISSION_STATE, FEEDBACK_SEVERITY, FEEDBACK_RISK_FLAG,
  validateFeedbackEntry,
} from "../feedbackContracts.mjs";

function validEntry(overrides = {}) {
  return {
    feedbackId: "fb-1",
    workflowId: "landlord-add-tenant",
    stepId: "confirm-new-tenant-visible",
    testerRole: TESTER_ROLE.LANDLORD,
    environment: FEEDBACK_ENVIRONMENT.PRODUCTION,
    buildRef: "fa9dbfc63d",
    state: MISSION_STATE.COMPLETED,
    expectedResult: "New tenant appears selected after Add Tenant.",
    actualResult: "List did not refresh; had to reload the page.",
    durationSeconds: 42,
    attemptCount: 1,
    evidenceRefs: ["screenshot-manifest:abc123"],
    userComment: "Confusing -- thought it failed.",
    involvedSurface: { route: "/forge/rental/tenants", component: "AddTenantForm", api: null, domain: "rental" },
    severity: FEEDBACK_SEVERITY.CONFUSING,
    reproducible: true,
    reproSteps: ["Open a property", "Click Add Tenant", "Submit the form"],
    riskFlags: [],
    relatedFeedbackId: null,
    resolution: null,
    recordedAt: "2026-09-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("validateFeedbackEntry", () => {
  it("accepts a well-formed entry and returns a frozen object", () => {
    const entry = validateFeedbackEntry(validEntry());
    expect(entry.feedbackId).toBe("fb-1");
    expect(entry.schemaVersion).toBe("1.0");
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.involvedSurface)).toBe(true);
    expect(Object.isFrozen(entry.evidenceRefs)).toBe(true);
  });

  it("fails closed on a non-object", () => {
    expect(() => validateFeedbackEntry(null)).toThrow(MalformedFeedbackEntryError);
    expect(() => validateFeedbackEntry("nope")).toThrow(MalformedFeedbackEntryError);
  });

  it("fails closed on a missing feedbackId", () => {
    expect(() => validateFeedbackEntry(validEntry({ feedbackId: "" }))).toThrow(MalformedFeedbackEntryError);
  });

  it("fails closed on an unknown testerRole", () => {
    expect(() => validateFeedbackEntry(validEntry({ testerRole: "landlordsCousin" }))).toThrow(MalformedFeedbackEntryError);
  });

  it("fails closed on an unknown environment", () => {
    expect(() => validateFeedbackEntry(validEntry({ environment: "staging" }))).toThrow(MalformedFeedbackEntryError);
  });

  it("fails closed on an unknown state", () => {
    expect(() => validateFeedbackEntry(validEntry({ state: "in_progress" }))).toThrow(MalformedFeedbackEntryError);
  });

  it("fails closed on a negative durationSeconds", () => {
    expect(() => validateFeedbackEntry(validEntry({ durationSeconds: -1 }))).toThrow(MalformedFeedbackEntryError);
  });

  it("fails closed on a non-integer attemptCount", () => {
    expect(() => validateFeedbackEntry(validEntry({ attemptCount: 1.5 }))).toThrow(MalformedFeedbackEntryError);
  });

  it("fails closed on an attemptCount of zero", () => {
    expect(() => validateFeedbackEntry(validEntry({ attemptCount: 0 }))).toThrow(MalformedFeedbackEntryError);
  });

  it("fails closed when evidenceRefs contains a non-string", () => {
    expect(() => validateFeedbackEntry(validEntry({ evidenceRefs: [42] }))).toThrow(MalformedFeedbackEntryError);
  });

  it("accepts a null userComment", () => {
    const entry = validateFeedbackEntry(validEntry({ userComment: null }));
    expect(entry.userComment).toBeNull();
  });

  it("fails closed on a non-string, non-null userComment", () => {
    expect(() => validateFeedbackEntry(validEntry({ userComment: 42 }))).toThrow(MalformedFeedbackEntryError);
  });

  it("fails closed when involvedSurface identifies nothing", () => {
    expect(() =>
      validateFeedbackEntry(validEntry({ involvedSurface: { route: null, component: null, api: null, domain: null } })),
    ).toThrow(MalformedFeedbackEntryError);
  });

  it("accepts an involvedSurface identifying only an API", () => {
    const entry = validateFeedbackEntry(
      validEntry({ involvedSurface: { route: null, component: null, api: "/api/rental/portal", domain: null } }),
    );
    expect(entry.involvedSurface.api).toBe("/api/rental/portal");
  });

  it("fails closed on an unknown severity", () => {
    expect(() => validateFeedbackEntry(validEntry({ severity: "catastrophic" }))).toThrow(MalformedFeedbackEntryError);
  });

  it("fails closed when reproducible is true but reproSteps is empty", () => {
    expect(() => validateFeedbackEntry(validEntry({ reproducible: true, reproSteps: [] }))).toThrow(MalformedFeedbackEntryError);
  });

  it("accepts reproducible:false with empty reproSteps", () => {
    const entry = validateFeedbackEntry(validEntry({ reproducible: false, reproSteps: [] }));
    expect(entry.reproducible).toBe(false);
  });

  it("fails closed on an unknown riskFlags entry", () => {
    expect(() => validateFeedbackEntry(validEntry({ riskFlags: ["haunted"] }))).toThrow(MalformedFeedbackEntryError);
  });

  it("accepts valid riskFlags", () => {
    const entry = validateFeedbackEntry(
      validEntry({ riskFlags: [FEEDBACK_RISK_FLAG.FINANCIAL, FEEDBACK_RISK_FLAG.DATA_INTEGRITY] }),
    );
    expect(entry.riskFlags).toEqual(["financial", "data_integrity"]);
  });

  it("fails closed on a non-string, non-null relatedFeedbackId", () => {
    expect(() => validateFeedbackEntry(validEntry({ relatedFeedbackId: 7 }))).toThrow(MalformedFeedbackEntryError);
  });

  it("accepts a relatedFeedbackId referencing a duplicate", () => {
    const entry = validateFeedbackEntry(validEntry({ relatedFeedbackId: "fb-0" }));
    expect(entry.relatedFeedbackId).toBe("fb-0");
  });

  it("accepts a null resolution", () => {
    const entry = validateFeedbackEntry(validEntry({ resolution: null }));
    expect(entry.resolution).toBeNull();
  });

  it("fails closed on a resolution missing verificationEvidenceRef", () => {
    expect(() =>
      validateFeedbackEntry(validEntry({ resolution: { commitSha: "abc123", verificationEvidenceRef: "" } })),
    ).toThrow(MalformedFeedbackEntryError);
  });

  it("accepts a complete resolution", () => {
    const entry = validateFeedbackEntry(
      validEntry({ resolution: { commitSha: "abc123", verificationEvidenceRef: "docs/product/verification.md" } }),
    );
    expect(entry.resolution).toEqual({ commitSha: "abc123", verificationEvidenceRef: "docs/product/verification.md" });
  });

  it("fails closed on a missing recordedAt", () => {
    expect(() => validateFeedbackEntry(validEntry({ recordedAt: "" }))).toThrow(MalformedFeedbackEntryError);
  });
});
