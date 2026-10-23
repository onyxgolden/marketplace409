// Pure 3D scene description for the FORGE room/layout designer.
//
// Converts a 2D design document into renderable primitives WITHOUT touching
// WebGL, so the geometry stays unit-testable. The React component
// (DesignerViewport3D) maps these descriptors to three.js meshes.
//
// Plan coordinates map to three.js as x -> x, y -> z (plan "down" becomes
// +z, which reads naturally in an orbit view). All units are inches.

import { getCatalogEntry } from "./furnitureCatalog";
import {
  nearestPointOnSegment,
  wallDirection,
  wallLength,
} from "./designerGeometry";
import { physicalRouteIn, vertexElevationsForDesign } from "./pipeCrossings";
import { DECK_MATERIALS, decksOf, findWall, pieceSize } from "./designerDocument";
import { findSymbol } from "./symbolRegistry";
import { PROCESS_EQUIPMENT_DOMAIN } from "./processEquipmentCatalog";
import { STAIR_ANNOTATION_SOURCE } from "./sampleProjects";
import { effectiveColor } from "./designSystems";
import { finalPipeColor } from "./pipeColorPolicy";
import { teeFittings, anchorsOf, connectionFaceForAnchor } from "./pipeAttachments";
import { modeledHeadHeightIn } from "./downcomers";
import { reducerInterfaces } from "./pipeReducerModel";
import { rackMembers3D, rackParams, rackTopIn } from "./rackGeometry";
import {
  connectionFlanges,
  runHasStoredElevation,
  storedSegmentElevations,
  vertexElevationsForDesign,
} from "./pipeCrossings";

export const WINDOW_SILL_IN = 36;
export const WINDOW_HEADER_IN = 84;

// Symbol domain for the site/outdoor catalog (decks, patios, fences, ...).
// The catalog module registers the set but does not export a domain
// constant, so it lives here next to the other 3D pipeline constants.
export const SITE_OUTDOOR_DOMAIN = "siteOutdoor";

// Nominal 3D heights (inches) for site/outdoor symbols. Surfaces render as
// flat slabs at grade; structures/landscape render as low boxes on grade
// (the rectangular pool is recessed: its top sits at grade).
const SITE_OUTDOOR_HEIGHTS_IN = Object.freeze({
  deck: 4,
  patio: 4,
  driveway: 4,
  walkway: 4,
  fence: 48,
  shed: 96,
  "garden-bed": 12,
  "pool-rect": 24,
});
const SITE_OUTDOOR_DEFAULT_HEIGHT_IN = 24;

/**
 * Split a wall into solid segments around its openings.
 * Doors leave a full-height gap; windows leave a gap between the sill and
 * header, with solid boxes below and above. Returns segment descriptors:
 * { a, b, y0In, y1In, wallId, kind: "wall"|"sill"|"header", openingId? }
 */
export function splitWallByOpenings(wall, openings, { wallHeightIn }) {
  const length = wallLength(wall);
  const dir = wallDirection(wall);
  const at = (offsetIn) => ({
    x: wall.a.x + dir.x * offsetIn,
    y: wall.a.y + dir.y * offsetIn,
  });
  const sorted = [...openings]
    .filter((o) => o.wallId === wall.id)
    .sort((p, q) => p.offsetIn - q.offsetIn);

  const segments = [];
  let cursor = 0;
  const pushSolid = (from, to, kind, openingId) => {
    if (to - from < 0.5) return;
    segments.push({
      a: at(from),
      b: at(to),
      y0In: 0,
      y1In: wallHeightIn,
      wallId: wall.id,
      kind,
      ...(openingId ? { openingId } : {}),
    });
  };

  for (const opening of sorted) {
    const start = Math.max(opening.offsetIn, 0);
    const end = Math.min(opening.offsetIn + opening.widthIn, length);
    if (end <= start) continue;
    pushSolid(cursor, start, "wall");
    if (opening.type === "window") {
      const sillTop = Math.min(WINDOW_SILL_IN, wallHeightIn);
      const headerBottom = Math.min(WINDOW_HEADER_IN, wallHeightIn);
      if (sillTop > 0.5) {
        segments.push({
          a: at(start), b: at(end), y0In: 0, y1In: sillTop,
          wallId: wall.id, kind: "sill", openingId: opening.id,
        });
      }
      if (headerBottom < wallHeightIn - 0.5) {
        segments.push({
          a: at(start), b: at(end), y0In: headerBottom, y1In: wallHeightIn,
          wallId: wall.id, kind: "header", openingId: opening.id,
        });
      }
    }
    // doors: full-height gap, no segments emitted
    cursor = end;
  }
  pushSolid(cursor, length, "wall");
  return segments;
}

