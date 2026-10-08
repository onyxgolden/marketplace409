import { describe, expect, it } from "vitest";
import { formatTriageHandoffDraft } from "../formatHandoffDraft.mjs";

const packet = {
  id: "coverage:dark-cap",
  current: {
    what: 'Runtime capability "Dark" is uncovered.',
    severity: "critical",
    severityReason: "base:high; moves_money:+1 (priority only, not a defect claim)",
    triageState: "needs-review",
    confidence: "high",
    lastSeen: null,
    moneyMoving: true,
    moneyNote: "Money-moving capability: higher review sensitivity. This does NOT assert a defect.",
    monitoringStatus: "uncovered",
    evidenceState: "present",
    evidenceLinks: [{ label: "registry", ref: "scripts/engineering-brain/runtimeCoverageRegistry.mjs" }],
    nextStep: "Verify manually.",
  },
  historical: {
    note: "Historical context only. None of the following proves a current defect.",
    indexRevision: { commitSha: "abc123", generatedAt: "2026-10-08T00:00:00Z", state: "confirmed" },
    repairedDefects: [
      { sha: "aaa111", shortSha: "aaa111", subject: "Fix payments bug", pr: 100, date: "2026-10-01" },
    ],
    repairedDefectsNote: "Context for extra scrutiny, not evidence of a current defect.",
    regressionExposures: [],
    regressionNote: null,
  },
  provenance: {
    packetBuiltFrom: "engineering-brain health snapshot",
    findingId: "coverage:dark-cap",
    findingKind: "coverage-gap",
  },
};

describe("formatTriageHandoffDraft", () => {
  it("preserves current-vs-historical distinction in the draft", () => {
    const draft = formatTriageHandoffDraft({ packet });
    expect(draft).toMatch(/Current evidence/);
    expect(draft).toMatch(/Historical context/);
    expect(draft).toMatch(/not proof of a current defect/i);
    // Current section comes before historical
    expect(draft.indexOf("Current evidence")).toBeLessThan(draft.indexOf("Historical context"));
  });

  it("includes severity, triage state, and money flag", () => {
    const draft = formatTriageHandoffDraft({ packet });
    expect(draft).toMatch(/critical/);
    expect(draft).toMatch(/needs-review/);
    expect(draft).toMatch(/Money-moving: yes/);
  });

  it("is preview/copy only — contains draft disclaimer, no post/assign language", () => {
    const draft = formatTriageHandoffDraft({ packet });
    expect(draft).toMatch(/Draft only.*preview\/copy\/export/i);
    expect(draft).toMatch(/Nothing has been posted or assigned/);
    const lower = draft.toLowerCase();
    expect(lower).not.toMatch(/posted to github|created issue|assigned to|triggered/);
  });

  it("includes open questions when provided", () => {
    const draft = formatTriageHandoffDraft({ packet, openQuestions: ["Is this acceptable?"] });
    expect(draft).toMatch(/Is this acceptable\?/);
  });

  it("handles missing packet gracefully", () => {
    expect(formatTriageHandoffDraft({})).toMatch(/No triage item selected/);
    expect(formatTriageHandoffDraft({ packet: null })).toMatch(/No triage item selected/);
  });

  it("never claims resolved, broken, or root cause", () => {
    const draft = formatTriageHandoffDraft({ packet }).toLowerCase();
    expect(draft).not.toMatch(/resolved|broken|root cause|regression detected/);
  });

  it("is a pure string return with no side effects", () => {
    const a = formatTriageHandoffDraft({ packet });
    const b = formatTriageHandoffDraft({ packet });
    // Drafted timestamp differs, but structure is identical — strip it
    const strip = (s) => s.replace(/Drafted: .*/, "Drafted: X");
    expect(strip(a)).toBe(strip(b));
    expect(typeof a).toBe("string");
  });
});
