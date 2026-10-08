import { describe, expect, it } from "vitest";
import { buildEvidencePacket } from "../buildEvidencePacket.mjs";

const item = {
  id: "coverage:dark-cap",
  kind: "coverage-gap",
  what: 'Runtime capability "Dark" is uncovered.',
  subsystem: "src/payments.js, src/ledger.js",
  whyItMatters: "Failures would be silent.",
  confidence: "high",
  lastSeen: null,
  evidenceLinks: [{ label: "registry", ref: "scripts/engineering-brain/runtimeCoverageRegistry.mjs" }],
  nextStep: "Verify manually.",
  severity: "critical",
  severityReason: "base:high; moves_money:+1 (priority only, not a defect claim)",
  triageState: "needs-review",
};

const capabilities = [
  { id: "dark-cap", name: "Dark", monitoring_status: "uncovered", moves_money: true, execution_path: "cron" },
];

const health = {
  index: { commitSha: "abc123def456", generatedAt: "2026-10-08T00:00:00Z", state: "confirmed" },
};

const bugCatalog = [
  { sha: "aaa111", date: "2026-10-01", subject: "Fix payments bug", pr: 100, files: ["src/payments.js"] },
  { sha: "bbb222", date: "2026-09-01", subject: "Fix unrelated", pr: 101, files: ["src/other.js"] },
];

const exposures = [
  {
    matchedFiles: ["src/payments.js"],
    priorFix: { sha: "aaa111", shortSha: "aaa111", subject: "Fix payments bug", pr: 100, date: "2026-10-01" },
    revision: "main",
  },
];

describe("buildEvidencePacket", () => {
  it("separates current evidence from historical context", () => {
    const p = buildEvidencePacket({ item, health, capabilities, exposures, bugCatalog });
    expect(p.current).toBeDefined();
    expect(p.historical).toBeDefined();
    // Current has the triage-relevant fields
    expect(p.current.severity).toBe("critical");
    expect(p.current.triageState).toBe("needs-review");
    expect(p.current.moneyMoving).toBe(true);
    // Historical is explicitly labeled as background
    expect(p.historical.note).toMatch(/proves a current defect/i);
  });

  it("flags money-moving without claiming a defect", () => {
    const p = buildEvidencePacket({ item, health, capabilities, exposures, bugCatalog });
    expect(p.current.moneyMoving).toBe(true);
    expect(p.current.moneyNote).toMatch(/does NOT assert a defect/i);
    const text = JSON.stringify(p.current);
    expect(text.toLowerCase()).not.toMatch(/broken|regression detected|root cause/);
  });

  it("includes related repaired defects as historical context only", () => {
    const p = buildEvidencePacket({ item, health, capabilities, exposures, bugCatalog });
    expect(p.historical.repairedDefects.length).toBe(1);
    expect(p.historical.repairedDefects[0].sha).toBe("aaa111");
    expect(p.historical.repairedDefectsNote).toMatch(/not evidence of a current defect/i);
  });

  it("includes regression exposures as advisory only", () => {
    const p = buildEvidencePacket({ item, health, capabilities, exposures, bugCatalog });
    expect(p.historical.regressionExposures.length).toBe(1);
    expect(p.historical.regressionNote).toMatch(/does NOT mean the defect has returned/i);
  });

  it("preserves provenance and index revision", () => {
    const p = buildEvidencePacket({ item, health, capabilities, exposures, bugCatalog });
    expect(p.provenance.findingId).toBe("coverage:dark-cap");
    expect(p.provenance.findingKind).toBe("coverage-gap");
    expect(p.historical.indexRevision.commitSha).toBe("abc123def456");
    expect(p.historical.indexRevision.state).toBe("confirmed");
  });

  it("shows unavailable evidence explicitly, never silently omits", () => {
    const evItem = { ...item, id: "evidence:x", kind: "evidence-unavailable", severity: "high", triageState: "evidence-unavailable" };
    const p = buildEvidencePacket({ item: evItem, health: null, capabilities: [], exposures: [], bugCatalog: [] });
    expect(p.current.evidenceState).toBe("unavailable");
    expect(p.historical.indexRevision).toBeNull();
  });

  it("handles missing item gracefully", () => {
    const p = buildEvidencePacket({ item: null });
    expect(p.error).toBeDefined();
    expect(p.current).toBeNull();
  });

  it("never uses resolved language", () => {
    const p = buildEvidencePacket({ item, health, capabilities, exposures, bugCatalog });
    const text = JSON.stringify(p).toLowerCase();
    expect(text).not.toMatch(/"resolved"/);
  });
});