/** Window glass descriptors: one plane per window opening, spanning the gap
 * between the sill and header at the wall centerline.
 * { a, b, y0In, y1In, thicknessIn, wallId, openingId } */
export function windowGlassForWall(wall, openings, { wallHeightIn, wallThicknessIn }) {
  const length = wallLength(wall);
  const dir = wallDirection(wall);
  const glass = [];
  for (const opening of openings || []) {
    if (opening.wallId !== wall.id || opening.type !== "window") continue;
    const start = Math.max(opening.offsetIn, 0);
    const end = Math.min(opening.offsetIn + opening.widthIn, length);
    if (end - start < 0.5) continue;
    const y0In = Math.min(WINDOW_SILL_IN, wallHeightIn);
    const y1In = Math.min(WINDOW_HEADER_IN, wallHeightIn);
    if (y1In - y0In < 0.5) continue;
    glass.push({
      a: { x: wall.a.x + dir.x * start, y: wall.a.y + dir.y * start },
      b: { x: wall.a.x + dir.x * end, y: wall.a.y + dir.y * end },
      y0In,
      y1In,
      thicknessIn: wallThicknessIn,
      wallId: wall.id,
      openingId: opening.id,
    });
  }
  return glass;
}

/** Furniture piece -> 3D box descriptor. */
export function furnitureToBox(piece) {
  const catalog = getCatalogEntry(piece.catalogId);
  if (!catalog) return null;
  const { widthIn, depthIn, heightIn, mountIn } = pieceSize(piece);
  return {
    kind: "furniture",
    id: piece.id,
    catalogId: piece.catalogId,
    label: catalog.label,
    x: piece.x,
    z: piece.y,
    widthIn,
    depthIn,
    heightIn,
    // Wall cabinets and shelves hang above the floor; floor pieces are 0.
    elevationIn: mountIn,
    // screen-space clockwise degrees -> three.js counter-clockwise radians
    rotY: (-piece.rotationDeg * Math.PI) / 180,
    color: catalog.color,
    symbol: catalog.symbol,
  };
}

/**
 * Stairs: native 3D stair descriptors from the building-elements stair
 * symbols (stairs-straight / stairs-l / stairs-u), with a legacy fallback
 * for the sample's pre-symbol stair annotations.
 *
 * Pure and serializable: plain JSON, no three.js, camera-independent —
 * the same contract as furnitureToBox. The renderer owns geometry.
 *
 * Local frame (arch review: explicit convention): origin at the stair
 * footprint center; local +x is the ascent direction of the first run;
 * local +z is the stair width. Multi-run parts carry their own dir
 * ("positive-x" | "negative-x" | "positive-z" | "negative-z").
 *
 * Descriptor:
 * { kind:"stairs", id, type, x, z, rotY, axis:"local-x",
 *   runDirection:"positive-x", widthIn, runIn, riseIn, baseElevationIn,
 *   validGeometry, warnings[], parts[] }
 * Run part:
 * { kind:"run", x0, z0, dx, dz, dir, widthIn, y0, riseIn, steps, treadIn, riserIn }
 *   (x0,z0) = plan corner where the ascent starts; dx/dz signed extents.
 * Landing part:
 * { kind:"landing", x0, z0, dx, dz, y0, thicknessIn } (y0 = top surface).
 *
 * baseElevationIn is the slice-2 hook: 0 today (single-level 3D has no
 * upper slab), the level's elevation when levels stack. warnings is
 * non-blocking honesty metadata — the renderer still draws unrealistic
 * geometry, it just doesn't pretend it's valid.
 */

/** Max riser height (in) used when deriving step counts. */
export const STAIR_MAX_RISER_IN = 7.75;
/** Recommended minimum tread depth (in); shallower runs warn, never block. */
export const STAIR_MIN_TREAD_IN = 10;

const STAIR_SYMBOL_TYPES = Object.freeze({
  "stairs-straight": "straight",
  "stairs-l": "l",
  "stairs-u": "u",
});

function stairRunPart({ x0, z0, dx, dz, dir, widthIn, y0, riseIn }) {
  // Run length is along the ascent axis named by dir; the other axis is width.
  const length = dir === "positive-x" || dir === "negative-x" ? Math.abs(dx) : Math.abs(dz);
  const steps = Math.max(1, Math.ceil(riseIn / STAIR_MAX_RISER_IN));
  const treadIn = length / steps;
  const riserIn = riseIn / steps;
  return { kind: "run", x0, z0, dx, dz, dir, widthIn, y0, riseIn, steps, treadIn, riserIn };
}

function stairLandingPart({ x0, z0, dx, dz, y0, thicknessIn = 4 }) {
  return { kind: "landing", x0, z0, dx, dz, y0, thicknessIn };
}

