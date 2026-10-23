// Round-2 renderer probes (PR #668 fix round 2) — the 3D view must
// render the SAME models validation checks:
//   R3: a sloped segment renders as a sloped cylinder between its
//       true endpoint elevations, never flattened to the segment max;
//   R4: the equipment-components builder receives the design, so the
//       grade datum governs the access package it builds;
//   R7: the directed-spray barrel follows the authored aim (f.aimAt),
//       not a constant diagonal; an un-aimed assembly renders the
//       named unresolved state (base only, no invented barrel);
//   R1: a reducer renders as a horizontal transition along its owned
//       axis at its interface elevation, with a flange disc at each
//       interface — not a vertical frustum at elevation 0.
//
// These probes FAIL against the round-1 implementation and must PASS
// after the fix.

import * as THREE from "three";
import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "@/domains/roomDesigner/designerDocument";
import { pipeDescriptors } from "@/domains/roomDesigner/designerThreeModel";
import { placeReducer } from "@/domains/roomDesigner/pipeReducerModel";
import {
  buildEquipmentComponentsGroup,
  buildFittingsGroup,
  buildPipeGroup,
} from "./DesignerViewport3D";

const stdMaterial = (opts) =>
  new THREE.MeshStandardMaterial({ color: opts.color, roughness: opts.roughness ?? 0.8 });
const shadowed = (mesh) => {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

const meshesOf = (group) => {
  const out = [];
  group?.traverse((o) => {
    if (o.isMesh) out.push(o);
  });
  return out;
};

beforeEach(() => {
  resetDesignerIds();
});

describe("R3 the 3D pipe renders the physical route (slopes included)", () => {
  it("a sloped segment is a sloped cylinder between its endpoint elevations", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: -100, y: 0 }, { x: 100, y: 0 }], {
      id: "slope",
      diameterIn: 2,
    });
    design = {
      ...design,
      pipes: design.pipes.map((p) => (p.id === "slope" ? { ...p, elevIn: [0, 100] } : p)),
    };
    const descriptor = pipeDescriptors(design).find((p) => p.id === "slope");
    const group = buildPipeGroup(descriptor, { stdMaterial, shadowed });
    const cylinders = meshesOf(group).filter(
      (m) => m.geometry?.type === "CylinderGeometry",
    );
    expect(cylinders).toHaveLength(1);
    const cyl = cylinders[0];
    // The cylinder spans the true 3D length and centers at mid-height.
    expect(cyl.geometry.parameters.height).toBeCloseTo(Math.hypot(200, 100), 4);
    expect(cyl.position.y).toBeCloseTo(50, 6);
    expect(cyl.position.x).toBeCloseTo(0, 6);
  });
});

describe("R4 the components builder honors the design's grade datum", () => {
  function vesselDesign(grade) {
    let design = createEmptyDesign();
    design = placeSymbol(design, "processEquipment", "vertical-vessel", 0, 0, { id: "v" });
    if (grade) design = { ...design, gradeElevationIn: grade };
    return design;
  }

  it("grade 12 (sill 18 above grade): no catwalk/ladder meshes are built", () => {
    const atGrade = buildEquipmentComponentsGroup(vesselDesign(0), "v", { stdMaterial, shadowed });
    const raised = buildEquipmentComponentsGroup(vesselDesign(12), "v", { stdMaterial, shadowed });
    // The at-grade vessel gets its access package (deck + legs +
    // ladder rails/rungs); the raised-grade vessel gets none of it —
    // only nozzle flanges and the manway.
    expect(meshesOf(raised).length).toBeLessThan(meshesOf(atGrade).length);
  });
});

describe("R7 the spray barrel follows the authored aim", () => {
  function sprayDesign(aimAt) {
    let design = createEmptyDesign();
    design = placeSymbol(design, "piping", "spray-nozzle", 400, 100, { id: "sn" });
    if (aimAt) {
      design = {
        ...design,
        symbols: design.symbols.map((s) => (s.id === "sn" ? { ...s, aimAt } : s)),
      };
    }
    return design;
  }
  const sprayMeshes = (design) =>
    meshesOf(buildFittingsGroup(design, { stdMaterial, shadowed })).filter(
      (m) => m.userData?.fittingId === "sn",
    );

  it("aimed west: the barrel points west at barrel height", () => {
    const meshes = sprayMeshes(sprayDesign({ x: 100, y: 100 }));
    // Base riser (center x 400) + aimed barrel whose center sits WEST
    // of the origin at y 18 (horizontal discharge).
    const barrel = meshes.find((m) => m.position.x < 394);
    expect(barrel).toBeDefined();
    expect(barrel.position.y).toBeCloseTo(18, 6);
    expect(barrel.position.z).toBeCloseTo(100, 6);
  });

  it("aimed east: the barrel flips with the authored target", () => {
    const meshes = sprayMeshes(sprayDesign({ x: 900, y: 100 }));
    const barrel = meshes.find((m) => m.position.x > 406);
    expect(barrel).toBeDefined();
    expect(barrel.position.y).toBeCloseTo(18, 6);
  });

  it("no authored aim: the unresolved state renders no invented barrel", () => {
    const meshes = sprayMeshes(sprayDesign(null));
    expect(meshes).toHaveLength(1); // the base riser only
  });
});

describe("R1 the reducer renders its owned interfaces", () => {
  it("a bound reducer is a horizontal frustum along its axis at its elevation", () => {
    let design = createEmptyDesign();
    design = placeReducer(design, 500, 100, {
      id: "red",
      inletSizeIn: 12,
      outletSizeIn: 6,
      rotationDeg: 0,
    });
    design = {
      ...design,
      symbols: design.symbols.map((s) => (s.id === "red" ? { ...s, elevationIn: 150 } : s)),
    };
    const group = buildFittingsGroup(design, { stdMaterial, shadowed });
    const meshes = meshesOf(group).filter((m) => m.userData?.fittingId === "red");
    const frustum = meshes.find(
      (m) => m.geometry?.type === "CylinderGeometry" && m.geometry.parameters.radiusTop !== m.geometry.parameters.radiusBottom,
    );
    expect(frustum).toBeDefined();
    expect(frustum.position.y).toBeCloseTo(150, 6);
    // The cylinder's local +Y (its length axis) maps onto +X (the
    // reducer's owned axis at rotation 0).
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(frustum.quaternion);
    expect(axis.x).toBeCloseTo(1, 4);
    expect(axis.y).toBeCloseTo(0, 4);
  });
});
