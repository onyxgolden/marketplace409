// D668-004 probe — junction IDs authorize supply without physical
// contact. Exact shapes from the finding:
//   - plant-water source at (0,0)-(10,0) and a branch at
//     (900,900)-(1000,900), both at elev 24: "supplied" when the branch
//     names the source in its junction record — 900 in away, no contact.
//   - no-host-segment falls back to the FIRST host segment instead of
//     refusing (stale/off-route reference).
//   - a plan T at elevations 30/32 is accepted by barrel-overlap
//     tolerance instead of matching connection faces.
//
// These probes FAIL against the current implementation and must PASS
// after the fix: graph edges ONLY from validated physical interfaces
// (target existence, position, elevation, face orientation, compatible
// ports). Stale/off-route references prove nothing.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  resetDesignerIds,
} from "../designerDocument";
import {
  pipeConnectionGraph,
  runReachesSource,
  runPathToSource,
} from "../pipeCrossings";
import { connectionCompatibilityErrors } from "../pipeAttachments";

beforeEach(() => {
  resetDesignerIds();
});

function remoteJunctionDesign() {
  let design = createEmptyDesign();
  design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 10, y: 0 }], {
    id: "source",
    diameterIn: 2,
    elevationIn: 24,
    utility: "plant-water",
    sourceOf: "plant-water",
  });
  design = addPipeRun(design, [{ x: 900, y: 900 }, { x: 1000, y: 900 }], {
    id: "branch",
    diameterIn: 1,
    elevationIn: 24,
    utility: "plant-water",
  });
  // The branch NAMES the source in its junction record — 900 in away,
  // no physical contact whatsoever.
  const pipes = design.pipes.map((p) =>
    p.id === "branch" ? { ...p, junctions: { start: { runId: "source" } } } : p,
  );
  return { ...design, pipes };
}

describe("D668-004 junction graph: validated physical interfaces only", () => {
  it("a remote junction record does not create a supply edge", () => {
    const design = remoteJunctionDesign();
    const graph = pipeConnectionGraph(design);
    expect(graph.get("branch")?.has("source") ?? false).toBe(false);
  });

  it("a remote junction record does not authorize supply", () => {
    const design = remoteJunctionDesign();
    expect(runReachesSource(design, "branch", "plant-water")).toBe(false);
    expect(runPathToSource(design, "branch", "plant-water")).toBeNull();
  });

  it("a stale junction (host has no segment under the end) is a named error, not a fallback", () => {
    const design = remoteJunctionDesign();
    const errors = connectionCompatibilityErrors(design);
    expect(errors.some((e) => /stale|does not touch|no.*contact/i.test(e))).toBe(true);
  });

  it("a plan T at elevations 30/32 is NOT a face-matched connection", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], {
      id: "host",
      diameterIn: 2,
      elevationIn: 30,
    });
    design = addPipeRun(design, [{ x: 50, y: 0 }, { x: 50, y: 60 }], {
      id: "branch",
      diameterIn: 2,
      elevationIn: 32,
    });
    const pipes = design.pipes.map((p) =>
      p.id === "branch" ? { ...p, junctions: { start: { runId: "host" } } } : p,
    );
    const withJ = { ...design, pipes };
    // Not a supply edge: faces are 2 in apart, beyond face tolerance.
    expect(pipeConnectionGraph(withJ).get("branch")?.has("host") ?? false).toBe(false);
    // And compatibility flags the elevation mismatch at the joint.
    const errors = connectionCompatibilityErrors(withJ);
    expect(errors.some((e) => /elevation/i.test(e))).toBe(true);
  });

  it("a genuine face-matched tee IS an edge (positive partner)", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], {
      id: "host",
      diameterIn: 2,
      elevationIn: 30,
    });
    design = addPipeRun(design, [{ x: 50, y: 0 }, { x: 50, y: 60 }], {
      id: "branch",
      diameterIn: 2,
      elevationIn: 30,
    });
    const pipes = design.pipes.map((p) =>
      p.id === "branch" ? { ...p, junctions: { start: { runId: "host" } } } : p,
    );
    const withJ = { ...design, pipes };
    expect(pipeConnectionGraph(withJ).get("branch")?.has("host") ?? false).toBe(true);
    expect(connectionCompatibilityErrors(withJ)).toEqual([]);
  });
});