function straightStairParts(runIn, widthIn, riseIn) {
  return [
    stairRunPart({ x0: -runIn / 2, z0: -widthIn / 2, dx: runIn, dz: widthIn, dir: "positive-x", widthIn, y0: 0, riseIn }),
  ];
}

function lStairParts(w, d, riseIn) {
  const runW = 0.55 * d;
  const half = riseIn / 2;
  return [
    stairRunPart({ x0: -w / 2, z0: -d / 2, dx: 0.625 * w, dz: runW, dir: "positive-x", widthIn: runW, y0: 0, riseIn: half }),
    stairLandingPart({ x0: w / 8, z0: -d / 2, dx: runW, dz: runW, y0: half }),
    stairRunPart({ x0: w / 8, z0: -d / 2 + runW, dx: runW, dz: d / 2 - (-d / 2 + runW), dir: "positive-z", widthIn: runW, y0: half, riseIn: half }),
  ];
}

function uStairParts(w, d, riseIn) {
  const runW = 0.325 * d;
  const half = riseIn / 2;
  return [
    stairRunPart({ x0: w / 2, z0: -d / 2, dx: -w, dz: runW, dir: "negative-x", widthIn: runW, y0: 0, riseIn: half }),
    stairLandingPart({ x0: -w / 2, z0: -d / 2, dx: 2 * runW, dz: 2 * runW, y0: half }),
    stairRunPart({ x0: -w / 2, z0: d / 2 - runW, dx: w, dz: runW, dir: "positive-x", widthIn: runW, y0: half, riseIn: half }),
  ];
}

/** Non-blocking geometry honesty: warn, never refuse to describe. */
function stairWarnings(parts) {
  const warnings = [];
  for (const p of parts) {
    if (p.kind === "run" && p.treadIn < STAIR_MIN_TREAD_IN) {
      warnings.push(
        `Tread depth ${p.treadIn.toFixed(1)}" below recommended minimum ${STAIR_MIN_TREAD_IN}" — drawn as designed, verify against code.`,
      );
    }
  }
  return warnings;
}

function legacyStairBoxes(annotations) {
  const boxes = [];
  for (const a of annotations || []) {
    if (a.source !== STAIR_ANNOTATION_SOURCE || a.kind !== "path" || !a.closed) continue;
    const xs = a.points.map((p) => p.x);
    const ys = a.points.map((p) => p.y);
    if (xs.length === 0) continue;
    boxes.push({
      id: a.id,
      x1: Math.min(...xs),
      y1: Math.min(...ys),
      x2: Math.max(...xs),
      y2: Math.max(...ys),
    });
  }
  return boxes;
}

/**
 * Legacy stair annotation -> descriptor. Convention (documented): the run
 * follows the box's long axis, ascending toward increasing plan Y. Only
 * the Maplewood sample ever carries these annotations; native symbols
 * always win when both exist.
 */
function legacyStairDescriptor(box, riseIn) {
  const wX = box.x2 - box.x1;
  const wY = box.y2 - box.y1;
  const alongY = wY >= wX;
  const run = alongY ? wY : wX;
  const width = alongY ? wX : wY;
  const parts = straightStairParts(run, width, riseIn);
  const warnings = stairWarnings(parts);
  return {
    kind: "stairs",
    id: `legacy-${box.id}`,
    type: "straight",
    x: (box.x1 + box.x2) / 2,
    z: (box.y1 + box.y2) / 2,
    rotY: alongY ? -Math.PI / 2 : 0, // local +x -> plan +y, like rotationDeg 90
    axis: "local-x",
    runDirection: "positive-x",
    widthIn: width,
    runIn: run,
    riseIn,
    baseElevationIn: 0,
    validGeometry: warnings.length === 0,
    warnings,
    parts,
    legacy: true,
  };
}

/**
 * Stair descriptors for a design document. Native stair symbol placements
 * (priority 1); legacy stair annotations only when no native stair exists
 * (priority 2, arch review). Returns [] when the design has no stairs.
 */
