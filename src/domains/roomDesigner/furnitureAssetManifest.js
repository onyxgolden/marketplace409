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
// the two plan scales stay within MAX_PLAN_DISTORTION of each other AND its
// resulting height stays within MAX_HEIGHT_RATIO of the catalog height —
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
  // Phase 2 (rest of the residential library)
  kenney("loungeSofa", { x: 0.98, y: 0.46, z: 0.41 }, 9644, "1886b811c0d3ad0d8525a4fd43adf4112c497c8e0ed906f06877ca3517f4c7dd"),
  kenney("loungeChair", { x: 0.49, y: 0.46, z: 0.41 }, 9648, "ddfe6bc4b3451bca61666d7b614552d6ed2a03d82fc76244b72ae3155874dc6c"),
  kenney("tableCoffee", { x: 0.661, y: 0.23, z: 0.4 }, 8256, "e38bea760fbd514efbb75528d09b4752c91af44677bbb97e6d4386c263525179"),
  kenney("desk", { x: 0.734, y: 0.384, z: 0.392 }, 15048, "0164fe828f028b321730fb8c74502e353583f751be74da1682d42fff7d3c5a42"),
  kenney("cabinetBedDrawerTable", { x: 0.266, y: 0.263, z: 0.217 }, 12200, "fec6271639df5aff9f8ac75d6679385eab2abb7c8d2f51abeba3ed689ddb6f0d"),
  kenney("kitchenFridgeLarge", { x: 0.52, y: 0.92, z: 0.406 }, 30632, "5851cc59c7e12f6f34a01a2ea93d5b9540be4078c1b703f517239fcede98fb32"),
  kenney("kitchenStove", { x: 0.43, y: 0.45, z: 0.45 }, 54324, "3239edb36295dfca9530a9b9a6ad0aff98ce62e7cf8d13ca2a5a1a6b2a904656"),
  kenney("shower", { x: 0.562, y: 1.094, z: 0.582 }, 52020, "25c1cebad681fe369dc04839a8f08f5da2ccbd99b3a70aa83fe2e4d1590c6951"),
  kenney("washer", { x: 0.39, y: 0.47, z: 0.39 }, 48104, "0c9704df1817d2699b72305b96cde097c9558bacabaef2fd5ab1ff4c03b81abf"),
  kenney("dryer", { x: 0.39, y: 0.47, z: 0.38 }, 17760, "d8b727612fdfc141c0b56360f75b897f1b71d3420c8c0942b5ec626bd3c8303c"),
  kenney("cabinetTelevision", { x: 0.8, y: 0.31, z: 0.25 }, 10524, "811719593d676ff76f7b5904d52c845ce0396af2bc9a6a2636c4818ead320b99"),
  kenney("lampRoundTable", { x: 0.152, y: 0.314, z: 0.176 }, 6604, "75bb644caaa3da003b4fcad7a931722dd61cd2858aab70cf660021d5061fa1b2"),
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
  "sofa-3seat": "kenney/loungeSofa",
  armchair: "kenney/loungeChair",
  "coffee-table": "kenney/tableCoffee",
  desk: "kenney/desk",
  nightstand: "kenney/cabinetBedDrawerTable",
  refrigerator: "kenney/kitchenFridgeLarge",
  range: "kenney/kitchenStove",
  shower: "kenney/shower",
  washer: "kenney/washer",
  dryer: "kenney/dryer",
  "tv-stand": "kenney/cabinetTelevision",
  "table-lamp": "kenney/lampRoundTable",
});

/** Largest allowed ratio between the model's two plan scale factors. */
export const MAX_PLAN_DISTORTION = 1.25;

/**
 * Largest allowed ratio (either way) between the model's natural height at
 * this footprint and the catalog height — so a bar-counter model can't turn
 * a 36" kitchen island into a 71" one.
 */
export const MAX_HEIGHT_RATIO = 1.4;

export function furnitureAsset(assetId) {
  return FURNITURE_ASSETS.find((a) => a.assetId === assetId);
}

/**
 * Scale factors that put `asset` on a widthIn x depthIn footprint:
 * { scale: {x, y, z}, distortion, heightRatio, ok }. distortion = larger
 * plan scale / smaller plan scale (1 = no stretching); heightRatio = the
 * model's resulting height / heightIn (null when heightIn is not given, in
 * which case only the footprint rule applies).
 */
export function fitFurnitureModel(asset, { widthIn, depthIn, heightIn }) {
  const x = widthIn / asset.nativeSize.x;
  const z = depthIn / asset.nativeSize.z;
  const y = (x + z) / 2;
  const distortion = Math.max(x, z) / Math.min(x, z);
  const heightRatio = heightIn > 0 ? (asset.nativeSize.y * y) / heightIn : null;
  const heightOk = heightRatio === null || (heightRatio <= MAX_HEIGHT_RATIO && 1 / heightRatio <= MAX_HEIGHT_RATIO);
  return {
    scale: { x, y, z },
    distortion,
    heightRatio,
    ok: Number.isFinite(distortion) && distortion <= MAX_PLAN_DISTORTION && heightOk,
  };
}

/**
 * How a piece should render in 3D:
 *   { kind: "model", asset, fit } — a vendored model fits this footprint
 *   { kind: "procedural" }        — use furnitureParts() instead
 */
export function resolveFurnitureRepresentation(catalogId, { widthIn, depthIn, heightIn } = {}) {
  const asset = furnitureAsset(FURNITURE_MODEL_FOR_CATALOG[catalogId]);
  if (!asset || !(widthIn > 0) || !(depthIn > 0)) return { kind: "procedural" };
  const fit = fitFurnitureModel(asset, { widthIn, depthIn, heightIn });
  return fit.ok ? { kind: "model", asset, fit } : { kind: "procedural" };
}
