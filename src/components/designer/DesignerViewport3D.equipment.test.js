// DesignerViewport3D.equipment.test.js — the 360-view slice: composed
// process-equipment assemblies, TrueView-style camera framing, and tag
// labels. Runs on real Three.js objects with NO React, NO DOM, and NO WebGL
// context (object/material construction works in plain Node).

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  buildEquipmentGroup,
  frameCameraOnModel,
} from "./DesignerViewport3D";

const stdMaterial = (opts) =>
  new THREE.MeshStandardMaterial({ color: opts.color, roughness: opts.roughness ?? 0.8 });
const shadowed = (mesh) => {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};
const stubLabel = () => new THREE.Sprite(new THREE.SpriteMaterial());

const meshesOf = (group) => {
  const out = [];
  group.traverse((o) => {
    if (o.isMesh) out.push(o);
  });
  return out;
};
const spritesOf = (group) => {
  const out = [];
  group.traverse((o) => {
    if (o.isSprite) out.push(o);
  });
  return out;
};

describe("buildEquipmentGroup", () => {
  it("builds a tower as skirt + shell + dished head", () => {
    const g = buildEquipmentGroup(
      { shape: "vcyl", widthIn: 96, depthIn: 96, heightIn: 360, color: "#b45309", tag: "T-101", symbolId: "distillation-column" },
      { stdMaterial, shadowed, makeLabel: null },
    );
    const meshes = meshesOf(g);
    expect(meshes).toHaveLength(3);
    // skirt sits at the floor, shell above it, head caps the top
    const ys = meshes.map((m) => m.position.y).sort((a, b) => a - b);
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
  });

  it("builds a tall slender shape as a stack with a tip band", () => {
    const g = buildEquipmentGroup(
      { shape: "vcyl", widthIn: 36, depthIn: 36, heightIn: 1200, color: "#78716c", tag: "FL-901", symbolId: "flare-stack" },
      { stdMaterial, shadowed, makeLabel: null },
    );
    const meshes = meshesOf(g);
    expect(meshes).toHaveLength(2); // shell + tip, no skirt/head
    const [shell, tip] = meshes.sort((a, b) => a.position.y - b.position.y);
    expect(tip.position.y).toBeGreaterThan(shell.position.y);
  });

  it("builds a horizontal vessel as shell + dished ends + two saddles", () => {
    const g = buildEquipmentGroup(
      { shape: "hcyl", widthIn: 144, depthIn: 30, heightIn: 42, color: "#0e7490", tag: "V-102", symbolId: "horizontal-drum" },
      { stdMaterial, shadowed, makeLabel: null },
    );
    expect(meshesOf(g)).toHaveLength(5);
  });

  it("builds a pump as skid + casing + volute + motor", () => {
    const g = buildEquipmentGroup(
      { shape: "box", widthIn: 36, depthIn: 18, heightIn: 24, color: "#1d4ed8", tag: "P-101", symbolId: "centrifugal-pump" },
      { stdMaterial, shadowed, makeLabel: null },
    );
    expect(meshesOf(g)).toHaveLength(4);
  });

  it("builds a generic box as skid + body", () => {
    const g = buildEquipmentGroup(
      { shape: "box", widthIn: 48, depthIn: 36, heightIn: 60, color: "#4d7c0f", tag: "K-101", symbolId: "air-compressor" },
      { stdMaterial, shadowed, makeLabel: null },
    );
    expect(meshesOf(g)).toHaveLength(2);
  });

  it("builds a sphere on six legs with a top nozzle", () => {
    const g = buildEquipmentGroup(
      { shape: "sphere", widthIn: 72, depthIn: 72, heightIn: 96, color: "#a16207", tag: "TK-101", symbolId: "storage-sphere" },
      { stdMaterial, shadowed, makeLabel: null },
    );
    expect(meshesOf(g)).toHaveLength(8); // ball + 6 legs + nozzle
  });

  it("adds a floating tag label when a label maker is provided", () => {
    const g = buildEquipmentGroup(
      { shape: "vcyl", widthIn: 96, depthIn: 96, heightIn: 360, color: "#b45309", tag: "T-101", symbolId: "distillation-column" },
      { stdMaterial, shadowed, makeLabel: stubLabel },
    );
    const sprites = spritesOf(g);
    expect(sprites).toHaveLength(1);
    expect(sprites[0].position.y).toBeGreaterThan(360);
  });

  it("hides tag labels by default and marks them for the Labels toggle", () => {
    const g = buildEquipmentGroup(
      { shape: "vcyl", widthIn: 96, depthIn: 96, heightIn: 360, color: "#b45309", tag: "T-101", symbolId: "distillation-column" },
      { stdMaterial, shadowed, makeLabel: stubLabel },
    );
    const sprites = spritesOf(g);
    expect(sprites).toHaveLength(1);
    // Hidden until the viewport's Labels toggle flips them on.
    expect(sprites[0].visible).toBe(false);
    expect(sprites[0].userData.isTagLabel).toBe(true);
  });

  it("adds no label without a tag or without a label maker", () => {
    const opts = { stdMaterial, shadowed, makeLabel: stubLabel };
    const noTag = buildEquipmentGroup(
      { shape: "box", widthIn: 48, depthIn: 36, heightIn: 60, color: "#4d7c0f", tag: "", symbolId: "air-compressor" },
      opts,
    );
    expect(spritesOf(noTag)).toHaveLength(0);
    const noMaker = buildEquipmentGroup(
      { shape: "box", widthIn: 48, depthIn: 36, heightIn: 60, color: "#4d7c0f", tag: "K-101", symbolId: "air-compressor" },
      { stdMaterial, shadowed, makeLabel: null },
    );
    expect(spritesOf(noMaker)).toHaveLength(0);
  });
});

