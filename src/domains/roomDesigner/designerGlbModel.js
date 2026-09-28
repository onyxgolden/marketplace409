// Room Designer -> .glb export (Phase 1: minimal viable export).
//
// One-click export of the current Room Designer document to a self-contained
// binary glTF 2.0 file, fully client-side via three.js r186 GLTFExporter.
// The export reflects the on-screen design, including unsaved edits — the
// same "print what you see" contract as the DXF export.
//
// Phase 1 scope: walls (+ window sills/headers), window glass, floor, and
// furniture as plain boxes. Flat MeshStandardMaterial colors only — no
// textures, so the whole pipeline runs headless (GLTFExporter only touches
// the DOM when it has images to encode). Stairs, equipment, and overlays
// arrive in later phases.
//
// A dedicated offscreen scene is built from the pure descriptors
// (buildThreeScene) — the live viewport scene is never exported, so no
// selection highlights, ghosts, grids, or camera rigs can leak into the file.

import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { buildThreeScene } from "./designerThreeModel";

/** Inches -> meters. Exactly one conversion point: the export root group. */
export const IN_TO_M = 0.0254;

// Flat Phase-1 palette, mirroring the viewport's untextured materials.
const WALL_COLOR = "#ece8dc";
const TRIM_COLOR = "#d9d2c2";
const GLASS_COLOR = "#bcd6e8";
const FLOOR_COLOR = "#a98f66";
const FURNITURE_FALLBACK_COLOR = "#9aa3b2";

const DEFAULT_WALL_HEIGHT_IN = 108;
const DEFAULT_WALL_THICKNESS_IN = 4.5;
// Wall/glass segments shorter or flatter than this are skipped, not errored
// (mirrors the viewport).
const MIN_SEGMENT_IN = 0.5;

/** File-safe design name for the export root node (64 chars, fallback). */
function safeDesignName(name) {
  const clean = String(name || "design")
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return clean || "design";
}

/** Node names must be unique across the export; ids already are — this is defensive. */
function uniqueName(used, base) {
  let name = base;
  let n = 2;
  while (used.has(name)) {
    name = `${base}_${n}`;
    n += 1;
  }
  used.add(name);
  return name;
}

