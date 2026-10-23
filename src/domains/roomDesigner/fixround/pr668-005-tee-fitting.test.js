// PR668-005 probe — pipe-to-pipe "tees" have no tee fitting body or
// ports: a junction is only a branch connection plus a flange pair. The
// binding scope required an actual branch fitting with ports.
//
// These probes FAIL against the current implementation (`teeFittings`
// does not exist) and must PASS after the fix: every modeled junction
// yields a tee fitting with a stable id, a fitting body, and three
// stable ports (branch + two host sides), coherent across attach,
// detach, resize, copy, and save/reload round-trips.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  resetDesignerIds,
  serializeDesign,
  parseDesign,
} from "../designerDocument";
import { teeFittings } from "../pipeAttachments";

beforeEach(() => {
  resetDesignerIds();
});

function teeDesign() {
  let design = createEmptyDesign();
  design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], {
    id: "host",
    diameterIn: 2,
    elevationIn: 150,
  });
  design = addPipeRun(design, [{ x: 50, y: 0 }, { x: 50, y: 60 }], {
    id: "branch",
    diameterIn: 2,
    elevationIn: 150,
  });
  const pipes = design.pipes.map((p) =>
    p.id === "branch" ? { ...p, junctions: { start: { runId: "host" } } } : p,
  );
  return { ...design, pipes };
}

describe("PR668-005 tee fitting body and ports", () => {
  it("a modeled junction yields a tee fitting with a body and three ports", () => {
    const fittings = teeFittings(teeDesign());
    expect(fittings).toHaveLength(1);
    const [tee] = fittings;
    expect(tee.id).toBe("tee-branch-start");
    expect(tee.branchRunId).toBe("branch");
    expect(tee.hostRunId).toBe("host");
    expect(tee.body).toBeDefined();
    expect(tee.ports).toHaveLength(3);
    const kinds = tee.ports.map((p) => p.port).sort();
    expect(kinds).toEqual(["branch", "host-a", "host-b"]);
    for (const port of tee.ports) {
      expect(port.id).toBe(`${tee.id}::${port.port}`);
      expect(Number.isFinite(port.x)).toBe(true);
      expect(Number.isFinite(port.y)).toBe(true);
      expect(Number.isFinite(port.elevationIn)).toBe(true);
      expect(port.sizeIn).toBe(2);
    }
  });

  it("detaching the junction removes the tee fitting", () => {
    const design = teeDesign();
    const pipes = design.pipes.map((p) => (p.id === "branch" ? { ...p, junctions: undefined } : p));
    expect(teeFittings({ ...design, pipes })).toEqual([]);
  });

  it("the fitting survives a save/reload round-trip with stable ids", () => {
    const design = teeDesign();
    const before = teeFittings(design);
    const reloaded = parseDesign(serializeDesign(design));
    const after = teeFittings(reloaded);
    expect(after.map((t) => t.id)).toEqual(before.map((t) => t.id));
    expect(after[0].ports.map((p) => p.id)).toEqual(before[0].ports.map((p) => p.id));
  });

  it("an end-to-end coupled joint is a fitting too, with two ports", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 50, y: 0 }], {
      id: "a",
      diameterIn: 2,
      elevationIn: 150,
    });
    design = addPipeRun(design, [{ x: 50, y: 0 }, { x: 100, y: 0 }], {
      id: "b",
      diameterIn: 2,
      elevationIn: 150,
    });
    const pipes = design.pipes.map((p) =>
      p.id === "b" ? { ...p, junctions: { start: { runId: "a" } } } : p,
    );
    const fittings = teeFittings({ ...design, pipes });
    expect(fittings).toHaveLength(1);
    expect(fittings[0].ports).toHaveLength(2);
  });
});
