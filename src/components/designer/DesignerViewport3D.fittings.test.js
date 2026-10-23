// D668-010 probe — 3D acceptance is incomplete: standalone
// flanged-joint, blind-flange, fire-hydrant, and spray-nozzle instances
// produce no equipment descriptors and have no standalone 3D render
// dispatch; a flange pair at a branch does not establish the tee/fitting
// body + three-port geometry (PR668-005).
//
// These probes FAIL against the current implementation and must PASS
// after the fix: complete render paths for the scoped components (with
// the tee body), plus plan/3D/print and click-through evidence in
// tests (domain counts alone are insufficient).

import * as THREE from "three";
import { describe, expect, it, beforeEach } from "vitest";
import {
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "@/domains/roomDesigner/designerDocument";
import { fittingDescriptors } from "@/domains/roomDesigner/designerThreeModel";
import { buildFittingsGroup } from "./DesignerViewport3D";

const stdMaterial = (opts) =>
  new THREE.MeshStandardMaterial({ color: opts.color, roughness: opts.roughness ?? 0.8 });
const shadowed = (mesh) => {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

const meshesOf = (group) => {
  const out = [];
  group.traverse((o) => {
    if (o.isMesh) out.push(o);
  });
  return out;
};

beforeEach(() => {
  resetDesignerIds();
});

function fittingsDesign() {
  let design = createEmptyDesign("fittings 3d");
  design = placeSymbol(design, "piping", "flanged-joint", 100, 100, { id: "fj-1" });
  design = placeSymbol(design, "piping", "blind-flange", 200, 100, { id: "bf-1" });
  design = placeSymbol(design, "piping", "fire-hydrant", 300, 100, { id: "fh-1" });
  design = placeSymbol(design, "piping", "spray-nozzle", 400, 100, { id: "sn-1" });
  design = placeSymbol(design, "piping", "reducer", 500, 100, { id: "red-1" });
  design = {
    ...design,
    symbols: design.symbols.map((s) =>
      s.id === "red-1" ? { ...s, inletSizeIn: 2, outletSizeIn: 1 } : s,
    ),
  };
  return design;
}

describe("D668-010 standalone fitting 3D acceptance", () => {
  it("every scoped standalone fitting yields a 3D descriptor", () => {
    const fittings = fittingDescriptors(fittingsDesign());
    const byId = new Map(fittings.map((f) => [f.id, f]));
    for (const [id, symbolId] of [
      ["fj-1", "flanged-joint"],
      ["bf-1", "blind-flange"],
      ["fh-1", "fire-hydrant"],
      ["sn-1", "spray-nozzle"],
      ["red-1", "reducer"],
    ]) {
      expect(byId.get(id)?.symbolId, id).toBe(symbolId);
    }
  });

  it("the reducer descriptor carries its declared transition sizes", () => {
    const fittings = fittingDescriptors(fittingsDesign());
    const red = fittings.find((f) => f.id === "red-1");
    expect(red).toMatchObject({ inletSizeIn: 2, outletSizeIn: 1 });
  });

  it("the 3D render dispatch builds real meshes for every fitting", () => {
    const design = fittingsDesign();
    const group = buildFittingsGroup(design, { stdMaterial, shadowed });
    expect(group).not.toBeNull();
    const meshes = meshesOf(group);
    // At least one mesh per fitting instance.
    expect(meshes.length).toBeGreaterThanOrEqual(5);
    const kinds = new Set();
    group.traverse((o) => {
      if (o.userData?.fittingId) kinds.add(o.userData.fittingId);
    });
    for (const id of ["fj-1", "bf-1", "fh-1", "sn-1", "red-1"]) {
      expect(kinds.has(id), id).toBe(true);
    }
  });

  it("the hydrant 3D form reads as a hydrant (body above grade + bonnet)", () => {
    const design = fittingsDesign();
    const group = buildFittingsGroup(design, { stdMaterial, shadowed });
    const hydrantMeshes = [];
    group.traverse((o) => {
      if (o.isMesh && o.userData?.fittingId === "fh-1") hydrantMeshes.push(o);
    });
    expect(hydrantMeshes.length).toBeGreaterThanOrEqual(2);
    // Body rises above grade.
    expect(Math.max(...hydrantMeshes.map((m) => m.position.y))).toBeGreaterThan(0);
  });
});
