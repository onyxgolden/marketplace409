// D668-009 probe — red is not reserved at the final resolved pipe-color
// boundary. An ordinary process run with color #dc2626 renders #dc2626;
// recoloring Relief alone does not cover imported/custom/override
// colors.
//
// These probes FAIL against the current implementation and must PASS
// after the fix: ONE shared semantic final-color policy across plan,
// print, 3D, and legends — firewater renders its red; any other red
// resolving on a non-firewater pipe is remapped off the red band.
// Selection/error/hover highlighting never paints non-firewater pipes
// red (separate highlight treatment). Arbitrary non-firewater red
// overrides are frozen as remapped; firewater positives stay red; the
// before/after color-resolution map is exposed for evidence.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  resetDesignerIds,
  setMemberColor,
} from "../designerDocument";
import {
  finalPipeColor,
  isReservedRed,
  pipeColorResolutionMap,
  FIREWATER_RESERVED_RED,
} from "../pipeColorPolicy";
import { pipeDescriptors } from "../designerThreeModel";

beforeEach(() => {
  resetDesignerIds();
});

function redOverrideDesign() {
  let design = createEmptyDesign();
  design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], {
    id: "process-red",
    diameterIn: 2,
  });
  design = setMemberColor(design, { kind: "pipe", id: "process-red" }, "#dc2626");
  design = addPipeRun(design, [{ x: 0, y: 100 }, { x: 100, y: 100 }], {
    id: "fw",
    diameterIn: 12,
    utility: "firewater",
  });
  return design;
}

describe("D668-009 red reservation at the final resolved color", () => {
  it("an arbitrary non-firewater red override does NOT resolve red", () => {
    const design = redOverrideDesign();
    const run = design.pipes.find((p) => p.id === "process-red");
    const resolved = finalPipeColor(design, run);
    expect(isReservedRed(resolved)).toBe(false);
    expect(resolved.toLowerCase()).not.toBe(FIREWATER_RESERVED_RED);
  });

  it("firewater still resolves to the reserved red (positive)", () => {
    const design = redOverrideDesign();
    const run = design.pipes.find((p) => p.id === "fw");
    expect(finalPipeColor(design, run).toLowerCase()).toBe(FIREWATER_RESERVED_RED);
  });

  it("the 3D descriptors honor the same policy", () => {
    const design = redOverrideDesign();
    const descriptors = pipeDescriptors(design);
    const proc = descriptors.find((p) => p.id === "process-red");
    const fw = descriptors.find((p) => p.id === "fw");
    expect(isReservedRed(proc.color)).toBe(false);
    expect(fw.color.toLowerCase()).toBe(FIREWATER_RESERVED_RED);
  });

  it("the before/after resolution map records the remap", () => {
    const design = redOverrideDesign();
    const map = pipeColorResolutionMap(design);
    const row = map.find((r) => r.runId === "process-red");
    expect(row.requested.toLowerCase()).toBe("#dc2626");
    expect(isReservedRed(row.resolved)).toBe(false);
    const fwRow = map.find((r) => r.runId === "fw");
    expect(fwRow.resolved.toLowerCase()).toBe(FIREWATER_RESERVED_RED);
  });

  it("a non-red custom color is untouched", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { id: "blue" });
    design = setMemberColor(design, { kind: "pipe", id: "blue" }, "#2563eb");
    const run = design.pipes.find((p) => p.id === "blue");
    expect(finalPipeColor(design, run).toLowerCase()).toBe("#2563eb");
  });
});
