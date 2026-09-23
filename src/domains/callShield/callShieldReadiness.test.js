import { describe, expect, it } from "vitest";
import { logCall, openCase, recordDncRegistration, recordOptOut } from "./callShieldCase.js";
import { READINESS_STATUS, SIGNAL_TYPES } from "./callShieldConstants.js";
import { scoreReadiness } from "./callShieldReadiness.js";

function strongCase() {
  let s = openCase({ reportedBusinessName: "Cruise Agency FL" }).state;
  s = recordDncRegistration(s, {
    phoneNumber: "+14095551212",
    registeredAt: "2020-01-15T00:00:00Z",
  }).state;
  s = logCall(s, {
    numberShown: "(713) 239-9946",
    occurredAt: "2026-09-23T10:23:00-05:00",
    agentName: "Alex",
    businessNameStated: "Cruise Agency FL",
  }).state;
  s = logCall(s, {
    numberShown: "(469) 485-8280",
    occurredAt: "2026-09-23T11:42:00-05:00",
  }).state;
  s = recordOptOut(s, {
    channel: "verbal_on_call",
    occurredAt: "2026-09-20T12:00:00-05:00",
    notes: "told them to remove me",
  }).state;
  return s;
}

describe("scoreReadiness", () => {
  it("scores a well-documented file as ready with observation signals", () => {
    const result = scoreReadiness(strongCase(), { asOf: "2026-09-23T15:00:00-05:00" });
    expect(result.status).toBe(READINESS_STATUS.READY);
    const types = result.signals.map((s) => s.type);
    expect(types).toContain(SIGNAL_TYPES.DNC_REGISTRATION_PRESENT);
    expect(types).toContain(SIGNAL_TYPES.REPEATED_CALLS_SAME_ENTITY);
    expect(types).toContain(SIGNAL_TYPES.OPT_OUT_DOCUMENTED);
    expect(types).toContain(SIGNAL_TYPES.IDENTITY_EVIDENCE_PRESENT);
    expect(result.exclusionFactors).toEqual([]);
  });

  it("scores an empty case as incomplete with fillable gaps", () => {
    const result = scoreReadiness(openCase({ reportedBusinessName: "X" }).state);
    expect(result.status).toBe(READINESS_STATUS.INCOMPLETE);
    expect(result.gaps.length).toBeGreaterThan(0);
    expect(result.exclusionFactors).toEqual([]);
  });

  it("flags (never disqualifies) user-reported exclusion factors", () => {
    const result = scoreReadiness(strongCase(), {
      asOf: "2026-09-23T15:00:00-05:00",
      reportedExclusionFactors: ["political"],
    });
    expect(result.status).toBe(READINESS_STATUS.FLAGGED);
    expect(result.exclusionFactors).toHaveLength(1);
    expect(result.exclusionFactors[0].type).toBe(SIGNAL_TYPES.POTENTIAL_EXCLUSION_FACTOR);
    expect(result.exclusionFactors[0].detail).toMatch(/flagged for attorney review/i);
    expect(JSON.stringify(result)).not.toMatch(/disqualified/i);
  });

  it("masks phone numbers in signal details", () => {
    const result = scoreReadiness(strongCase(), { asOf: "2026-09-23T15:00:00-05:00" });
    const dnc = result.signals.find((s) => s.type === SIGNAL_TYPES.DNC_REGISTRATION_PRESENT);
    expect(dnc.detail).toMatch(/\*\*\*\*\d{4}/);
    expect(dnc.detail).not.toContain("4095551212");
  });

  it("never states legal conclusions or money figures", () => {
    const result = scoreReadiness(strongCase(), {
      asOf: "2026-09-23T15:00:00-05:00",
      reportedExclusionFactors: ["charity"],
    });
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/violation/i);
    expect(text).not.toMatch(/\$\d/);
    expect(text).not.toMatch(/you are owed/i);
  });
});
