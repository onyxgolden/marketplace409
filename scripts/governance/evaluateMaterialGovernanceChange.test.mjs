import { describe, expect, it } from "vitest";
import {
  GOVERNANCE_POINTER_TRACKED_PATHS,
  evaluateMaterialGovernanceChange,
  stripSnapshotBookkeeping,
} from "./evaluateMaterialGovernanceChange.mjs";

const STATE_PATH = "governance/state/current-governance-state.json";
const STATUS_PATH = "docs/architecture/synchronized/FORGE_SYNC_STATUS.md";
const ROADMAP_PATH = "docs/architecture/synchronized/FORGE_SYNC_ROADMAP.md";

function stateFixture({ snapshot = "forge-session-20260812-013433938.json", objective = "Ship: collect complete closeout validation" } = {}) {
  return JSON.stringify({
    schemaVersion: "1.0",
    session: {
      latestSnapshot: `governance/snapshots/${snapshot}`,
      lastUpdated: "2026-08-12T06:34:33.938Z",
    },
    state: {
      currentObjective: objective,
      knownWarnings: [],
    },
    synchronization: {
      mode: "shadow",
      stateGeneratedAt: null,
      sourceSnapshot: `governance/snapshots/${snapshot}`,
      rendererVersion: null,
    },
  }, null, 2);
}

function statusFixture({ snapshot = "forge-session-20260812-013433938.json", objectiveBody = "Ship: collect complete closeout validation." } = {}) {
  return [
    "# FORGE Synchronizer Status",
    "",
    "<!-- FORGE:SYNC:synchronization_metadata:START -->",
    "## Synchronization Metadata",
    "**Last Synchronization:** Not yet generated",
    `**Evidence Snapshot:** governance/snapshots/${snapshot}`,
    "<!-- FORGE:SYNC:synchronization_metadata:END -->",
    "",
    "<!-- FORGE:SYNC:current_objective:START -->",
    "## Immediate Objective",
    "",
    objectiveBody,
    "<!-- FORGE:SYNC:current_objective:END -->",
    "",
    "<!-- FORGE:HUMAN:architectural_direction:START -->",
    "## Architectural Direction",
    "",
    "Architectural direction remains human-controlled during the shadow evaluation period.",
    "This process creates a snapshot for review before anything is promoted.",
    "<!-- FORGE:HUMAN:architectural_direction:END -->",
    "",
  ].join("\n");
}

describe("stripSnapshotBookkeeping", () => {
  it("removes the latestSnapshot and sourceSnapshot JSON fields", () => {
    const stripped = stripSnapshotBookkeeping(stateFixture());
    expect(stripped).not.toContain("latestSnapshot");
    expect(stripped).not.toContain("sourceSnapshot");
    expect(stripped).not.toContain("forge-session-20260812-013433938.json");
  });

  it("removes the Evidence Snapshot markdown line", () => {
    const stripped = stripSnapshotBookkeeping(statusFixture());
    expect(stripped).not.toContain("**Evidence Snapshot:**");
    expect(stripped).not.toContain("forge-session-20260812-013433938.json");
  });

  it("does not alter a FORGE:HUMAN-fenced section, even when it contains the word 'snapshot' in prose", () => {
    const stripped = stripSnapshotBookkeeping(statusFixture());
    expect(stripped).toContain("<!-- FORGE:HUMAN:architectural_direction:START -->");
    expect(stripped).toContain("Architectural direction remains human-controlled during the shadow evaluation period.");
    expect(stripped).toContain("This process creates a snapshot for review before anything is promoted.");
  });

  it("does not alter the Immediate Objective section body", () => {
    const stripped = stripSnapshotBookkeeping(statusFixture());
    expect(stripped).toContain("## Immediate Objective");
    expect(stripped).toContain("Ship: collect complete closeout validation.");
  });
});

describe("evaluateMaterialGovernanceChange", () => {
  it("scenario A: reports no material change when only the snapshot pointer differs", () => {
    const beforeContents = {
      [STATE_PATH]: stateFixture({ snapshot: "forge-session-20260812-013433938.json" }),
      [STATUS_PATH]: statusFixture({ snapshot: "forge-session-20260812-013433938.json" }),
    };
    const afterContents = {
      [STATE_PATH]: stateFixture({ snapshot: "forge-session-20260826-180000000.json" }),
      [STATUS_PATH]: statusFixture({ snapshot: "forge-session-20260826-180000000.json" }),
    };

    const result = evaluateMaterialGovernanceChange({ beforeContents, afterContents });

    expect(result).toEqual({ materialChangeDetected: false, changedFiles: [] });
  });

  it("scenario B: reports a material change when real content differs, alongside the pointer", () => {
    const beforeContents = {
      [STATE_PATH]: stateFixture({ snapshot: "forge-session-20260812-013433938.json" }),
      [STATUS_PATH]: statusFixture({ snapshot: "forge-session-20260812-013433938.json" }),
    };
    const afterContents = {
      [STATE_PATH]: stateFixture({ snapshot: "forge-session-20260826-180000000.json", objective: "Ship: nightly governance automation" }),
      [STATUS_PATH]: statusFixture({ snapshot: "forge-session-20260826-180000000.json", objectiveBody: "Ship: nightly governance automation." }),
    };

    const result = evaluateMaterialGovernanceChange({ beforeContents, afterContents });

    expect(result.materialChangeDetected).toBe(true);
    expect(result.changedFiles).toEqual([STATE_PATH, STATUS_PATH]);
  });

  it("treats a missing tracked path as empty content on either side (no throw)", () => {
    const result = evaluateMaterialGovernanceChange({ beforeContents: {}, afterContents: {} });
    expect(result).toEqual({ materialChangeDetected: false, changedFiles: [] });
  });

  it("all 6 tracked files changing only their pointer line simultaneously still reports no material change", () => {
    const before = Object.fromEntries(GOVERNANCE_POINTER_TRACKED_PATHS.map((path) =>
      [path, path === STATE_PATH ? stateFixture({ snapshot: "forge-session-20260812-013433938.json" }) : statusFixture({ snapshot: "forge-session-20260812-013433938.json" })],
    ));
    const after = Object.fromEntries(GOVERNANCE_POINTER_TRACKED_PATHS.map((path) =>
      [path, path === STATE_PATH ? stateFixture({ snapshot: "forge-session-20260826-180000000.json" }) : statusFixture({ snapshot: "forge-session-20260826-180000000.json" })],
    ));

    const result = evaluateMaterialGovernanceChange({ beforeContents: before, afterContents: after });

    expect(result).toEqual({ materialChangeDetected: false, changedFiles: [] });
  });

  it("only flags the specific file(s) whose real content changed, not the whole tracked set", () => {
    const beforeContents = {
      [STATE_PATH]: stateFixture(),
      [STATUS_PATH]: statusFixture(),
      [ROADMAP_PATH]: "# FORGE Synchronizer Roadmap\n\nUnchanged roadmap content.\n",
    };
    const afterContents = {
      [STATE_PATH]: stateFixture({ snapshot: "forge-session-20260826-180000000.json" }),
      [STATUS_PATH]: statusFixture({ snapshot: "forge-session-20260826-180000000.json" }),
      [ROADMAP_PATH]: "# FORGE Synchronizer Roadmap\n\nUnchanged roadmap content.\n",
    };

    const result = evaluateMaterialGovernanceChange({ beforeContents, afterContents });

    expect(result).toEqual({ materialChangeDetected: false, changedFiles: [] });
  });
});