export function stairsDescriptors(design) {
  if (!design) return [];
  const riseIn = design.settings?.wallHeightIn ?? 108;
  const out = [];
  for (const s of design.symbols || []) {
    const type = STAIR_SYMBOL_TYPES[s.symbolId];
    if (!type) continue;
    const symbol = findSymbol(s.domain, s.symbolId);
    const run = s.widthIn ?? symbol?.widthIn;
    const width = s.depthIn ?? symbol?.depthIn;
    if (!run || !width) continue;
    const parts =
      type === "straight"
        ? straightStairParts(run, width, riseIn)
        : type === "l"
          ? lStairParts(run, width, riseIn)
          : uStairParts(run, width, riseIn);
    const warnings = stairWarnings(parts);
    out.push({
      kind: "stairs",
      id: s.id,
      type,
      x: s.x,
      z: s.y,
      // screen-space clockwise degrees -> three.js counter-clockwise radians
      rotY: (-(s.rotationDeg || 0) * Math.PI) / 180,
      axis: "local-x",
      runDirection: "positive-x",
      widthIn: width,
      runIn: run,
      riseIn,
      baseElevationIn: 0,
      validGeometry: warnings.length === 0,
      warnings,
      parts,
    });
  }
  if (out.length === 0) {
    for (const box of legacyStairBoxes(design.annotations)) {
      out.push(legacyStairDescriptor(box, riseIn));
    }
  }
  return out;
}

/**
 * Process equipment -> 3D primitive descriptors (plain JSON, like
 * furnitureToBox): { kind:"equipment", id, shape:"vcyl"|"hcyl"|"box", x, z,
 * rotY, widthIn, depthIn, heightIn, color, tag }. Sits on the floor.
 * Other symbol domains have no 3D form yet and are skipped.
 */
export function equipmentDescriptors(design) {
  const out = [];
  for (const inst of design?.symbols || []) {
    if (inst.domain !== PROCESS_EQUIPMENT_DOMAIN) continue;
    const symbol = findSymbol(inst.domain, inst.symbolId);
    if (!symbol || !symbol.shape3d) continue;
    const rack = symbol.rack ? rackParams(symbol, inst) : null;
    out.push({
      kind: "equipment",
      id: inst.id,
      shape: symbol.shape3d,
      x: inst.x,
      z: inst.y,
      // screen-space clockwise degrees -> three.js counter-clockwise radians
      rotY: (-(inst.rotationDeg || 0) * Math.PI) / 180,
      widthIn: inst.widthIn ?? symbol.widthIn,
      depthIn: inst.depthIn ?? symbol.depthIn,
      // The instance's own dimensions and base (R4): a resized body
      // and a raised base are the modeled geometry in every consumer,
      // never the catalog default.
      heightIn: rack ? rackTopIn(rack) : (inst.heightIn ?? symbol.heightIn),
      baseElevationIn: Number.isFinite(inst.baseElevationIn) ? inst.baseElevationIn : 0,
      // The modeled head (R4): the same head height validation binds
      // terminal assemblies to, rendered by the 3D builder.
      ...(symbol.shape3d === "vcyl" ? { headIn: modeledHeadHeightIn(symbol, inst) } : {}),
      color: effectiveColor(design, inst, symbol.color), // own > system > catalog
      // Parametric structures: the members the 3D builder extrudes as steel.
      ...(rack ? { members: rackMembers3D(rack) } : {}),
      tag: inst.tag || "",
      // Lets the 3D builder specialize recognizable equipment (a pump reads
      // as motor + casing, a compressor as a single skid-mounted box).
      symbolId: inst.symbolId,
    });
  }
  return out;
}

/** Centerline elevation (in) for pipe that is not supported on a rack. */
export const PIPE_GRADE_ELEVATION_IN = 30;

/**
 * Pipe runs -> 3D descriptors (plain JSON, like equipmentDescriptors):
 * { kind:"pipe", id, color, diameterIn, radiusIn, underground,
 *   segments: [{ a:{x,z}, b:{x,z}, yIn }],
 *   joints: [{ x, z, yIn }],
 *   risers: [{ x, z, y0In, y1In }] }
 *
 * Plan coordinates map x -> x, y -> z. Segment elevation is derived,
 * never stored: a segment whose plan midpoint falls inside a rack
 * footprint rides at that rack's first-tier top of steel plus the pipe
 * radius; when several racks contain the midpoint the highest support
 * wins. The grade centerline (PIPE_GRADE_ELEVATION_IN) applies ONLY
 * when no rack contains the midpoint — a containing support below
 * grade (e.g. a sleeper rack) still sets the elevation, so the pipe
 * rests on it instead of floating at grade. Interior vertices where adjacent segment
 * elevations differ get a joint at the higher elevation and a riser
 * spanning the difference. Underground runs are described the same way,
 * with the flag carried through for the renderer.
 */
