import { describe, expect, it } from "vitest";
import { AUTHORITY_LEVELS, AUTHORITY_LEVELS_BY_RANK } from "../authorityLevels.mjs";
import { buildIndexRecords } from "../buildIndexRecords.mjs";

describe("authority ranking", () => {
  it("encodes Jason's exact 6-tier order, current code first, historical snapshots last", () => {
    expect(AUTHORITY_LEVELS_BY_RANK.map((l) => l.id)).toEqual([
      "current",
      "validation_evidence",
      "governance_state",
      "synchronized_document",
      "reviewed_decision",
      "historical_snapshot",
    ]);
  });

  it("ranks are strictly increasing with no gaps or duplicates", () => {
    const ranks = AUTHORITY_LEVELS_BY_RANK.map((l) => l.rank);
    expect(ranks).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("assigns authority_level per source type consistent with the defined order", () => {
    const files = [
      { path: "src/lib/foo.js", blobSha: "a", content: "export const x = 1;" },
      { path: "governance/state/current-governance-state.json", blobSha: "b", content: "{}" },
      { path: "docs/architecture/synchronized/FORGE_SYNC_STATUS.md", blobSha: "c", content: "<!-- FORGE:SYNC:s:START -->x<!-- FORGE:SYNC:s:END -->" },
      { path: "docs/architecture/lessons-learned/foo.md", blobSha: "d", content: "lesson" },
      { path: "governance/snapshots/forge-session-1.json", blobSha: "e", content: "{}" },
      { path: "governance/validation/forge-validation-1.json", blobSha: "f", content: "{}" },
    ];
    const { records } = buildIndexRecords({ commitSha: "sha", files });

    const levelFor = (sourceType) => records.find((r) => r.source_type === sourceType)?.authority_level;
    expect(levelFor("application_source_file")).toBe(AUTHORITY_LEVELS.CURRENT.id);
    expect(levelFor("governance_state")).toBe(AUTHORITY_LEVELS.GOVERNANCE_STATE.id);
    expect(levelFor("synchronized_document_section")).toBe(AUTHORITY_LEVELS.SYNCHRONIZED_DOCUMENT.id);
    expect(levelFor("reviewed_decision")).toBe(AUTHORITY_LEVELS.REVIEWED_DECISION.id);
    expect(levelFor("historical_snapshot")).toBe(AUTHORITY_LEVELS.HISTORICAL_SNAPSHOT.id);
    expect(levelFor("validation_evidence")).toBe(AUTHORITY_LEVELS.VALIDATION_EVIDENCE.id);
  });
});
