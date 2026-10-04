import { describe, it, expect } from "vitest";
import {
  WORK_GATES,
  GATE_VERDICTS,
  evaluateGate,
  isGateSatisfied,
  isPackageReady,
  validateOverride,
} from "./workGates.js";

describe("evaluateGate", () => {
  it("returns unknown when there is no attestation", () => {
    const r = evaluateGate({ gate: "scope", attestation: null });
    expect(r.verdict).toBe("unknown");
    expect(r.reason).toMatch(/no attestation/i);
  });

  it("returns ready on a positive attestation", () => {
    const r = evaluateGate({
      gate: "crew",
      attestation: { statement: "Crew of 6 confirmed for Monday.", not_applicable: false },
    });
    expect(r.verdict).toBe("ready");
  });

  it("treats a reasoned N/A waiver as ready", () => {
    const r = evaluateGate({
      gate: "permit",
      attestation: { not_applicable: true, na_reason: "No permit required for this scope." },
    });
    expect(r.verdict).toBe("ready");
    expect(r.reason).toMatch(/waived/i);
  });

  it("treats a bare N/A waiver as unknown", () => {
    const r = evaluateGate({
      gate: "permit",
      attestation: { not_applicable: true, na_reason: "  " },
    });
    expect(r.verdict).toBe("unknown");
  });

  it("rejects unknown gates", () => {
    expect(() => evaluateGate({ gate: "teleport", attestation: null })).toThrow(/unknown gate/i);
  });
});

describe("isGateSatisfied", () => {
  it("is satisfied by a ready evaluation", () => {
    const r = isGateSatisfied({
      latestEvaluation: { verdict: "ready", reason: "ok" },
      activeOverrides: [],
    });
    expect(r.satisfied).toBe(true);
    expect(r.via).toBe("evaluation");
  });

  it("is satisfied by an active override despite not_ready", () => {
    const r = isGateSatisfied({
      latestEvaluation: { verdict: "not_ready", reason: "missing steel" },
      activeOverrides: [{ override_by: "jason", reason: "Steel arrives AM, start prep." }],
    });
    expect(r.satisfied).toBe(true);
    expect(r.via).toBe("override");
  });

  it("is not satisfied with no evaluation and no override", () => {
    const r = isGateSatisfied({ latestEvaluation: null, activeOverrides: [] });
    expect(r.satisfied).toBe(false);
    expect(r.via).toBe("none");
  });

  it("is not satisfied by an unknown evaluation", () => {
    const r = isGateSatisfied({
      latestEvaluation: { verdict: "unknown", reason: "no data" },
      activeOverrides: [],
    });
    expect(r.satisfied).toBe(false);
  });
});

describe("isPackageReady", () => {
  const state = (gate) => {
    if (gate === "scope")
      return { latestEvaluation: { verdict: "ready", reason: "ok" }, activeOverrides: [] };
    if (gate === "crew")
      return {
        latestEvaluation: { verdict: "not_ready", reason: "short-handed" },
        activeOverrides: [{ override_by: "jason", reason: "Borrowing crew B." }],
      };
    return { latestEvaluation: null, activeOverrides: [] };
  };

  it("reports ready only when every gate is satisfied", () => {
    const r = isPackageReady({ applicableGates: ["scope", "crew"], getGateState: state });
    expect(r.ready).toBe(true);
    expect(r.blocking).toEqual([]);
  });

  it("lists blocking gates", () => {
    const r = isPackageReady({
      applicableGates: ["scope", "crew", "permit"],
      getGateState: state,
    });
    expect(r.ready).toBe(false);
    expect(r.blocking).toEqual(["permit"]);
  });

  it("refuses to report ready with zero gates (bogus package type)", () => {
    expect(() =>
      isPackageReady({ applicableGates: [], getGateState: state })
    ).toThrow(/zero gates/i);
  });
});

describe("validateOverride", () => {
  const base = {
    gate: "safety",
    reason: "Inspector delayed; work is low-risk prep only.",
    expiresAt: "2026-10-10T12:00:00Z",
    nowIso: "2026-10-03T12:00:00Z",
  };

  it("accepts a well-formed override", () => {
    expect(() => validateOverride(base)).not.toThrow();
  });

  it("rejects a missing reason", () => {
    expect(() => validateOverride({ ...base, reason: "  " })).toThrow(/reason/i);
  });

  it("rejects a past expiry", () => {
    expect(() =>
      validateOverride({ ...base, expiresAt: "2026-10-01T12:00:00Z" })
    ).toThrow(/future/i);
  });

  it("rejects an expiry beyond 30 days", () => {
    expect(() =>
      validateOverride({ ...base, expiresAt: "2026-12-15T12:00:00Z" })
    ).toThrow(/30 days/i);
  });

  it("rejects unknown gates", () => {
    expect(() => validateOverride({ ...base, gate: "nope" })).toThrow(/unknown gate/i);
  });
});

describe("vocabulary", () => {
  it("has 12 gates", () => {
    expect(WORK_GATES).toHaveLength(12);
  });
  it("has 3 verdicts", () => {
    expect(GATE_VERDICTS).toEqual(["ready", "not_ready", "unknown"]);
  });
});