export function pipeDescriptors(design) {
  if (!design) return [];
  // Rack supports in the design: any symbol instance whose catalog entry
  // carries rack parameters, resolved like equipmentDescriptors does.
  const racks = [];
  for (const inst of design.symbols || []) {
    const symbol = findSymbol(inst.domain, inst.symbolId);
    if (!symbol?.rack) continue;
    const widthIn = inst.widthIn ?? symbol.widthIn;
    const depthIn = inst.depthIn ?? symbol.depthIn;
    if (!widthIn || !depthIn) continue;
    racks.push({ inst, widthIn, depthIn, elevationIn: rackParams(symbol, inst).elevationIn });
  }
  const segmentElevationIn = (midX, midY, radiusIn) => {
    // Highest CONTAINING support wins, chosen independently of grade:
    // grade is the fallback for unsupported segments only, never a
    // floor that lifts a pipe off a lower support it rests on.
    let supportIn = null;
    for (const rack of racks) {
      // Midpoint into the rack's local frame: translate to its center,
      // then rotate by -rotationDeg.
      const dx = midX - rack.inst.x;
      const dy = midY - rack.inst.y;
      const angle = (-(rack.inst.rotationDeg || 0) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      if (Math.abs(lx) <= rack.widthIn / 2 && Math.abs(ly) <= rack.depthIn / 2) {
        const candidateIn = rack.elevationIn + radiusIn;
        supportIn = supportIn === null ? candidateIn : Math.max(supportIn, candidateIn);
      }
    }
    return supportIn ?? PIPE_GRADE_ELEVATION_IN;
  };

  const out = [];
  for (const run of design.pipes || []) {
    const points = run.points || [];
    if (points.length < 2) continue;
    const diameterIn = run.diameterIn ?? 2;
    const radiusIn = diameterIn / 2;
    // Per-vertex true elevations (D668-002): y0In/y1In carry the actual
    // endpoint elevations from the shared physical profile, so a downward
    // jog's dip is visible in the descriptor. yIn keeps the rack/grade
    // level for rendering and existing consumers.
    const vertexElevs = vertexElevationsForDesign(design, run);
    const segments = [];
    for (let i = 0; i + 1 < points.length; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const yIn = segmentElevationIn((a.x + b.x) / 2, (a.y + b.y) / 2, radiusIn);
      const y0In = vertexElevs[i] ?? yIn;
      const y1In = vertexElevs[i + 1] ?? yIn;
      segments.push({
        a: { x: a.x, z: a.y },
        b: { x: b.x, z: b.y },
        yIn,
        y0In,
        y1In,
        // An authored (stored) elevation change across a plan
        // segment is a physical slope (R3): the renderer draws the
        // segment between its true endpoint elevations. A derived
        // profile's change is a step at the vertex instead (flat
        // segment + riser), so it is never flagged sloped.
        sloped: runHasStoredElevation(run) && y0In !== y1In,
      });
    }
    // A run with a STORED elevation profile (an explicit centerline, or
    // per-vertex elevations from level connections / crossing jogs)
    // renders at that profile instead of the derived support elevation.
    // Runs without one keep the derivation above, unchanged.
    if (runHasStoredElevation(run)) {
      const stored = storedSegmentElevations(run);
      segments.forEach((seg, i) => {
        if (i < stored.length) seg.yIn = stored[i];
      });
    }
    const joints = points.map((p, i) => {
      // Joints sit at the TRUE vertex elevations of the shared
      // physical route (R3) — the same elevations validation reads.
      return { x: p.x, z: p.y, yIn: vertexElevs[i] ?? segments[0]?.yIn ?? 0 };
    });
    // Risers are the route's vertical steps (R3), in the route's own
    // two forms: a STORED profile steps through zero-plan-length
    // vertex pairs (crossing jogs, authored risers); a DERIVED
    // profile steps at the vertex where the support elevation
    // changes (rack edge to grade). An authored elevation change
    // across a plan segment is a slope — the segment itself renders
    // it (see `sloped` below), never a slope plus a phantom riser.
    const risers = [];
    if (runHasStoredElevation(run)) {
      for (let i = 0; i + 1 < points.length; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-9) continue;
        const y0 = vertexElevs[i];
        const y1 = vertexElevs[i + 1];
        if (y0 === undefined || y1 === undefined || y0 === y1) continue;
        risers.push({
          x: a.x,
          z: a.y,
          y0In: Math.min(y0, y1),
          y1In: Math.max(y0, y1),
        });
      }
    } else {
      for (let i = 1; i + 1 < points.length; i += 1) {
        const prev = segments[i - 1].yIn;
        const next = segments[i].yIn;
        if (prev === next) continue;
        risers.push({
          x: points[i].x,
          z: points[i].y,
          y0In: Math.min(prev, next),
          y1In: Math.max(prev, next),
        });
      }
    }
    const descriptor = {
      kind: "pipe",
      id: run.id,
      // Final resolved color via the shared reservation policy
      // (D668-009): firewater renders the reserved red; any other red
      // on a non-firewater run is remapped off the red band.
      color: finalPipeColor(design, run),
      diameterIn,
      radiusIn,
      underground: !!run.underground,
      segments,
      joints,
      risers,
    };
    // Flanged connections (equipment nozzles + pipe-to-pipe junctions),
    // present only when this run actually connects somewhere.
    const flanges = connectionFlanges(design).filter((f) => f.runId === run.id);
    if (flanges.length > 0) {
      descriptor.flanges = flanges.map((f) => ({
        x: f.x,
        z: f.y,
        yIn: f.elevationIn,
        axisDeg: f.axisDeg,
        sizeIn: f.sizeIn,
        kind: f.kind,
      }));
    }
    out.push(descriptor);
  }
  return out;
}

