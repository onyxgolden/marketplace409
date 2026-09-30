// furnitureModelCache.test.js — load-once model templates, cheap per-piece
// clones that share GPU resources, and fallback on missing/corrupt assets.

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { furnitureAsset, fitFurnitureModel } from "@/domains/roomDesigner/furnitureAssetManifest";
import { createFurnitureModelCache, furniturePartGeometry } from "./furnitureModelCache";

function fakeScene() {
  // 2 x 1 x 4 box whose min corner sits at (1, 0, -4): center x 2, z -2.
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), new THREE.MeshStandardMaterial());
  mesh.position.set(2, 0.5, -2);
  const scene = new THREE.Group();
  scene.add(mesh);
  return scene;
}
function fakeLoader() {
  const calls = [];
  return {
    calls,
    load: vi.fn((url, onLoad, _progress, onError) => calls.push({ url, onLoad, onError })),
  };
}
const asset = { ...furnitureAsset("kenney/bedSingle"), nativeSize: { x: 2, y: 1, z: 4 } };

describe("createFurnitureModelCache", () => {
  it("loads each URL once, reports loading, then ready, and notifies the viewport", () => {
    const loader = fakeLoader();
    const onChange = vi.fn();
    const cache = createFurnitureModelCache({ loader, onChange });
    expect(cache.instantiate(asset, fitFurnitureModel(asset, { widthIn: 20, depthIn: 40 }))).toBeNull();
    expect(cache.status(asset.url)).toBe("loading");
    cache.instantiate(asset, fitFurnitureModel(asset, { widthIn: 20, depthIn: 40 }));
    expect(loader.load).toHaveBeenCalledTimes(1);
    loader.calls[0].onLoad({ scene: fakeScene() });
    expect(cache.status(asset.url)).toBe("ready");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("places a clone on the exact footprint, sitting on the floor, sharing geometry and material", () => {
    const loader = fakeLoader();
    const cache = createFurnitureModelCache({ loader, onChange: () => {} });
    cache.request(asset.url);
    const scene = fakeScene();
    loader.calls[0].onLoad({ scene });
    const a = cache.instantiate(asset, fitFurnitureModel(asset, { widthIn: 20, depthIn: 40 }));
    const b = cache.instantiate(asset, fitFurnitureModel(asset, { widthIn: 20, depthIn: 40 }));
    a.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(a);
    expect(box.min.x).toBeCloseTo(-10, 6);
    expect(box.max.x).toBeCloseTo(10, 6);
    expect(box.min.z).toBeCloseTo(-20, 6);
    expect(box.max.z).toBeCloseTo(20, 6);
    expect(box.min.y).toBeCloseTo(0, 6);
    const meshA = [];
    const meshB = [];
    a.traverse((o) => o.isMesh && meshA.push(o));
    b.traverse((o) => o.isMesh && meshB.push(o));
    expect(meshA[0]).not.toBe(meshB[0]);
    expect(meshA[0].geometry).toBe(meshB[0].geometry); // shared, not duplicated
    expect(meshA[0].material).toBe(meshB[0].material);
    expect(meshA[0].userData.sharedAsset).toBe(true); // rebuilds must not dispose it
    expect(meshA[0].castShadow).toBe(true);
  });

  it("recolors every material to the catalog/item color when one is given, cloning rather than mutating the shared template", () => {
    const loader = fakeLoader();
    const cache = createFurnitureModelCache({ loader, onChange: () => {} });
    cache.request(asset.url);
    loader.calls[0].onLoad({ scene: fakeScene() });
    const uncolored = cache.instantiate(asset, fitFurnitureModel(asset, { widthIn: 20, depthIn: 40 }));
    const colored = cache.instantiate(asset, fitFurnitureModel(asset, { widthIn: 20, depthIn: 40 }), "#ff0000");
    const meshUncolored = [];
    const meshColored = [];
    uncolored.traverse((o) => o.isMesh && meshUncolored.push(o));
    colored.traverse((o) => o.isMesh && meshColored.push(o));
    // The uncolored instance is untouched: still sharing the template's own material.
    expect(meshUncolored[0].material.userData.__isFurnitureColorClone).toBeUndefined();
    // The colored instance gets its OWN material, tinted, and flagged for
    // disposeContentGroup to clean up (it belongs to no cache).
    expect(meshColored[0].material).not.toBe(meshUncolored[0].material);
    expect(meshColored[0].material.userData.__isFurnitureColorClone).toBe(true);
    expect(meshColored[0].material.color.getHexString()).toBe("ff0000");
    // Geometry is still shared regardless of the color clone.
    expect(meshColored[0].geometry).toBe(meshUncolored[0].geometry);
    expect(meshColored[0].userData.sharedAsset).toBe(true);
  });

  it("memoizes the tinted clone per source material within one instantiate() call — a model whose meshes share one material gets one clone, not one per mesh", () => {
    const loader = fakeLoader();
    const cache = createFurnitureModelCache({ loader, onChange: () => {} });
    cache.request(asset.url);
    const sharedMat = new THREE.MeshStandardMaterial();
    const scene = new THREE.Group();
    const meshA = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sharedMat);
    const meshB = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sharedMat);
    scene.add(meshA, meshB);
    loader.calls[0].onLoad({ scene });
    const placed = cache.instantiate(asset, fitFurnitureModel(asset, { widthIn: 20, depthIn: 40 }), "#00ff00");
    const meshes = [];
    placed.traverse((o) => o.isMesh && meshes.push(o));
    expect(meshes).toHaveLength(2);
    expect(meshes[0].material).toBe(meshes[1].material); // same tinted clone, not two separate ones
  });

  it("marks a missing or corrupt asset failed, warns once, and never retries", () => {
    const loader = fakeLoader();
    const onChange = vi.fn();
    const warn = vi.fn();
    const cache = createFurnitureModelCache({ loader, onChange, warn });
    cache.request(asset.url);
    loader.calls[0].onError(new Error("404"));
    expect(cache.status(asset.url)).toBe("failed");
    expect(cache.instantiate(asset, fitFurnitureModel(asset, { widthIn: 20, depthIn: 40 }))).toBeNull();
    cache.request(asset.url);
    expect(loader.load).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("disposes template geometry and materials once, and ignores late loads after dispose", () => {
    const loader = fakeLoader();
    const cache = createFurnitureModelCache({ loader, onChange: () => {} });
    cache.request(asset.url);
    cache.request("/designer-assets/other.glb");
    const scene = fakeScene();
    const geo = scene.children[0].geometry;
    const mat = scene.children[0].material;
    const geoDispose = vi.spyOn(geo, "dispose");
    const matDispose = vi.spyOn(mat, "dispose");
    loader.calls[0].onLoad({ scene });
    cache.dispose();
    expect(geoDispose).toHaveBeenCalledTimes(1);
    expect(matDispose).toHaveBeenCalledTimes(1);
    const late = fakeScene();
    const lateDispose = vi.spyOn(late.children[0].geometry, "dispose");
    loader.calls[1].onLoad({ scene: late }); // arrives after unmount
    expect(lateDispose).toHaveBeenCalledTimes(1);
    expect(cache.status("/designer-assets/other.glb")).toBe("disposed");
  });
});

describe("furniturePartGeometry", () => {
  const size = (geo) => { geo.computeBoundingBox(); return geo.boundingBox.getSize(new THREE.Vector3()); };
  it("builds boxes and round cylinders exactly as before", () => {
    expect(size(furniturePartGeometry({ shape: "box", w: 3, h: 4, d: 5 })).toArray()).toEqual([3, 4, 5]);
    const cyl = size(furniturePartGeometry({ shape: "cyl", w: 10, h: 4, d: 10 }));
    expect(cyl.x).toBeCloseTo(10, 6);
    expect(cyl.z).toBeCloseTo(10, 6);
  });
  it("builds oval and tapered cylinders", () => {
    const oval = size(furniturePartGeometry({ shape: "cyl", w: 12, wTop: 16, h: 7, d: 20 }));
    expect(oval.x).toBeCloseTo(16, 1);
    expect(oval.z).toBeCloseTo(20, 1);
    expect(oval.y).toBeCloseTo(7, 6);
  });
});
