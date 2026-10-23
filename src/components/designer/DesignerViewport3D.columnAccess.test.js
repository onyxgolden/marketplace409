// D668-001 probe — column 3D construction THROWS:
// buildEquipmentComponentsGroup/addAccessPackage iterates
// `pkg.deck.corners`; downcomer platform decks have no corners ->
// TypeError: pkg.deck.corners is not iterable for a normal column.
//
// This probe FAILS against the current implementation (it throws) and
// must PASS after the fix: one complete access-package geometry
// contract for vessel AND column decks. Runs on real Three.js objects
// with no React/DOM/WebGL, like the other DesignerViewport3D tests.

import * as THREE from "three";
import { describe, expect, it, beforeEach } from "vitest";
import { buildEquipmentComponentsGroup } from "./DesignerViewport3D";
import {
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "@/domains/roomDesigner/designerDocument";

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

function columnDesign() {
  let design = createEmptyDesign("column 3d");
  design = placeSymbol(design, "processEquipment", "column", 500, 500, {
    id: "t-101",
    tag: "T-101",
    heightIn: 360,
  });
  return design;
}

describe("D668-001 column 3D access-package geometry contract", () => {
  it("builds the equipment components group for a normal column without throwing", () => {
    const design = columnDesign();
    const group = buildEquipmentComponentsGroup(design, "t-101", { stdMaterial, shadowed });
    expect(group).not.toBeNull();
    expect(meshesOf(group).length).toBeGreaterThan(0);
  });

  it("the column's downcomer platforms render deck legs + ladders like vessel decks", () => {
    const design = columnDesign();
    const group = buildEquipmentComponentsGroup(design, "t-101", { stdMaterial, shadowed });
    const meshes = meshesOf(group);
    // Three downcomer levels (120/240/360), each with a deck box and a
    // ladder (2 rails + rungs) plus the level manway disc: far more
    // meshes than a bare vessel's single access package.
    expect(meshes.length).toBeGreaterThan(20);
  });

  it("a high-sill vessel still builds its access package (contract unchanged)", () => {
    let design = createEmptyDesign("vessel 3d");
    design = placeSymbol(design, "processEquipment", "vertical-vessel", 100, 100, {
      id: "v-101",
      tag: "V-101",
    });
    const group = buildEquipmentComponentsGroup(design, "v-101", { stdMaterial, shadowed });
    expect(group).not.toBeNull();
    expect(meshesOf(group).length).toBeGreaterThan(0);
  });
});
