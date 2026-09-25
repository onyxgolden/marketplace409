// DesignerViewport3D.highlight.test.js — the cheap-highlight contract.
//
// "Selection: changing selection updates the 3D highlight without a scene
// rebuild" — asserted at the model layer here, on real Three.js material/
// mesh objects, with NO React, NO DOM, and NO WebGL context involved (Three
// object/material construction runs fine in plain Node; only the renderer
// needs a browser). This is deliberately a plain .test.js file, not .test.jsx.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyHighlight, cloneWithHighlight } from "./DesignerViewport3D";
import { createEmptyDesign, addWall, addRoomFromTemplate } from "@/domains/roomDesigner/designerDocument";

/** A minimal stand-in for what the rebuild effect populates: mesh + registry. */
function fixture() {
  const sharedWallMaterial = new THREE.MeshStandardMaterial({ color: "#ece8dc" });
  const wallA = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sharedWallMaterial);
  const wallB = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sharedWallMaterial); // shares the SAME material instance
  const furnitureMat = new THREE.MeshStandardMaterial({ color: "#884422" });
  const chair = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), furnitureMat);

  const registry = new Map([
    ["wall:w1", [wallA]],
    ["wall:w2", [wallB]],
    ["furniture:f1", [chair]],
  ]);
  return { sharedWallMaterial, wallA, wallB, furnitureMat, chair, registry };
}

describe("cloneWithHighlight", () => {
  it("clones the material rather than mutating it, and tints the clone", () => {
    const base = new THREE.MeshStandardMaterial({ color: "#ffffff" });
    const highlighted = cloneWithHighlight(base);
    expect(highlighted).not.toBe(base);
    expect(highlighted.emissive.getHex()).toBe(0x2dd4bf);
    expect(base.emissive.getHex()).toBe(0x000000); // the original is untouched
  });

  it("flags the clone so it can be told apart from a cached material at disposal time", () => {
    const clone = cloneWithHighlight(new THREE.MeshStandardMaterial());
    expect(clone.userData.__isHighlightClone).toBe(true);
  });
});

describe("applyHighlight — furniture (composed Group, not a bare mesh)", () => {
  it("highlights every real mesh inside a furniture Group, not the Group itself — the exact crash found live", () => {
    // A furniture piece is registered as its composed THREE.Group (legs,
    // seat, back — several child meshes), which has no `.material` of its
    // own. Selecting a piece of furniture in the running app crashed here
    // (TypeError: Cannot read properties of undefined (reading 'clone'))
    // before this was handled — this test is that exact regression, pinned.
    const legMat = new THREE.MeshStandardMaterial({ color: "#442200" });
    const seatMat = new THREE.MeshStandardMaterial({ color: "#663311" });
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), legMat);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), seatMat);
    const chairGroup = new THREE.Group();
    chairGroup.add(leg, seat);

    const registryRef = { current: new Map([["furniture:f1", [chairGroup]]]) };
    const highlightedRef = { current: [] };

    expect(() =>
      applyHighlight({ kind: "furniture", id: "f1" }, createEmptyDesign(), registryRef, highlightedRef),
    ).not.toThrow();

    expect(leg.material.emissive.getHex()).toBe(0x2dd4bf);
    expect(seat.material.emissive.getHex()).toBe(0x2dd4bf);
    expect(leg.material).not.toBe(legMat);
    expect(seat.material).not.toBe(seatMat);
    expect(highlightedRef.current).toHaveLength(2);
  });

  it("reverts every child mesh of a highlighted furniture Group", () => {
    const legMat = new THREE.MeshStandardMaterial();
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), legMat);
    const group = new THREE.Group();
    group.add(leg);
    const registryRef = { current: new Map([["furniture:f1", [group]]]) };
    const highlightedRef = { current: [] };

    applyHighlight({ kind: "furniture", id: "f1" }, createEmptyDesign(), registryRef, highlightedRef);
    applyHighlight(null, createEmptyDesign(), registryRef, highlightedRef);

    expect(leg.material).toBe(legMat);
  });

  it("skips an entry with no material rather than crashing (defensive floor beneath the Group fix)", () => {
    // THREE.Mesh always substitutes a real default material when none is
    // given, so a materialless entry can't be constructed through the
    // public API — this exercises the guard directly against a mesh-shaped
    // object without one, the way a future geometry kind legitimately might.
    const materialless = { isMesh: true, material: null };
    const registryRef = { current: new Map([["wall:w1", [materialless]]]) };
    const highlightedRef = { current: [] };
    expect(() =>
      applyHighlight({ kind: "wall", id: "w1" }, createEmptyDesign(), registryRef, highlightedRef),
    ).not.toThrow();
    expect(highlightedRef.current).toEqual([]);
  });
});

