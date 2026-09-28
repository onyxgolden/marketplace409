// Vendored 3D furniture models and the rule for when to use them.
//
// Asset manifest: every bundled model records where it came from, who made
// it, its license and redistribution status, and its integrity (bytes +
// sha256) and native bounds, so the library stays auditable. Only CC0 assets
// are bundled (see results/claude/2026-09-27-furniture-phase0-discovery.md
// in forge-ai-drop for the license review). Files live under
// public/designer-assets/, so saved designs never depend on a third-party
// website being up.
//
// Fit rule (no unrealistic stretching): the model's plan footprint is scaled
// to the piece's exact widthIn x depthIn; its height follows the model's own
// proportion (mean of the two plan scales). The model is used only while
// the two plan scales stay within MAX_PLAN_DISTORTION of each other —
// otherwise (e.g. a bed resized to a narrow strip) the piece renders with
// the procedural composition from designerFurnitureParts.js instead.
//
// The catalog (furnitureCatalog.js) stays authoritative for ids and sizes.
// Pure and framework-free.

const KENNEY = Object.freeze({
  author: "Kenney (www.kenney.nl)",
  collection: "Furniture Kit 2.0",
  sourceUrl: "https://kenney.nl/assets/furniture-kit",
  license: "CC0-1.0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  redistribution: "allowed",
  format: "glb",
});

// nativeSize: model-space bounding box (Kenney units) measured from the
// file; the vendored-file test re-measures it. Every model below already
// has its back (headboard, chair back) toward -z, the designer's "back".
const kenney = (name, nativeSize, bytes, sha256) => Object.freeze({
  ...KENNEY,
  assetId: `kenney/${name}`,
  url: `/designer-assets/kenney-furniture-kit/${name}.glb`,
  nativeSize: Object.freeze(nativeSize),
  bytes,
  sha256,
});

export const FURNITURE_ASSETS = Object.freeze([
  kenney("bedSingle", { x: 0.571, y: 0.375, z: 1.125 }, 18636, "ca00c63f9a12da3138d902b2f5f18e0360fb6e8a5ac42ccb4bc3f185724b65d1"),
  kenney("bedDouble", { x: 0.956, y: 0.375, z: 1.125 }, 23368, "c49b33e7d797d2ba1111895587dba7ff63b17a712eb9b4ceeb40a598f73e476c"),
  kenney("bathtub", { x: 1.19, y: 0.42, z: 0.56 }, 35500, "54c405c7035aab63dc41e709dc3c50fc5bcfbc4cddc91ffc54188075a6d25d01"),
  kenney("bathroomSink", { x: 0.34, y: 0.56, z: 0.29 }, 22536, "39d4f19608cab7e0fed52303b2c689f5f51fae1bad9b6913cb53d838875e797e"),
  kenney("table", { x: 0.841, y: 0.327, z: 0.447 }, 8196, "ff1a94498d023957f4bc3ff6f55a7a82977d336dbf01a573b3364f03afe5ff61"),
  kenney("chair", { x: 0.2, y: 0.47, z: 0.2 }, 10756, "c8a11eec93e89e31250ba91afc1b8d56c3bec7ae86640fd1239f595ff4180883"),
  kenney("chairDesk", { x: 0.335, y: 0.608, z: 0.314 }, 39016, "46406619186034cbe92b19b79a5f1a8e3f442a17a70a7524ef2c0ad0f35095c6"),
]);

/** Catalog id -> asset id. Catalog ids NOT listed use procedural geometry. */
export const FURNITURE_MODEL_FOR_CATALOG = Object.freeze({
  "bed-twin": "kenney/bedSingle",
  "bed-full": "kenney/bedDouble",
  "bed-queen": "kenney/bedDouble",
  "bed-king": "kenney/bedDouble",
  bathtub: "kenney/bathtub",
  "sink-pedestal": "kenney/bathroomSink",
  "dining-table-rect": "kenney/table",
  "dining-chair": "kenney/chair",
  "office-chair": "kenney/chairDesk",
});

/** Largest allowed ratio between the model's two plan scale factors. */
export const MAX_PLAN_DISTORTION = 1.25;

export function furnitureAsset(assetId) {
  return FURNITURE_ASSETS.find((a) => a.assetId === assetId);
}

/**
 * Scale factors that put `asset` on a widthIn x depthIn footprint:
 * { scale: {x, y, z}, distortion, ok }. distortion = larger plan scale /
 * smaller plan scale (1 = no stretching).
 */
export function fitFurnitureModel(asset, { widthIn, depthIn }) {
  const x = widthIn / asset.nativeSize.x;
  const z = depthIn / asset.nativeSize.z;
  const distortion = Math.max(x, z) / Math.min(x, z);
  return {
    scale: { x, y: (x + z) / 2, z },
    distortion,
    ok: Number.isFinite(distortion) && distortion <= MAX_PLAN_DISTORTION,
  };
}

/**
 * How a piece should render in 3D:
 *   { kind: "model", asset, fit } — a vendored model fits this footprint
 *   { kind: "procedural" }        — use furnitureParts() instead
 */
export function resolveFurnitureRepresentation(catalogId, { widthIn, depthIn } = {}) {
  const asset = furnitureAsset(FURNITURE_MODEL_FOR_CATALOG[catalogId]);
  if (!asset || !(widthIn > 0) || !(depthIn > 0)) return { kind: "procedural" };
  const fit = fitFurnitureModel(asset, { widthIn, depthIn });
  return fit.ok ? { kind: "model", asset, fit } : { kind: "procedural" };
}