/** Viewport-style material cache: one material per color|roughness|transparent key. */
function cachedMaterial(cache, { color, roughness, transparent = false, opacity = 1 }) {
  const key = `${color}|${roughness}|${transparent}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness: 0,
        transparent,
        opacity,
        ...(transparent ? { depthWrite: false } : {}),
      }),
    );
  }
  return cache.get(key);
}

/**
 * Map pure scene descriptors to a three.js group (inches — the caller owns
 * the single inches->meters conversion on the root).
 *
 * Returns { group, stats }. Stats: walls, wallSegments, glassPanes,
 * furniture, stairs, equipment, meshes, materials, skipped (bytes are added
 * by exportDesignToGlb after serialization).
 */
export function sceneDescriptorsToThree(scene, options = {}) {
  const {
    includeFloor = true,
    includeFurniture = true,
    designName = "design",
    rooms = [],
    // Exactly one conversion point for the whole export: the root group
    // scales inches -> meters. Everything below stays in inches.
    unitScale = IN_TO_M,
  } = options;
  const used = new Set();
  const materials = new Map();
  const stats = {
    walls: 0,
    wallSegments: 0,
    glassPanes: 0,
    furniture: 0,
    stairs: 0,
    equipment: 0,
    meshes: 0,
    materials: 0,
    skipped: 0,
  };

  const root = new THREE.Group();
  root.name = uniqueName(used, `forge_design_${safeDesignName(designName)}`);
  root.scale.set(unitScale, unitScale, unitScale);
  // r186 GLTFExporter has no asset.extras option, so the unit/axis
  // convention travels on the root node's userData -> glTF extras.
  root.userData = {
    forgeUnits: "m",
    forgeSourceUnits: "in",
    forgeAxes: "+x right, +y up, +z plan-down",
  };

  const wallMat = () => cachedMaterial(materials, { color: WALL_COLOR, roughness: 0.95 });
  const trimMat = () => cachedMaterial(materials, { color: TRIM_COLOR, roughness: 0.9 });
  const glassMat = () =>
    cachedMaterial(materials, {
      color: GLASS_COLOR,
      roughness: 0.1,
      transparent: true,
      opacity: 0.22,
    });
  const floorMat = () => cachedMaterial(materials, { color: FLOOR_COLOR, roughness: 0.9 });
  const furnitureMat = (color) =>
    cachedMaterial(materials, { color: color || FURNITURE_FALLBACK_COLOR, roughness: 0.8 });

  // ---- walls (+ window sills/headers) ----
  const wallsGroup = new THREE.Group();
  wallsGroup.name = uniqueName(used, "walls");
  const segIndexByWall = new Map();
  for (const seg of scene.walls || []) {
    const length = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
    const height = seg.y1In - seg.y0In;
    if (!(length >= MIN_SEGMENT_IN) || !(height >= MIN_SEGMENT_IN)) {
      stats.skipped += 1;
      continue;
    }
    const idx = (segIndexByWall.get(seg.wallId) || 0) + 1;
    segIndexByWall.set(seg.wallId, idx);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(length, height, seg.thicknessIn ?? DEFAULT_WALL_THICKNESS_IN),
      seg.kind === "wall" ? wallMat() : trimMat(),
    );
    const angle = Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x);
    mesh.position.set((seg.a.x + seg.b.x) / 2, seg.y0In + height / 2, (seg.a.y + seg.b.y) / 2);
    mesh.rotation.y = -angle;
    mesh.name = uniqueName(used, `forge_wall_${seg.wallId}_seg${idx}`);
    mesh.userData = { entityKind: seg.openingId ? "opening" : "wall", entityId: seg.openingId || seg.wallId };
    wallsGroup.add(mesh);
    stats.wallSegments += 1;
  }
  if (wallsGroup.children.length > 0) root.add(wallsGroup);

  // ---- window glass ----
  const glassGroup = new THREE.Group();
  glassGroup.name = uniqueName(used, "openings");
  for (const pane of scene.glass || []) {
    const length = Math.hypot(pane.b.x - pane.a.x, pane.b.y - pane.a.y);
    const height = pane.y1In - pane.y0In;
    if (!(length >= MIN_SEGMENT_IN) || !(height >= MIN_SEGMENT_IN)) {
      stats.skipped += 1;
      continue;
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(length, height), glassMat());
    const angle = Math.atan2(pane.b.y - pane.a.y, pane.b.x - pane.a.x);
    mesh.position.set((pane.a.x + pane.b.x) / 2, pane.y0In + height / 2, (pane.a.y + pane.b.y) / 2);
    mesh.rotation.y = -angle;
    mesh.name = uniqueName(used, `forge_opening_${pane.openingId}_glass`);
    mesh.userData = { entityKind: "opening", entityId: pane.openingId };
    glassGroup.add(mesh);
    stats.glassPanes += 1;
  }
  if (glassGroup.children.length > 0) root.add(glassGroup);

  // ---- floor ----
  if (includeFloor && scene.floor) {
    const f = scene.floor;
    const fw = f.maxX - f.minX;
    const fd = f.maxZ - f.minZ;
    if (fw > 0 && fd > 0) {
      const floorGroup = new THREE.Group();
      floorGroup.name = uniqueName(used, "floors");
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), floorMat());
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((f.minX + f.maxX) / 2, -0.5, (f.minZ + f.maxZ) / 2);
      mesh.name = uniqueName(used, "forge_floor");
      mesh.userData = { entityKind: "floor" };
      floorGroup.add(mesh);
      root.add(floorGroup);
    }
  }

  // ---- furniture (Phase 1: plain boxes from the catalog footprint) ----
  if (includeFurniture) {
    const furnitureGroup = new THREE.Group();
    furnitureGroup.name = uniqueName(used, "furniture");
    for (const item of scene.furniture || []) {
      const fGroup = new THREE.Group();
      fGroup.name = uniqueName(used, `forge_furniture_${item.id}`);
      fGroup.position.set(item.x, item.elevationIn || 0, item.z);
      fGroup.rotation.y = item.rotY || 0;
      const mesh = new THREE.Mesh(
        // BoxGeometry is (width X, height Y, depth Z): the descriptor's
        // depthIn is the plan depth (glTF Z), heightIn is vertical (glTF Y).
        new THREE.BoxGeometry(item.widthIn, item.heightIn, item.depthIn),
        furnitureMat(item.color),
      );
      mesh.position.set(0, item.heightIn / 2, 0);
      mesh.name = uniqueName(used, `forge_furniture_${item.id}_body`);
      mesh.userData = {
        entityKind: "furniture",
        entityId: item.id,
        catalogId: item.catalogId,
        label: item.label,
      };
      fGroup.add(mesh);
      furnitureGroup.add(fGroup);
      stats.furniture += 1;
    }
    if (furnitureGroup.children.length > 0) root.add(furnitureGroup);
  }

  // ---- rooms: no mesh of their own (same as the 3D view); empty groups
  // carrying label + wallIds in extras so downstream tools can rebuild them.
  // Kept even though the children are empty — unlike the geometry groups.
  if ((rooms || []).length > 0) {
    const roomsGroup = new THREE.Group();
    roomsGroup.name = uniqueName(used, "rooms");
    for (const room of rooms) {
      const g = new THREE.Group();
      g.name = uniqueName(used, `forge_room_${room.id}`);
      g.userData = {
        entityKind: "room",
        entityId: room.id,
        label: room.label,
        wallIds: room.wallIds || [],
      };
      roomsGroup.add(g);
    }
    root.add(roomsGroup);
  }

  root.traverse((o) => {
    if (o.isMesh) stats.meshes += 1;
  });
  stats.materials = materials.size;
  return { group: root, stats };
}

/**
 * Validate a design for GLB export. Returns problems[] (first problem is
 * shown — the same convention as planToDxf).
 */
export function validateForGlb(design) {
  if (!design || !Array.isArray(design.walls)) {
    return ["Not a room-designer document."];
  }
  const problems = [];
  const wallCount = design.walls.length;
  const furnitureCount = (design.furniture || []).length;
  const equipmentCount = (design.equipment || []).length;
  if (wallCount === 0 && furnitureCount === 0 && equipmentCount === 0) {
    problems.push("Nothing to export — add walls or furniture first.");
  }
  const wallHeightIn = design.settings?.wallHeightIn ?? DEFAULT_WALL_HEIGHT_IN;
  const wallThicknessIn = design.settings?.wallThicknessIn ?? DEFAULT_WALL_THICKNESS_IN;
  if (!(wallHeightIn > 0) || !(wallThicknessIn > 0)) {
    problems.push("Wall height and thickness must be positive (check Settings).");
  }
  const finite = (n) => typeof n === "number" && Number.isFinite(n);
  let badCoords = false;
  for (const w of design.walls) {
    if (![w.a?.x, w.a?.y, w.b?.x, w.b?.y].every(finite)) {
      badCoords = true;
      break;
    }
  }
  if (!badCoords) {
    for (const f of design.furniture || []) {
      if (![f.x, f.y].every(finite)) {
        badCoords = true;
        break;
      }
    }
  }
  if (badCoords) {
    problems.push("Design contains invalid coordinates — fix them and try again.");
  }
  return problems;
}

/** `<safe-name>-YYYYMMDD.glb` — same sanitizer as dxfFileName. */
export function glbFileName(projectName, when) {
  const safe =
    String(projectName || "design")
      .replace(/[\\/:*?"<>|]/g, "-")
      .trim()
      .slice(0, 80) || "design";
  const d = when instanceof Date ? when : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${safe}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.glb`;
}

