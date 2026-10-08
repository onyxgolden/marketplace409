import { describe, expect, it } from "vitest";
import { prioritizeFindings, SEVERITIES, TRIAGE_STATES } from "../prioritizeFindings.mjs";

const findings = [
  {
    id: "coverage:dark-cap",
    kind: "coverage-gap",
    what: 'Runtime capability "Dark" is uncovered.',
    subsystem: "cron3",
    whyItMatters: "No monitoring evidence exists.",
    confidence: "high",
    lastSeen: null,
    evidenceLinks: [],
    nextStep: "Verify manually.",
  },
  {
    id: "coverage:gap-cap",
    kind: "coverage-gap",
    what: 'Runtime capability "Gappy" is partially-covered.',
    subsystem: "cron2",
    whyItMatters: "Partial coverage.",
    confidence: "medium",
    lastSeen: null,
    evidenceLinks: [],
    nextStep: "Verify manually.",
  },
  {
    id: "fix:aaa111",
    kind: "known-defect-repaired",
    what: "Repaired defect: Fix login redirect",
    subsystem: "src/auth.js",
    whyItMatters: "Historical context.",
    confidence: "high",
    lastSeen: "2026-10-01",
    evidenceLinks: [],
    nextStep: "Extra scrutiny on same files.",
  },
  {
    id: "evidence:bug-catalog-rows-unavailable",
    kind: "evidence-unavailable",
    what: "Bug catalog row details could not be loaded.",
    subsystem: "supabase:engineering_brain_bug_fixes",
    whyItMatters: "Unknown defect list.",
    confidence: "high",
    lastSeen: null,
    evidenceLinks: [],
    nextStep: "Retry the read.",
  },
];

const capabilities = [
  { id: "dark-cap", name: "Dark", monitoring_status: "uncovered", moves_money: false },
  { id: "gap-cap", name: "Gappy", monitoring_status: "partially-covered", moves_money: true },
  { id: "money-cap", name: "Money", monitoring_status: "partially-covered", moves_money: true },
];

describe("prioritizeFindings", () => {
  it("is deterministic: identical inputs produce identical output", () => {
    const a = prioritizeFindings({ findings, capabilities });
    const b = prioritizeFindings({ findings, capabilities });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("assigns base severities by kind and status", () => {
    const out = prioritizeFindings({ findings, capabilities: [] });
    const byId = Object.fromEntries(out.map((f) => [f.id, f]));
    expect(byId["coverage:dark-cap"].severity).toBe("high"); // uncovered
    expect(byId["coverage:gap-cap"].severity).toBe("medium"); // partially-covered, no money boost (empty caps)
    expect(byId["fix:aaa111"].severity).toBe("low"); // historical only
    expect(byId["evidence:bug-catalog-rows-unavailable"].severity).toBe("high");
  });

  it("boosts money-moving capabilities by one level without claiming defect", () => {
    const out = prioritizeFindings({ findings, capabilities });
    const gap = out.find((f) => f.id === "coverage:gap-cap");
    // partially-covered (medium) + moves_money → high
    expect(gap.severity).toBe("high");
    expect(gap.severityReason).toMatch(/moves_money/);
    // Must not claim the capability is defective for moving money.
    // The severityReason explicitly disclaims this; check the disclaimer exists
    // and that no affirmative defect claim appears.
    expect(gap.severityReason).toMatch(/not a defect claim/i);
    expect(gap.what.toLowerCase()).not.toMatch(/defective|broken/);
    expect(gap.whyItMatters.toLowerCase()).not.toMatch(/defective because.*money|broken because.*money/);
  });

  it("caps severity at critical", () => {
    const out = prioritizeFindings({ findings, capabilities });
    const dark = out.find((f) => f.id === "coverage:dark-cap");
    // uncovered (high) + no money boost for dark-cap → stays high
    expect(dark.severity).toBe("high");
    // evidence-unavailable (high) with money boost would cap at critical
    const moneyCaps = [...capabilities, { id: "x", moves_money: true }];
    const withBoost = prioritizeFindings({
      findings: [{ ...findings[3], id: "coverage:x", kind: "coverage-gap", what: "uncovered x" }],
      capabilities: moneyCaps,
    });
    expect(SEVERITIES).toContain(withBoost[0].severity);
    expect(["high", "critical"]).toContain(withBoost[0].severity);
  });

  it("assigns triage states correctly", () => {
    const out = prioritizeFindings({ findings, capabilities: [] });
    const byId = Object.fromEntries(out.map((f) => [f.id, f]));
    expect(byId["coverage:dark-cap"].triageState).toBe("needs-review");
    expect(byId["coverage:gap-cap"].triageState).toBe("needs-review");
    expect(byId["fix:aaa111"].triageState).toBe("informational");
    expect(byId["evidence:bug-catalog-rows-unavailable"].triageState).toBe("evidence-unavailable");
  });

  it("never emits a resolved state", () => {
    const out = prioritizeFindings({ findings, capabilities });
    for (const f of out) {
      expect(f.triageState).not.toBe("resolved");
      expect(TRIAGE_STATES).toContain(f.triageState);
    }
  });

  it("handles unknown kinds conservatively (medium, not dismissed)", () => {
    const out = prioritizeFindings({
      findings: [{ id: "weird:1", kind: "something-new", what: "mystery", subsystem: "x", confidence: "low", evidenceLinks: [] }],
      capabilities: [],
    });
    expect(out[0].severity).toBe("medium");
    expect(out[0].triageState).toBe("needs-review");
  });

  it("boosts on exact-file regression exposure (advisory)", () => {
    const out = prioritizeFindings({
      findings: [findings[1]], // gap-cap, subsystem cron2
      capabilities: [],
      exposures: [{ matchedFiles: ["cron2"], priorFix: { sha: "abc" } }],
    });
    expect(out[0].severity).toBe("high"); // medium + exposure boost
    expect(out[0].severityReason).toMatch(/regression-exposure/);
    expect(out[0].severityReason).toMatch(/not proof of regression/i);
  });
});