/**
 * Piping-domain fitting instances -> 3D descriptors (D668-010, PR668-005):
 * standalone flanged-joint, blind-flange, fire-hydrant, spray-nozzle,
 * and reducer instances, PLUS the modeled tee fittings derived from
 * validated pipe-to-pipe junctions (body + ports, never just a flange
 * pair). { kind: "fitting", id, symbolId, x, z, rotY, elevationIn,
 *   sizes... }. Reducers carry their declared inletSizeIn/outletSizeIn;
 * tee fittings carry branchSizeIn/hostSizeIn and their port list.
 */
export function fittingDescriptors(design) {
  const out = [];
  for (const inst of design?.symbols || []) {
    if (inst.domain !== "piping") continue;
    const symbol = findSymbol(inst.domain, inst.symbolId);
    if (!symbol) continue;
    if (
      !["flanged-joint", "blind-flange", "fire-hydrant", "spray-nozzle", "reducer"].includes(
        inst.symbolId,
      )
    ) {
      continue;
    }
    out.push({
      kind: "fitting",
      id: inst.id,
      symbolId: inst.symbolId,
      x: inst.x,
      z: inst.y,
      rotY: (-(inst.rotationDeg || 0) * Math.PI) / 180,
      elevationIn: Number.isFinite(inst.elevationIn) ? inst.elevationIn : 0,
      widthIn: inst.widthIn ?? symbol.widthIn,
      depthIn: inst.depthIn ?? symbol.depthIn,
      ...(inst.symbolId === "reducer"
        ? {
            inletSizeIn: inst.inletSizeIn ?? null,
            outletSizeIn: inst.outletSizeIn ?? null,
            // The reducer's OWNED interfaces (R1): the ports the 3D
            // builder draws — position, elevation, direction, size —
            // are the same interfaces validation binds.
            interfaces: reducerInterfaces(inst)?.ports ?? [],
          }
        : {}),
      ...(inst.symbolId === "spray-nozzle"
        ? {
            // The discharge origin and aim validation consumes (D668-006).
            protects: inst.protects || null,
            aimAt:
              inst.aimAt && Number.isFinite(inst.aimAt.x) && Number.isFinite(inst.aimAt.y)
                ? { x: inst.aimAt.x, y: inst.aimAt.y }
                : null,
            // The discharge axis (R7), derived from the SAME
            // origin/target model validation checks: the unit plan
            // direction from the assembly to its authored aim point.
            // aimResolved false is the named unresolved state — no
            // aim (or an aim at the origin itself) — and the renderer
            // draws no barrel for it rather than inventing a direction.
            ...(() => {
              const aim =
                inst.aimAt && Number.isFinite(inst.aimAt.x) && Number.isFinite(inst.aimAt.y)
                  ? inst.aimAt
                  : null;
              if (!aim) return { dischargeDir: null, aimResolved: false };
              const dx = aim.x - inst.x;
              const dy = aim.y - inst.y;
              const len = Math.hypot(dx, dy);
              if (!(len > 1e-9)) return { dischargeDir: null, aimResolved: false };
              return { dischargeDir: { x: dx / len, y: dy / len }, aimResolved: true };
            })(),
          }
        : {}),
      tag: inst.tag || "",
    });
  }
  // Modeled tee fittings: the fitting body + ports from the shared
  // junction model (PR668-005).
  for (const tee of teeFittings(design)) {
    out.push({
      kind: "fitting",
      id: tee.id,
      symbolId: "tee-fitting",
      x: tee.x,
      z: tee.y,
      rotY: 0,
      elevationIn: tee.elevationIn,
      branchSizeIn: tee.branchSizeIn,
      hostSizeIn: tee.hostSizeIn,
      branchAxisDeg: tee.branchAxisDeg,
      hostAxisDeg: tee.hostAxisDeg,
      ports: tee.ports,
    });
  }
  return out;
}

/**
 * Nozzle flange discs for one equipment instance, from the SHARED
 * connection-face model (D668-005): [{ anchorId, x, yIn, z, sizeIn,
 * normal, vertical, kind }]. The 3D flange sits exactly at the face
 * validation checks — snap, reconcile, validation, and rendering can
 * never disagree.
 */
