// PR668-002 probe — D9 (hydrants, branch/riser runs, directed-spray
// assemblies) is absent from the elevation and 3D views. The binding scope
// required the implemented components to be inspectable across plan,
// industrial elevation, print, and 3D with the same identities and
// geometry the validation consumes.
//
// These probes FAIL against the current implementation (no hydrant/spray
// elevation views; no hydrant/spray 3D descriptors) and must PASS after
// the fix. Spray effectiveness stays NOT_EVALUATED — this is layout and
// geometry only.

import { describe, expect, it, beforeEach } from "vitest";
import { buildElevation } from "../homeSections";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
  setPipeSource,
} from "../designerDocument";
import { detectRunJunctions } from "../pipeAttachments";
import { placeReducer } from "../pipeReducerModel";
import { createHomeProject, resetHomeProjectIds, updateLevelDesign } from "../homeProject";

beforeEach(() => {
  resetDesignerIds();
  resetHomeProjectIds();
});

function d9Design() {
  let d = createEmptyDesign("D9 views");
  // Buried 12-in firewater main, stationed hydrant body 6 ft off the main
  // on a 6-in branch, and a directed-spray assembly aimed at a vessel.
  d = addPipeRun(d, [{ x: 0, y: 0 }, { x: 1200, y: 0 }], {
    id: "fw-main",
    diameterIn: 12,
    utility: "firewater",
    elevationIn: -36,
    underground: true,
  });
  d = setPipeSource(d, "fw-main", "firewater");
  d = addPipeRun(d, [{ x: 600, y: 0 }, { x: 600, y: 72 }], {
    id: "fw-branch",
    diameterIn: 6,
    utility: "firewater",
    elevationIn: -36,
  });
  // R6: the branch is the hydrant's riser leg — buried at the tap,
  // rising to the hydrant inlet at grade (modeled profile, patched
  // post-add the way the other firewater fixtures author elevIn).
  d = {
    ...d,
    pipes: d.pipes.map((p) => (p.id === "fw-branch" ? { ...p, elevIn: [-36, 0] } : p)),
  };
  // The branch taps the main: modeled junction + the 12->6 reducer the
  // size transition requires (PR668-001/D668-003 — an unmodeled tap is
  // a validation finding now).
  d = detectRunJunctions(d, "fw-branch");
  d = placeReducer(d, 600, 0, { id: "red-fwb", inletSizeIn: 12, outletSizeIn: 6 });
  // Supply take-off to the directed-spray assembly (D668-006: a valid
  // assignment needs a verified supply path).
  d = addPipeRun(d, [{ x: 900, y: 0 }, { x: 900, y: 888 }], {
    id: "fw-spray-takeoff",
    diameterIn: 6,
    utility: "firewater",
    elevationIn: -36,
  });
  // R6: the take-off is the spray's riser leg — it must REACH the
  // assembly inlet elevation (grade), not just its plan position.
  d = {
    ...d,
    pipes: d.pipes.map((p) => (p.id === "fw-spray-takeoff" ? { ...p, elevIn: [-36, 0] } : p)),
  };
  d = detectRunJunctions(d, "fw-spray-takeoff");
  d = placeReducer(d, 900, 0, { id: "red-fws", inletSizeIn: 12, outletSizeIn: 6 });
  d = placeSymbol(d, "piping", "fire-hydrant", 600, 72, { id: "fh-1", tag: "FH-1" });
  d = placeSymbol(d, "piping", "spray-nozzle", 900, 900, { id: "fa-1", tag: "FA-101" });
  d = placeSymbol(d, "processEquipment", "vertical-vessel", 100, 100, { id: "v-1", tag: "V-101" });
  // Authored semantic fields (the D668-008 authoring path) — patched here
  // the way the FCCU fixture authors them until the commands land.
  d = {
    ...d,
    symbols: d.symbols.map((s) =>
      s.id === "fa-1"
        ? { ...s, protects: "v-1", aimAt: { x: 100, y: 100 } }
        : s.id === "v-1"
          ? { ...s, flammable: true }
          : s,
    ),
  };
  d = { ...d, unitBoundary: [{ x: -100, y: -100 }, { x: 500, y: -100 }, { x: 500, y: 500 }, { x: -100, y: 500 }] };
  return d;
}

function elevationViews(design, direction = "S") {
  let p = createHomeProject("D9 project", { units: "in" });
  p = updateLevelDesign(p, p.levels[0].id, () => design);
  const elevation = buildElevation(p, { direction });
  expect(elevation.ok).toBe(true);
  const level = elevation.levels[0];
  // The elevation model keeps industrial views in per-family arrays;
  // the probe reads them as one stream.
  return [
    ...(level.pipeViews || []),
    ...(level.accessViews || []),
    ...(level.firewaterViews || []),
  ];
}

describe("PR668-002 D9 components in elevation and 3D", () => {
  it("projects the fire hydrant into the elevation view (same identity/geometry)", () => {
    const views = elevationViews(d9Design());
    const hydrants = views.filter((v) => v.kind === "hydrant");
    expect(hydrants).toHaveLength(1);
    expect(hydrants[0]).toMatchObject({ instanceId: "fh-1" });
  });

  it("projects the directed-spray assembly (with aim) into the elevation view", () => {
    const views = elevationViews(d9Design());
    const sprays = views.filter((v) => v.kind === "spray");
    expect(sprays).toHaveLength(1);
    expect(sprays[0]).toMatchObject({ instanceId: "fa-1", protects: "v-1" });
    expect(sprays[0].aimU).toBeDefined();
  });

  it("the hydrant branch/riser run projects as a pipe at its buried elevation", () => {
    const views = elevationViews(d9Design());
    const pipes = views.filter((v) => v.kind === "pipe" && v.runId === "fw-branch");
    expect(pipes.length).toBeGreaterThan(0);
    expect(pipes[0].firewater).toBe(true);
  });

  it("3D descriptors cover standalone hydrant and spray instances", async () => {
    const { fittingDescriptors } = await import("../designerThreeModel");
    const fittings = fittingDescriptors(d9Design());
    const kinds = new Map(fittings.map((f) => [f.id, f.symbolId]));
    expect(kinds.get("fh-1")).toBe("fire-hydrant");
    expect(kinds.get("fa-1")).toBe("spray-nozzle");
  });

  it("spray 3D descriptor carries the discharge origin and aim used by validation", async () => {
    const { fittingDescriptors } = await import("../designerThreeModel");
    const fittings = fittingDescriptors(d9Design());
    const spray = fittings.find((f) => f.id === "fa-1");
    expect(spray).toMatchObject({ x: 900, z: 900 });
    expect(spray.aimAt).toMatchObject({ x: 100, y: 100 });
  });
});
