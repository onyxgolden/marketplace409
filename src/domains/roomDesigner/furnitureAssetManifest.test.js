// furnitureAssetManifest.test.js — vendored CC0 furniture models: license
// records, file integrity, and the fit rule that decides model vs procedural.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { getCatalogEntry } from "./furnitureCatalog";
import {
  FURNITURE_ASSETS,
  FURNITURE_MODEL_FOR_CATALOG,
  MAX_HEIGHT_RATIO,
  MAX_PLAN_DISTORTION,
  fitFurnitureModel,
  furnitureAsset,
  resolveFurnitureRepresentation,
} from "./furnitureAssetManifest";

const PUBLIC = path.resolve(__dirname, "../../../public");
const parseGlb = (bytes) =>
  new Promise((resolve, reject) => {
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    new GLTFLoader().parse(ab, "", resolve, reject);
  });

describe("asset manifest records", () => {
  it("records source, author, license, format and redistribution for every asset", () => {
    expect(FURNITURE_ASSETS.length).toBe(19);
    for (const a of FURNITURE_ASSETS) {
      expect(a.license).toBe("CC0-1.0");
      expect(a.licenseUrl).toBe("https://creativecommons.org/publicdomain/zero/1.0/");
      expect(a.author).toMatch(/Kenney/);
      expect(a.sourceUrl).toBe("https://kenney.nl/assets/furniture-kit");
      expect(a.format).toBe("glb");
      expect(a.redistribution).toBe("allowed");
      expect(a.url).toMatch(/^\/designer-assets\/kenney-furniture-kit\/[A-Za-z]+\.glb$/);
      expect(Object.isFrozen(a)).toBe(true);
    }
    expect(fs.readFileSync(path.join(PUBLIC, "designer-assets/kenney-furniture-kit/LICENSE.txt"), "utf8")).toMatch(/Creative Commons Zero, CC0/);
  });

  it("maps only real catalog ids to known assets", () => {
    for (const [catalogId, assetId] of Object.entries(FURNITURE_MODEL_FOR_CATALOG)) {
      expect(getCatalogEntry(catalogId), catalogId).toBeTruthy();
      expect(furnitureAsset(assetId), assetId).toBeTruthy();
    }
  });

  it.each(FURNITURE_ASSETS.map((a) => [a.assetId, a]))("%s: vendored file matches its size, hash and native bounds", async (_id, a) => {
    const bytes = fs.readFileSync(path.join(PUBLIC, a.url));
    expect(bytes.length).toBe(a.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(a.sha256);
    const gltf = await parseGlb(bytes);
    const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(a.nativeSize.x, 2);
    expect(size.y).toBeCloseTo(a.nativeSize.y, 2);
    expect(size.z).toBeCloseTo(a.nativeSize.z, 2);
  });

  it("a truncated (corrupt) GLB fails to parse — the renderer must fall back", async () => {
    const bytes = fs.readFileSync(path.join(PUBLIC, FURNITURE_ASSETS[0].url)).subarray(0, 200);
    await expect(parseGlb(bytes)).rejects.toBeTruthy();
  });
});

describe("fit rule: exact plan footprint, no unrealistic stretching", () => {
  it("fits the footprint exactly and keeps height in the model's own proportion", () => {
    const fit = fitFurnitureModel(furnitureAsset("kenney/bedSingle"), { widthIn: 38, depthIn: 75 });
    const a = furnitureAsset("kenney/bedSingle");
    expect(fit.scale.x * a.nativeSize.x).toBeCloseTo(38, 6);
    expect(fit.scale.z * a.nativeSize.z).toBeCloseTo(75, 6);
    expect(fit.scale.y).toBeCloseTo((fit.scale.x + fit.scale.z) / 2, 6);
    expect(fit.distortion).toBeCloseTo(1, 1);
    expect(fit.ok).toBe(true);
  });

  it("uses the model for every mapped catalog item at its nominal size, footprint AND height", () => {
    for (const catalogId of Object.keys(FURNITURE_MODEL_FOR_CATALOG)) {
      const e = getCatalogEntry(catalogId);
      const rep = resolveFurnitureRepresentation(catalogId, { widthIn: e.widthIn, depthIn: e.depthIn, heightIn: e.heightIn });
      expect(rep.kind, catalogId).toBe("model");
      expect(rep.fit.distortion, catalogId).toBeLessThanOrEqual(MAX_PLAN_DISTORTION);
      expect(rep.fit.heightRatio, catalogId).toBeLessThanOrEqual(MAX_HEIGHT_RATIO);
      expect(1 / rep.fit.heightRatio, catalogId).toBeLessThanOrEqual(MAX_HEIGHT_RATIO);
    }
  });

  it("refuses a model whose natural height is far from the catalog height (no 6-ft kitchen islands)", () => {
    const bar = { assetId: "test/bar", nativeSize: { x: 0.43, y: 0.42, z: 0.21 } }; // Kenney kitchenBar proportions
    const fit = fitFurnitureModel(bar, { widthIn: 72, depthIn: 36, heightIn: 36 });
    expect(fit.distortion).toBeLessThan(1.05); // footprint alone would pass
    expect(fit.heightRatio).toBeGreaterThan(1.9); // ~71" tall vs 36"
    expect(fit.ok).toBe(false);
    expect(fitFurnitureModel(bar, { widthIn: 72, depthIn: 36 }).ok).toBe(true); // height unknown: footprint rule only
  });

  it("falls back to procedural geometry when a resize would stretch the model too far", () => {
    expect(resolveFurnitureRepresentation("bed-queen", { widthIn: 60, depthIn: 80 }).kind).toBe("model");
    expect(resolveFurnitureRepresentation("bed-queen", { widthIn: 30, depthIn: 80 }).kind).toBe("procedural");
    expect(resolveFurnitureRepresentation("dining-table-rect", { widthIn: 36, depthIn: 72 }).kind).toBe("procedural");
  });

  it("keeps items without a suitable model procedural (toilet, round table, drop-in sinks)", () => {
    for (const id of ["toilet", "dining-table-round", "sink-bath-round", "sink-kitchen-33", "loveseat", "kitchen-island", "bookshelf", "cabinet-base-24"]) {
      expect(resolveFurnitureRepresentation(id, { widthIn: 30, depthIn: 30 }).kind, id).toBe("procedural");
    }
    expect(resolveFurnitureRepresentation("bed-queen", { widthIn: 0, depthIn: 80 }).kind).toBe("procedural");
  });
});