describe("frameCameraOnModel", () => {
  const built = {
    floor: { minX: 0, minZ: 0, maxX: 1000, maxZ: 800 },
    equipment: [{ heightIn: 360 }],
  };
  const rig = () => ({
    camera: new THREE.PerspectiveCamera(50, 1, 1, 24000),
    controls: { target: new THREE.Vector3(), update() {} },
  });

  it("frames the floor from an elevated 3/4 view and returns true", () => {
    const { camera, controls } = rig();
    expect(frameCameraOnModel(camera, controls, built)).toBe(true);
    // frame = max(1000, 360*1.8=648) = 1000; center (500, 400)
    expect(camera.position.x).toBeCloseTo(500 + 1000 * 0.55);
    expect(camera.position.y).toBeCloseTo(1000 * 0.75);
    expect(camera.position.z).toBeCloseTo(400 + 1000 * 0.55);
    expect(controls.target.x).toBeCloseTo(500);
    expect(controls.target.y).toBeCloseTo(Math.min(360, 1000) * 0.3);
    expect(controls.target.z).toBeCloseTo(400);
  });

  it("frames on the tallest equipment when it dwarfs the floor", () => {
    const { camera, controls } = rig();
    const tall = { ...built, equipment: [{ heightIn: 1200 }] };
    frameCameraOnModel(camera, controls, tall);
    // frame = max(1000, 2160) = 2160
    expect(camera.position.y).toBeCloseTo(2160 * 0.75);
    expect(controls.target.y).toBeCloseTo(Math.min(1200, 1000) * 0.3);
  });

  it("returns false and touches nothing when there is no floor", () => {
    const { camera, controls } = rig();
    const before = camera.position.clone();
    expect(frameCameraOnModel(camera, controls, { floor: null, equipment: [] })).toBe(false);
    expect(camera.position.equals(before)).toBe(true);
  });
});

describe("tag label cache lifecycle", () => {
  // Minimal document stub so makeTagSprite's canvas path runs in Node.
  const stubDocument = () => {
    const ctx2d = {
      font: "",
      fillStyle: "",
      textBaseline: "",
      measureText: () => ({ width: 120 }),
      beginPath() {},
      moveTo() {},
      arcTo() {},
      closePath() {},
      fill() {},
      fillText() {},
    };
    const canvas = { width: 300, height: 84, getContext: () => ctx2d };
    return { createElement: () => canvas };
  };

  it("disposeContentGroup releases sprite references so a later sweep disposes them", async () => {
    const mod = await import("./DesignerViewport3D");
    const realDocument = globalThis.document;
    globalThis.document = stubDocument();
    try {
      mod.sweepTagSpriteCache(); // isolate from other tests' entries
      const group = new THREE.Group();
      const s1 = mod.makeTagSprite("P-901");
      const s2 = mod.makeTagSprite("P-901"); // shared entry, two references
      expect(s1.userData.tagCacheKey).toBe("P-901");
      group.add(s1, s2);
      mod.disposeContentGroup(group); // what rebuild/unmount does
      // Both references released; the sweep (unmount path) reaps the entry.
      expect(mod.sweepTagSpriteCache()).toBe(1);
      expect(mod.sweepTagSpriteCache()).toBe(0); // second sweep: nothing left
    } finally {
      globalThis.document = realDocument;
    }
  });

  it("a live sprite's entry survives the sweep", async () => {
    const mod = await import("./DesignerViewport3D");
    const realDocument = globalThis.document;
    globalThis.document = stubDocument();
    try {
      mod.sweepTagSpriteCache();
      const live = mod.makeTagSprite("P-902");
      const dead = mod.makeTagSprite("P-903");
      const group = new THREE.Group();
      group.add(dead);
      mod.disposeContentGroup(group); // only the dead sprite's group is disposed
      expect(mod.sweepTagSpriteCache()).toBe(1); // P-903 reaped, P-902 lives
      mod.releaseTagSprite(live);
      expect(mod.sweepTagSpriteCache()).toBe(1); // now P-902 goes too
    } finally {
      globalThis.document = realDocument;
    }
  });
});
