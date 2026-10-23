// R4 probe (PR #668 fix round 2) — grade, base, resized body, and head
// bounds disagree across consumers. ChatGPT's executed probes:
//   (a) a standard vessel at grade 12: the domain access package is
//       null (sill 18 above grade) yet the 3D component helper builds
//       a catwalk/ladder, because the viewport callsite drops the
//       design argument (grade datum);
//   (b) a column with height 240 / base 60: the body descriptor still
//       reports height 360 at the default base; the first platform
//       elevation is 180 while the first draw face remains 120 —
//       level faces and platforms live in different frames;
//   (c) the default 30-ft column's terminal manway reaches 384 while
//       the rendered stack form ends at 360: the validator's flat
//       24-in head allowance is not modeled geometry.
//
// These probes FAIL against the round-1 implementation and must PASS
// after the fix: one datum model — instance dimensions and base in
// the body descriptor, design threaded through view callers, level
// faces/manways/platforms in the same world frame, and terminal
// assemblies validated against the modeled head (rendered in 3D).

import { describe, expect, it, beforeEach } from "vitest";
import {
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "../designerDocument";
import { findSymbol } from "../symbolRegistry";
import { accessPackageWorld } from "../vesselAccess";
import {
  downcomerGeometryErrors,
  downcomerLevels,
  downcomerShellIntervalIn,
  modeledHeadHeightIn,
} from "../downcomers";
import { equipmentDescriptors } from "../designerThreeModel";
import { connectionFaceForAnchor } from "../pipeAttachments";
import { buildElevation } from "../homeSections";
import { createHomeProject, resetHomeProjectIds, updateLevelDesign } from "../homeProject";

beforeEach(() => {
  resetDesignerIds();
  resetHomeProjectIds();
});

function patched(design, id, patch) {
  return {
    ...design,
    symbols: design.symbols.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  };
}

describe("R4 datums agree across domain, descriptors, and views", () => {
  it("the body descriptor honors instance height and base elevation", () => {
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "column", 0, 0, { id: "c" });
    design = patched(design, "c", { heightIn: 240, baseElevationIn: 60 });
    const descriptor = equipmentDescriptors(design).find((e) => e.id === "c");
    expect(descriptor.heightIn).toBe(240);
    expect(descriptor.baseElevationIn).toBe(60);
  });

  it("downcomer level faces, manways, and platforms share the world frame", () => {
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "column", 0, 0, { id: "c" });
    design = patched(design, "c", { heightIn: 240, baseElevationIn: 60 });
    const symbol = findSymbol("processEquipment", "column");
    const inst = design.symbols.find((s) => s.id === "c");
    const levels = downcomerLevels(symbol, inst, design);
    expect(levels).toHaveLength(2);
    const first = levels[0];
    // Level 1 sits 120 in above the base; the base rides 60 in above
    // grade, so every world-frame reading of the level is 180.
    expect(first.elevationIn).toBe(180);
    expect(first.anchors[0].elevationIn).toBe(180);
    expect(first.manway.sillIn).toBe(180);
    expect(first.platform.deck.elevationIn).toBe(180);
    // The shared connection-face model reads the same world elevation.
    const face = connectionFaceForAnchor(symbol, inst, "downcomer-1-draw");
    expect(face.elevationIn).toBe(180);
  });

  it("the modeled head replaces the flat allowance: slender stack-form column", () => {
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "column", 0, 0, { id: "c" });
    const symbol = findSymbol("processEquipment", "column");
    const inst = design.symbols.find((s) => s.id === "c");
    // Catalog column: 36-in diameter, 360 in tall — the renderer draws
    // the slender stack form (no dished head), so the modeled head is 0.
    expect(modeledHeadHeightIn(symbol, inst)).toBe(0);
    expect(downcomerShellIntervalIn(symbol, inst).headAllowanceIn).toBe(0);
    // The terminal manway assembly (sill 360 + 24-in opening = 384)
    // does not fit the modeled shell/head: a named finding.
    expect(downcomerGeometryErrors(design).some((e) => /out-of-bounds/i.test(e))).toBe(true);
  });

  it("a tower-form column's terminal assembly fits its modeled dished head", () => {
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "column", 0, 0, { id: "c" });
    design = patched(design, "c", { widthIn: 96, depthIn: 96 });
    const symbol = findSymbol("processEquipment", "column");
    const inst = design.symbols.find((s) => s.id === "c");
    // r = 48; modeled dished head = 48 * 0.55 = 26.4 >= the 24 in the
    // terminal opening extends past the 360-in shell.
    expect(modeledHeadHeightIn(symbol, inst)).toBeCloseTo(26.4, 6);
    expect(downcomerGeometryErrors(design)).toEqual([]);
    // The 3D descriptor exposes the same modeled head.
    const descriptor = equipmentDescriptors(design).find((e) => e.id === "c");
    expect(descriptor.headIn).toBeCloseTo(26.4, 6);
  });

  it("an authored head is modeled geometry: it validates and is exposed to views", () => {
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "column", 0, 0, { id: "c" });
    design = patched(design, "c", { headIn: 30 });
    const symbol = findSymbol("processEquipment", "column");
    const inst = design.symbols.find((s) => s.id === "c");
    expect(downcomerShellIntervalIn(symbol, inst).headAllowanceIn).toBe(30);
    expect(downcomerGeometryErrors(design)).toEqual([]);
    const descriptor = equipmentDescriptors(design).find((e) => e.id === "c");
    expect(descriptor.headIn).toBe(30);
  });

  it("grade datum: the domain package is null at grade 12 (sill 18 above grade)", () => {
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "v" });
    design = { ...design, gradeElevationIn: 12 };
    const symbol = findSymbol("processEquipment", "vertical-vessel");
    const inst = design.symbols.find((s) => s.id === "v");
    expect(accessPackageWorld(symbol, inst, design)).toBeNull();
  });

  it("elevation sections place the manway sill in the world frame (base included)", () => {
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "v" });
    design = patched(design, "v", { baseElevationIn: 36 });
    let project = createHomeProject("Datum project", { units: "ft" });
    project = updateLevelDesign(project, project.levels[0].id, () => design);
    const result = buildElevation(project, { direction: "S" });
    expect(result.ok).toBe(true);
    const views = result.levels[0].accessViews || [];
    const manway = views.find((v) => v.kind === "manway" && v.instanceId === "v");
    // Local sill 30 + base 36 = world sill 66.
    expect(manway.sillIn).toBe(66);
    const catwalk = views.find((v) => v.kind === "catwalk" && v.instanceId === "v");
    expect(catwalk.deckIn).toBe(66);
  });
});