/**
 * Export a room-designer document to a .glb ArrayBuffer.
 * Resolves { ok: true, glb: ArrayBuffer, stats } or { ok: false, error }.
 */
export async function exportDesignToGlb(design, options = {}) {
  try {
    const problems = validateForGlb(design);
    if (problems.length > 0) {
      return { ok: false, error: problems[0] };
    }
    const scene = buildThreeScene(design);
    const { group, stats } = sceneDescriptorsToThree(scene, {
      includeFloor: options.includeFloor !== false,
      includeFurniture: options.includeFurniture !== false,
      designName: design.name,
      rooms: design.rooms || [],
    });
    stats.walls = design.walls.length;
    // buildThreeScene drops furniture with an unknown catalogId — count
    // those as skipped, never as an error.
    stats.skipped += Math.max(0, (design.furniture || []).length - scene.furniture.length);

    const exportScene = new THREE.Scene();
    exportScene.add(group);

    const exporter = new GLTFExporter();
    const glb = await exporter.parseAsync(exportScene, {
      binary: true,
      trs: true,
      onlyVisible: true,
      animations: [],
    });
    stats.bytes = glb.byteLength;
    return { ok: true, glb, stats };
  } catch (err) {
    return { ok: false, error: (err && err.message) || "Could not export GLB." };
  }
}