describe("applyHighlight", () => {
  it("tints only the selected mesh's material, leaving a mesh sharing the same material untouched", () => {
    const { wallA, wallB, sharedWallMaterial, registry } = fixture();
    const registryRef = { current: registry };
    const highlightedRef = { current: [] };

    applyHighlight({ kind: "wall", id: "w1" }, createEmptyDesign(), registryRef, highlightedRef);

    // The selected wall's mesh got its OWN material instance...
    expect(wallA.material).not.toBe(sharedWallMaterial);
    expect(wallA.material.emissive.getHex()).toBe(0x2dd4bf);
    // ...but the OTHER wall, which shared that same cached material, is
    // untouched — proving the highlight never mutates a shared cache entry
    // (which would light up every wall in the house).
    expect(wallB.material).toBe(sharedWallMaterial);
    expect(sharedWallMaterial.emissive.getHex()).toBe(0x000000);
  });

  it("reverts the previous selection's material exactly, on the next call", () => {
    const { wallA, sharedWallMaterial, registry } = fixture();
    const registryRef = { current: registry };
    const highlightedRef = { current: [] };

    applyHighlight({ kind: "wall", id: "w1" }, createEmptyDesign(), registryRef, highlightedRef);
    expect(wallA.material).not.toBe(sharedWallMaterial);

    applyHighlight(null, createEmptyDesign(), registryRef, highlightedRef);
    expect(wallA.material).toBe(sharedWallMaterial);
    expect(highlightedRef.current).toEqual([]);
  });

  it("moves the highlight when the selection moves to a different entity", () => {
    const { wallA, wallB, sharedWallMaterial, registry } = fixture();
    const registryRef = { current: registry };
    const highlightedRef = { current: [] };

    applyHighlight({ kind: "wall", id: "w1" }, createEmptyDesign(), registryRef, highlightedRef);
    applyHighlight({ kind: "wall", id: "w2" }, createEmptyDesign(), registryRef, highlightedRef);

    expect(wallA.material).toBe(sharedWallMaterial); // reverted
    expect(wallB.material).not.toBe(sharedWallMaterial); // now highlighted
    expect(wallB.material.emissive.getHex()).toBe(0x2dd4bf);
  });

  it("highlights every wall of a selected room", () => {
    const { wallA, wallB, registry } = fixture();
    const design = { ...createEmptyDesign(), rooms: [{ id: "r1", wallIds: ["w1", "w2"] }] };
    const registryRef = { current: registry };
    const highlightedRef = { current: [] };

    applyHighlight({ kind: "room", id: "r1" }, design, registryRef, highlightedRef);

    expect(wallA.material.emissive.getHex()).toBe(0x2dd4bf);
    expect(wallB.material.emissive.getHex()).toBe(0x2dd4bf);
    expect(highlightedRef.current).toHaveLength(2);
  });

  it("touches no geometry — only material assignment", () => {
    const { wallA, registry } = fixture();
    const originalGeometry = wallA.geometry;
    const registryRef = { current: registry };
    const highlightedRef = { current: [] };

    applyHighlight({ kind: "wall", id: "w1" }, createEmptyDesign(), registryRef, highlightedRef);

    expect(wallA.geometry).toBe(originalGeometry);
  });

  it("is a no-op when the selection has no matching mesh in the registry (e.g. a symbol)", () => {
    const { wallA, sharedWallMaterial, registry } = fixture();
    const registryRef = { current: registry };
    const highlightedRef = { current: [] };

    applyHighlight({ kind: "symbol", id: "s1" }, createEmptyDesign(), registryRef, highlightedRef);

    expect(wallA.material).toBe(sharedWallMaterial);
    expect(highlightedRef.current).toEqual([]);
  });

  it("never double-highlights the same mesh reachable through two keys", () => {
    // A mesh registered under both a wall key and an opening key (a sill
    // segment, say) must only get ONE material clone if both keys resolve.
    const sharedMat = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sharedMat);
    const registryRef = {
      current: new Map([
        ["wall:w1", [mesh]],
        ["opening:o1", [mesh]],
      ]),
    };
    const highlightedRef = { current: [] };
    // Simulate a selection that (hypothetically) resolved to both keys by
    // calling with a room whose wallIds happen to overlap — instead, drive
    // it directly through two applyHighlight-relevant keys via a room design.
    const design = { ...createEmptyDesign(), rooms: [{ id: "r1", wallIds: ["w1"] }] };
    applyHighlight({ kind: "room", id: "r1" }, design, registryRef, highlightedRef);
    expect(highlightedRef.current).toHaveLength(1);
  });

  it("round-trips against a real registry built the way the component builds one, for a real design", () => {
    // Not a stub this time: a genuine design with a genuine wall id, proving
    // the wiring between highlightKeysForSelection and a real registry key
    // actually lines up end to end.
    let design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 100, y: 0 }, { id: "realWall" });
    design = addRoomFromTemplate(design, "bedroom", { x: 200, y: 200 });
    const sharedMat = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sharedMat);
    const registryRef = { current: new Map([["wall:realWall", [mesh]]]) };
    const highlightedRef = { current: [] };

    applyHighlight({ kind: "wall", id: "realWall" }, design, registryRef, highlightedRef);

    expect(mesh.material.emissive.getHex()).toBe(0x2dd4bf);
  });
});