export function nozzleFlangeDescriptors(design, instanceId) {
  const inst = (design?.symbols || []).find((s) => s.id === instanceId);
  if (!inst) return [];
  const symbol = findSymbol(inst.domain, inst.symbolId);
  if (!symbol) return [];
  const out = [];
  for (const anchor of anchorsOf(inst)) {
    const face = connectionFaceForAnchor(symbol, inst, anchor.id);
    if (!face || !Number.isFinite(face.elevationIn)) continue;
    out.push({
      anchorId: anchor.id,
      x: face.x,
      yIn: face.elevationIn,
      z: face.y,
      sizeIn: face.sizeIn,
      normal: face.normal,
      vertical: face.vertical,
      kind: face.kind,
    });
  }
  return out;
}

/**
 * Site/outdoor symbols -> 3D descriptors (plain JSON, like equipmentDescriptors):
 * { kind:"siteOutdoor", id, symbolId, category, x, z, rotY, widthIn, depthIn,
 *   heightIn, baseYIn, color }. Surfaces (deck/patio/driveway/walkway) render
 * as flat slabs at grade; structures and landscape render as low boxes on
 * grade, except the rectangular pool which is recessed (top at grade).
 * Other symbol domains are handled elsewhere and are skipped here.
 */
export function siteOutdoorDescriptors(design) {
  const out = [];
  for (const inst of design?.symbols || []) {
    if (inst.domain !== SITE_OUTDOOR_DOMAIN) continue;
    const symbol = findSymbol(inst.domain, inst.symbolId);
    if (!symbol) continue;
    const heightIn =
      symbol.heightIn ??
      SITE_OUTDOOR_HEIGHTS_IN[inst.symbolId] ??
      SITE_OUTDOOR_DEFAULT_HEIGHT_IN;
    const recessed = inst.symbolId === "pool-rect";
    out.push({
      kind: "siteOutdoor",
      id: inst.id,
      symbolId: inst.symbolId,
      category: symbol.category,
      x: inst.x,
      z: inst.y,
      // screen-space clockwise degrees -> three.js counter-clockwise radians
      rotY: (-(inst.rotationDeg || 0) * Math.PI) / 180,
      widthIn: inst.widthIn ?? symbol.widthIn,
      depthIn: inst.depthIn ?? symbol.depthIn,
      heightIn,
      baseYIn: recessed ? -heightIn : 0,
      color: symbol.color,
    });
  }
  return out;
}

/**
 * Full scene descriptor for a design:
 * { walls: [...segments], glass: [...window panes], furniture: [...boxes], stairs: [...],
 *   equipment: [...primitives], siteOutdoor: [...descriptors], pipes: [...runs],
 *   decks: [...specs], floor: {minX,minZ,maxX,maxZ}|null }
 */
export function buildThreeScene(design) {
  if (!design || !Array.isArray(design.walls)) {
    throw new Error("Not a room-designer document.");
  }
  const wallHeightIn = design.settings?.wallHeightIn ?? 108;
  const wallThicknessIn = design.settings?.wallThicknessIn ?? 4.5;

  const walls = [];
  const glass = [];
  for (const wall of design.walls) {
    const segments = splitWallByOpenings(wall, design.openings || [], { wallHeightIn });
    for (const s of segments) {
      walls.push({ ...s, thicknessIn: wallThicknessIn });
    }
    glass.push(...windowGlassForWall(wall, design.openings || [], { wallHeightIn, wallThicknessIn }));
  }
  const furniture = (design.furniture || [])
    .map(furnitureToBox)
    .filter(Boolean);
  const stairs = stairsDescriptors(design);
  const equipment = equipmentDescriptors(design);
  const siteOutdoor = siteOutdoorDescriptors(design);
  const decks = decksOf(design).map((d) => {
    const spec = DECK_MATERIALS[d.material] || DECK_MATERIALS.wood;
    return {
      minX: Math.min(d.a.x, d.b.x),
      maxX: Math.max(d.a.x, d.b.x),
      minZ: Math.min(d.a.y, d.b.y),
      maxZ: Math.max(d.a.y, d.b.y),
      topYIn: -d.dropIn,
      thicknessIn: spec.thicknessIn,
      color: spec.color,
    };
  });
  const pipes = pipeDescriptors(design);

  let floor = null;
  const xs = [];
  const zs = [];
  for (const wall of design.walls) {
    xs.push(wall.a.x, wall.b.x);
    zs.push(wall.a.y, wall.b.y);
  }
  for (const f of [...furniture, ...equipment, ...siteOutdoor]) {
    xs.push(f.x - f.widthIn / 2, f.x + f.widthIn / 2);
    zs.push(f.z - f.depthIn / 2, f.z + f.depthIn / 2);
  }
  // Pipes frame the scene too: a pipes-only design (no wall, furniture
  // or equipment) still needs a floor under its runs, and a run that
  // extends past every other object must not fall outside the framed
  // floor. Plan extents are expanded by the pipe radius so the tube
  // itself, not just its centerline, sits inside the bounds.
  for (const pipe of pipes) {
    const r = pipe.radiusIn ?? (pipe.diameterIn ?? 0) / 2;
    const planPoints = [];
    for (const seg of pipe.segments || []) planPoints.push(seg.a, seg.b);
    for (const joint of pipe.joints || []) planPoints.push({ x: joint.x, z: joint.z });
    for (const riser of pipe.risers || []) planPoints.push({ x: riser.x, z: riser.z });
    for (const p of planPoints) {
      xs.push(p.x - r, p.x + r);
      zs.push(p.z - r, p.z + r);
    }
  }
  if (xs.length > 0) {
    const pad = 24;
    floor = {
      minX: Math.min(...xs) - pad,
      maxX: Math.max(...xs) + pad,
      minZ: Math.min(...zs) - pad,
      maxZ: Math.max(...zs) + pad,
    };
    floor.deckHoles = deckHolesInFloor(floor, decks);
  }
  return { walls, glass, furniture, stairs, equipment, siteOutdoor, decks, pipes, floor };
}

