import { describe, expect, it } from "vitest";
import { detectConflicts } from "../detectConflicts.mjs";

function entry(record) {
  return { record, matchSignals: {}, freshness: "current" };
}

describe("detectConflicts (conflicting-source detection)", () => {
  it("flags a conflict when two different authority tiers describe the same subject with different content", () => {
    const entries = [
      entry({ source_path: "docs/lessons.md", symbol_or_section: "bootstrap_owner", authority_level: "reviewed_decision", content_hash: "old-hash" }),
      entry({ source_path: "src/lib/bootstrap.js", symbol_or_section: "bootstrap_owner", authority_level: "current", content_hash: "new-hash" }),
    ];
    const conflicts = detectConflicts(entries);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].winner.authority_level).toBe("current");
    expect(conflicts[0].outranked[0].authority_level).toBe("reviewed_decision");
  });

  it("identifies which source outranks the other using the authority order, not arbitrary order", () => {
    const entries = [
      entry({ source_path: "a", symbol_or_section: "subject", authority_level: "historical_snapshot", content_hash: "h1" }),
      entry({ source_path: "b", symbol_or_section: "subject", authority_level: "current", content_hash: "h2" }),
      entry({ source_path: "c", symbol_or_section: "subject", authority_level: "governance_state", content_hash: "h3" }),
    ];
    const conflicts = detectConflicts(entries);
    expect(conflicts[0].winner.source_path).toBe("b");
    expect(conflicts[0].outranked.map((o) => o.source_path)).toEqual(["c", "a"]);
  });

  it("does not report a conflict when two records on the same subject agree (identical content_hash)", () => {
    const entries = [
      entry({ source_path: "a", symbol_or_section: "subject", authority_level: "current", content_hash: "same" }),
      entry({ source_path: "b", symbol_or_section: "subject", authority_level: "validation_evidence", content_hash: "same" }),
    ];
    expect(detectConflicts(entries)).toEqual([]);
  });

  it("does not report a conflict for two records on different subjects, even at different authority levels", () => {
    const entries = [
      entry({ source_path: "a", symbol_or_section: "subjectA", authority_level: "current", content_hash: "h1" }),
      entry({ source_path: "b", symbol_or_section: "subjectB", authority_level: "historical_snapshot", content_hash: "h2" }),
    ];
    expect(detectConflicts(entries)).toEqual([]);
  });

  it("does not report a conflict for two records at the SAME authority level with different content -- that's not a conflict this tool can resolve, only a cross-tier one", () => {
    const entries = [
      entry({ source_path: "a", symbol_or_section: "subject", authority_level: "current", content_hash: "h1" }),
      entry({ source_path: "b", symbol_or_section: "subject", authority_level: "current", content_hash: "h2" }),
    ];
    expect(detectConflicts(entries)).toEqual([]);
  });
});
