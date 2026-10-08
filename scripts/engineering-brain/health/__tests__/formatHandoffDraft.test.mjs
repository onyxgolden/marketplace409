import { describe, expect, it } from "vitest";
import { formatHandoffDraft } from "../formatHandoffDraft.mjs";

const findings = [
  {
    what: "Capability X is uncovered.",
    subsystem: "cron",
    whyItMatters: "Silent failures.",
    confidence: "high",
    lastSeen: null,
    evidenceLinks: [{ label: "registry", ref: "registry.mjs" }],
    nextStep: "Verify manually.",
  },
];

describe("formatHandoffDraft", () => {
  it("is pure: returns a string, performs no I/O", () => {
    const out = formatHandoffDraft({ findings });
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("contains all expected sections", () => {
    const out = formatHandoffDraft({
      title: "Test handoff",
      context: "Review this.",
      findings,
      reproSteps: ["Run it"],
      affectedFiles: ["a.js"],
      affectedCommits: ["abc123"],
      openQuestions: ["Is this ok?"],
      requestedBy: "tester",
    });
    expect(out).toMatch(/# Test handoff/);
    expect(out).toMatch(/Requested by: tester/);
    expect(out).toMatch(/## Context/);
    expect(out).toMatch(/## Evidence-linked findings/);
    expect(out).toMatch(/## Reproducible steps/);
    expect(out).toMatch(/## Affected files/);
    expect(out).toMatch(/## Affected commits/);
    expect(out).toMatch(/## Open questions for the reviewer/);
    expect(out).toMatch(/Is this ok\?/);
  });

  it("marks itself as draft-only with no side effects", () => {
    const out = formatHandoffDraft({});
    expect(out).toMatch(/draft only/i);
    // The disclaimer explicitly states nothing was posted/assigned — that's the
    // safety language, not a side effect. Verify no action verbs implying writes.
    expect(out.toLowerCase()).not.toMatch(/has been (sent|published|created|opened)/);
    expect(out.toLowerCase()).not.toMatch(/triggering (Muse|claude|agents)/);
  });

  it("handles empty inputs gracefully", () => {
    const out = formatHandoffDraft({});
    expect(typeof out).toBe("string");
    expect(out).toMatch(/_none_/);
  });

  it("is deterministic for the same input (except timestamp line)", () => {
    const a = formatHandoffDraft({ findings }).split("\n").filter((l) => !l.startsWith("Drafted:"));
    const b = formatHandoffDraft({ findings }).split("\n").filter((l) => !l.startsWith("Drafted:"));
    expect(a).toEqual(b);
  });
});