/**
 * Decks sit below the floor plane, so each deck's footprint inside the floor
 * rectangle is cut out of the floor, letting the deck show at its elevation.
 * Decks never overlap (addDeck rejects that), so the holes never overlap.
 */
export function deckHolesInFloor(floor, decks) {
  const holes = [];
  for (const d of decks) {
    const minX = Math.max(d.minX, floor.minX);
    const maxX = Math.min(d.maxX, floor.maxX);
    const minZ = Math.max(d.minZ, floor.minZ);
    const maxZ = Math.min(d.maxZ, floor.maxZ);
    if (maxX <= minX || maxZ <= minZ) continue;
    holes.push({ minX, maxX, minZ, maxZ });
  }
  return holes;
}

/** Find the wall whose centerline is nearest to a plan point (for picking). */
export function pickWallAt(design, point, maxDistanceIn = 12) {
  let best = null;
  let bestDistance = maxDistanceIn;
  for (const wall of design.walls || []) {
    const { point: nearest } = nearestPointOnSegment(point, wall.a, wall.b);
    const distance = Math.hypot(point.x - nearest.x, point.y - nearest.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = wall;
    }
  }
  return best;
}

export { findWall };

// ---------------------------------------------------------------------------
// Selection <-> 3D highlight mapping (P1-A: split-screen view sync)
//
// The 3D viewport tags every mesh it builds with a registry key so a 2D
// selection can find and highlight the matching mesh(es) without rebuilding
// the scene. This mapping — which registry key(s) a given 2D selection
// corresponds to — is pure and framework-free, so it belongs here rather
// than in the DesignerViewport3D component, and is unit-testable against
// plain design objects with no Three.js or DOM involved.
// ---------------------------------------------------------------------------

/** Registry key for a highlightable 3D entity. */
export function highlightRegistryKey(kind, id) {
  return `${kind}:${id}`;
}

/**
 * Which highlight-registry keys does a 2D selection correspond to in 3D?
 *
 * A room has no 3D mesh of its own — it highlights via its own walls. An
 * opening highlights via its window glass/sill/header (a door is an open
 * gap with no mesh, so it has nothing to highlight — that is correct
 * behavior, not a gap in coverage). A symbol maps to its own key: process
 * equipment is built as a 3D primitive registered under it, while other
 * symbol domains have no mesh, so their key simply matches nothing. A
 * pipe run maps to its own key: pipe runs are built as 3D meshes
 * registered under it.
 */
export function highlightKeysForSelection(selection, design) {
  if (!selection || !selection.kind) return [];
  if (selection.kind === "wall") return [highlightRegistryKey("wall", selection.id)];
  if (selection.kind === "opening") return [highlightRegistryKey("opening", selection.id)];
  if (selection.kind === "furniture") return [highlightRegistryKey("furniture", selection.id)];
  if (selection.kind === "symbol") return [highlightRegistryKey("symbol", selection.id)];
  if (selection.kind === "pipe") return [highlightRegistryKey("pipe", selection.id)];
  if (selection.kind === "room") {
    const room = (design?.rooms || []).find((r) => r.id === selection.id);
    return (room?.wallIds || []).map((id) => highlightRegistryKey("wall", id));
  }
  return [];
}
