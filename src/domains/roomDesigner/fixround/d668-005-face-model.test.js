// D668-005 probe — generic nozzle faces vs pipe attachments disagree in
// 3D. Generic catalog anchors omit elevation and normal, so compatibility
// skips elevation checking; the 3D helper draws the flange from its own
// heuristic. Exact shape from the finding: the standard 120-in vertical
// vessel's top-out nozzle accepts an 8-in pipe endpoint at elevation 30
// with no errors, while the 3D helper draws the top flange at 126.
//
// These probes FAIL against the current implementation and must PASS
// after the fix: ONE shared 3D connection-face model for snap,
// reconcile, validation, and rendering. Flange-face contact is proven for
// top, side, base-utility, rotated, and resized equipment.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "../designerDocument";
import { findSymbol } from "../symbolRegistry";
import { anchorsOf, connectionCompatibilityErrors, connectionFaceForAnchor } from "../pipeAttachments";

beforeEach(() => {
  resetDesignerIds();
});

function vesselDesign(patch = {}) {
  let design = createEmptyDesign();
  design = placeSymbol(design, "processEquipment", "vertical-vessel", 500, 500, {
    id: "v-1",
    tag: "V-101",
    ...patch,
  });
  return design;
}

describe("D668-005 shared 3D connection-face model", () => {
  it("every generic anchor carries an elevation and an outward normal", () => {
    const design = vesselDesign();
    const inst = design.symbols[0];
    const symbol = findSymbol(inst.domain, inst.symbolId);
    for (const anchor of anchorsOf(inst)) {
      const face = connectionFaceForAnchor(symbol, inst, anchor.id);
      expect(Number.isFinite(face.elevationIn)).toBe(true);
      if (face.vertical) {
        expect(face.normal).toBeNull();
      } else {
        expect(face.normal).toBeDefined();
        expect(Math.hypot(face.normal.x, face.normal.y)).toBeCloseTo(1, 6);
      }
    }
  });

  it("the top nozzle face sits at the flange face (base + height + neck)", () => {
    const design = vesselDesign();
    const inst = design.symbols[0];
    const symbol = findSymbol(inst.domain, inst.symbolId);
    const face = connectionFaceForAnchor(symbol, inst, "top-out");
    // 120-in vessel + 6-in nozzle neck: the flange the 3D view draws.
    expect(face.elevationIn).toBeCloseTo(126, 9);
    expect(face.x).toBeCloseTo(500, 9);
    expect(face.y).toBeCloseTo(500, 9);
    expect(face.vertical).toBe(true);
  });

  it("an 8-in endpoint at elevation 30 on the 120-in top nozzle is REJECTED", () => {
    let design = vesselDesign();
    design = addPipeRun(design, [{ x: 800, y: 500 }, { x: 500, y: 500 }], {
      id: "to-top",
      diameterIn: 8,
      elevationIn: 30,
    });
    const pipes = design.pipes.map((p) =>
      p.id === "to-top"
        ? { ...p, attachments: { end: { symbolId: "v-1", anchorId: "top-out" } } }
        : p,
    );
    design = { ...design, pipes };
    const errors = connectionCompatibilityErrors(design);
    expect(errors.some((e) => /elevation/i.test(e))).toBe(true);
  });

  it("the shared face model and the 3D nozzle-flange descriptors agree", async () => {
    const { nozzleFlangeDescriptors } = await import("../designerThreeModel");
    const design = vesselDesign();
    const inst = design.symbols[0];
    const symbol = findSymbol(inst.domain, inst.symbolId);
    const descriptors = nozzleFlangeDescriptors(design, "v-1");
    const top = descriptors.find((d) => d.anchorId === "top-out");
    const face = connectionFaceForAnchor(symbol, inst, "top-out");
    // The 3D flange disc sits at the face the validation model checks.
    expect(top.yIn).toBeCloseTo(face.elevationIn, 6);
    expect(top.x).toBeCloseTo(face.x, 6);
    expect(top.z).toBeCloseTo(face.y, 6);
  });

  it("rotated and resized equipment keeps face contact consistent", () => {
    const design = vesselDesign({ rotationDeg: 90, widthIn: 60, depthIn: 60 });
    const inst = design.symbols[0];
    const symbol = findSymbol(inst.domain, inst.symbolId);
    const face = connectionFaceForAnchor(symbol, inst, "side-out");
    // side-out is fx=1: after a 90-deg rotation it points plan-south.
    expect(face.normal.x).toBeCloseTo(0, 6);
    expect(face.normal.y).toBeCloseTo(1, 6);
    expect(face.x).toBeCloseTo(500, 6);
    expect(face.y).toBeCloseTo(530, 6);
    expect(face.elevationIn).toBeGreaterThan(0);
  });

  it("base utility ports expose the shared face (elevation 24, outward normal)", async () => {
    const { utilityPortDescriptors } = await import("../utilityPiping");
    const design = vesselDesign();
    const inst = design.symbols[0];
    const symbol = findSymbol(inst.domain, inst.symbolId);
    const face = connectionFaceForAnchor(symbol, inst, "utility-plant-water");
    const ports = utilityPortDescriptors(symbol, inst);
    const port = ports.find((p) => p.id === "utility-plant-water");
    expect(face.elevationIn).toBeCloseTo(port.elevationIn, 9);
    expect(face.normal.x).toBeCloseTo(port.dirX, 9);
    expect(face.normal.y).toBeCloseTo(port.dirY, 9);
  });
});
