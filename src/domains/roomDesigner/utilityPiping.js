// Utility piping: plant water, plant air, and nitrogen.
//
// Every in-scope vessel carries three STABLE base utility ports, one
// per service. In-scope vessels are an explicit catalog ID list
// (UTILITY_VESSEL_SYMBOL_IDS: vessels, drums, tanks, spheres,
// columns, reactors/regenerator) — never a shape heuristic, never
// racks/motors/structures. A port is
// a real service point, distinct from the vessel's process nozzles:
// it has a local position along the base edge, a world elevation
// (24 in — a low, accessible base region), an outward face normal, a
// size, a parent vessel, and a closed service identity. Ports are
// derived from the catalog + instance, so they survive branch
// detachment (a detached/capped port simply does not count as
// supplied) and follow the vessel through move/rotate/resize.
//
// The networks are three separate closed identities, not labels:
//   - a run carries `run.utility` with the service id;
//   - each service has an authored header and a designated source /
//     battery-limit inlet run (`run.sourceOf`);
//   - a port counts as SUPPLIED only when a branch run attached to it
//     reaches that source through modeled junctions, traversing only
//     runs of the same service identity. Color, service text, and
//     physical proximity never establish connectivity, and teeing one
//     service into another (or into a process network — plant water
//     is NOT the cooling-water circuit) is a named mismatch finding.
//
// Validation reports per vessel/service: missing port, missing or
// disconnected supply path, wrong-service connection, plus the shared
// connection compatibility (flange size/elevation) and crossing
// checks. It runs only once a design carries a utility system at all
// — legacy drawings without utilities open untouched, with no routes
// generated and no geometry rewritten.
//
// Pure and framework-free.

import { findSymbol } from "./symbolRegistry";
import { runPathToSource, runReachesSource, serviceSourceRun } from "./pipeCrossings";

/**
 * Utility sizing (Jason's pin, 2026-10-22): headers are 2-inch pipe;
 * the drops from a header to each vessel's base utility station are
 * 1-inch pipe. These are the defaults for new utility runs — every
 * run's size stays editable per run like any other piping.
 */
export const UTILITY_HEADER_DIAMETER_IN = 2;
export const UTILITY_DROP_DIAMETER_IN = 1;

/** The three utility services every vessel carries, in header order. */
export const UTILITY_SERVICES = Object.freeze([
  Object.freeze({ id: "plant-water", label: "Plant water", anchorId: "utility-plant-water", sizeIn: UTILITY_DROP_DIAMETER_IN }),
  Object.freeze({ id: "plant-air", label: "Plant air", anchorId: "utility-plant-air", sizeIn: UTILITY_DROP_DIAMETER_IN }),
  Object.freeze({ id: "nitrogen", label: "Nitrogen", anchorId: "utility-nitrogen", sizeIn: UTILITY_DROP_DIAMETER_IN }),
]);

/** Firewater is a utility service too, but not a vessel-base service. */
export const FIREWATER_SERVICE = Object.freeze({ id: "firewater", label: "Firewater" });

const SERVICE_BY_ANCHOR = new Map(UTILITY_SERVICES.map((s) => [s.anchorId, s]));
const SERVICE_BY_ID = new Map(
  [...UTILITY_SERVICES, FIREWATER_SERVICE].map((s) => [s.id, s]),
);

/**
 * Base-edge anchor specs for a vessel's utility connections, in the
 * nozzle fractional frame (fy = 1 is the base edge in plan). Positions
 * are offset from the process-nozzle spots so the connections read as
 * their own points along the base.
 */
export const UTILITY_ANCHOR_SPECS = Object.freeze([
  Object.freeze({ id: "utility-plant-water", fx: -0.6, fy: 1, sizeIn: UTILITY_DROP_DIAMETER_IN }),
  Object.freeze({ id: "utility-plant-air", fx: 0.2, fy: 1, sizeIn: UTILITY_DROP_DIAMETER_IN }),
  Object.freeze({ id: "utility-nitrogen", fx: 0.6, fy: 1, sizeIn: UTILITY_DROP_DIAMETER_IN }),
]);

/**
 * The in-scope vessel catalog IDs for base utilities — named
 * explicitly (vessels, drums, tanks, spheres, columns, and reactor /
 * regenerator vessels), never derived from a shape heuristic and
 * never applied to racks, motors, or other structures.
 */
export const UTILITY_VESSEL_SYMBOL_IDS = Object.freeze(
  new Set([
    // Vessels, drums, tanks, spheres (the manway class)
    "vertical-vessel",
    "horizontal-drum",
    "knockout-drum",
    "three-phase-separator",
    "reflux-accumulator",
    "storage-tank",
    "dome-roof-tank",
    "floating-roof-tank",
    "pressure-sphere",
    "lpg-bullet",
    "day-tank",
    "agitated-tank",
    "deaerator",
    // Columns
    "column",
    "packed-column",
    "absorber",
    "stripper",
    "vacuum-column",
    // Reactors and the regenerator
    "jacketed-reactor",
    "fixed-bed-reactor",
    "fluidized-bed-reactor",
    "catalyst-regenerator",
    "tubular-reactor",
  ]),
);

/** World elevation (in) of a vessel's base utility ports. */
export const UTILITY_PORT_ELEVATION_IN = 24;

/** In-scope vessel symbols: the explicit catalog list above. */
export function isVesselSymbol(symbol) {
  return Boolean(symbol?.id) && UTILITY_VESSEL_SYMBOL_IDS.has(symbol.id);
}

/** The utility service an anchor id belongs to, or null. */
export function utilityServiceForAnchor(anchorId) {
  return SERVICE_BY_ANCHOR.get(anchorId) || null;
}

/** The utility service descriptor for a service id, or null. */
export function utilityService(serviceId) {
  return SERVICE_BY_ID.get(serviceId) || null;
}

/**
 * World utility anchors for a vessel instance (same projection as the
 * catalog nozzle anchors), or [] for out-of-scope symbols. Carries the
 * port elevation so attachments land at the flange face.
 */
export function utilityAnchorsWorld(symbol, inst) {
  return utilityPortDescriptors(symbol, inst).map((port) => ({
    id: port.id,
    x: port.x,
    y: port.y,
    sizeIn: port.sizeIn,
    elevationIn: port.elevationIn,
  }));
}

/**
 * A vessel's three base utility ports as real service points:
 * [{ id, serviceId, label, parentId, localX, localY, x, y, dirX, dirY,
 *    elevationIn, sizeIn }]
 * (dirX, dirY) is the outward face normal in world plan coordinates
 * (the base edge faces +fy in the local frame). Three distinct points
 * along the base — never coincident. Derived from catalog + instance,
 * so a port follows its vessel through move/rotate/resize and remains
 * when every branch is detached.
 */
export function utilityPortDescriptors(symbol, inst) {
  if (!isVesselSymbol(symbol) || !inst) return [];
  const effWidth = inst.widthIn ?? symbol.widthIn;
  const effDepth = inst.depthIn ?? symbol.depthIn;
  const rad = ((inst.rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Outward normal of the base edge: local (0, 1) rotated to world.
  const dirX = 0 * cos - 1 * sin;
  const dirY = 0 * sin + 1 * cos;
  return UTILITY_ANCHOR_SPECS.map((spec) => {
    const lx = spec.fx * (effWidth / 2);
    const ly = spec.fy * (effDepth / 2);
    const service = utilityServiceForAnchor(spec.id);
    return {
      id: spec.id,
      serviceId: service?.id || null,
      label: service?.label || spec.id,
      parentId: inst.id,
      localX: lx,
      localY: ly,
      x: inst.x + lx * cos - ly * sin,
      y: inst.y + lx * sin + ly * cos,
      dirX,
      dirY,
      elevationIn: UTILITY_PORT_ELEVATION_IN,
      sizeIn: spec.sizeIn,
    };
  });
}

/** Services actually connected to one vessel instance in a design. */
export function vesselUtilities(design, instanceId) {
  const connected = new Set();
  for (const run of design?.pipes || []) {
    for (const ref of Object.values(run.attachments || {})) {
      if (ref?.symbolId !== instanceId) continue;
      const service = utilityServiceForAnchor(ref.anchorId);
      if (service) connected.add(service.id);
    }
  }
  return connected;
}

/** True when the design carries any utility piping at all. */
export function designHasUtilitySystem(design) {
  return (design?.pipes || []).some(
    (run) =>
      run.utility !== undefined ||
      Object.values(run.attachments || {}).some((ref) => utilityServiceForAnchor(ref?.anchorId)),
  );
}

/**
 * True when the design carries any of the three vessel-base (D8)
 * services — a firewater-only design does not demand plant water,
 * plant air, or nitrogen.
 */
export function designHasD8System(design) {
  const ids = new Set(UTILITY_SERVICES.map((s) => s.id));
  return (design?.pipes || []).some(
    (run) =>
      ids.has(run.utility) ||
      Object.values(run.attachments || {}).some((ref) => utilityServiceForAnchor(ref?.anchorId)),
  );
}

/**
 * The authored utility connection table (acceptance evidence):
 * one row per in-scope vessel × required service —
 * { vesselId, vesselTag, serviceId, basePortId, branchRunIds,
 *   headerId, sourceRunId, supplied }
 * headerId is the intermediate run between the branch and the source
 * on the modeled path (null when the branch tees straight onto the
 * source or no path exists); supplied is the graph verdict.
 */
export function utilityConnectionTable(design) {
  const rows = [];
  for (const inst of design?.symbols || []) {
    const symbol = findSymbol(inst.domain, inst.symbolId);
    if (!isVesselSymbol(symbol)) continue;
    for (const port of utilityPortDescriptors(symbol, inst)) {
      const branchRunIds = (design.pipes || [])
        .filter((run) =>
          Object.values(run.attachments || {}).some(
            (ref) => ref?.symbolId === inst.id && ref?.anchorId === port.id,
          ),
        )
        .map((run) => run.id);
      let headerId = null;
      let sourceRunId = null;
      let supplied = false;
      const source = port.serviceId ? serviceSourceRun(design, port.serviceId) : null;
      if (source) sourceRunId = source.id;
      for (const branchId of branchRunIds) {
        const path = port.serviceId ? runPathToSource(design, branchId, port.serviceId) : null;
        if (path) {
          supplied = true;
          headerId = path.length >= 3 ? path[path.length - 2] : null;
          break;
        }
      }
      rows.push({
        vesselId: inst.id,
        vesselTag: inst.tag || inst.id,
        serviceId: port.serviceId,
        basePortId: port.id,
        branchRunIds,
        headerId,
        sourceRunId,
        supplied,
      });
    }
  }
  return rows;
}

/**
 * validateDesign messages for the utility system. Per vessel/service
 * the findings distinguish: missing port, no connected branch
 * (missing supply path), wrong-service connection, and a branch that
 * does not reach the service's designated source through same-service
 * modeled junctions (disconnected supply path). Runs only once the
 * design carries a utility system at all.
 */
export function utilityPipingErrors(design) {
  const errors = [];
  for (const run of design?.pipes || []) {
    if (run.utility !== undefined && !utilityService(run.utility)) {
      errors.push(`Pipe run ${run.id} names an unknown utility service: ${run.utility}.`);
    }
  }
  if (!designHasD8System(design)) return errors;
  for (const inst of design?.symbols || []) {
    const symbol = findSymbol(inst.domain, inst.symbolId);
    if (!isVesselSymbol(symbol)) continue;
    const tag = inst.tag || inst.id;
    const ports = utilityPortDescriptors(symbol, inst);
    for (const service of UTILITY_SERVICES) {
      const port = ports.find((p) => p.serviceId === service.id);
      if (!port) {
        errors.push(`Vessel ${tag} (${symbol.label}) is missing its ${service.label} base utility port.`);
        continue;
      }
      const branches = (design.pipes || []).filter((run) =>
        Object.values(run.attachments || {}).some(
          (ref) => ref?.symbolId === inst.id && ref?.anchorId === port.id,
        ),
      );
      if (branches.length === 0) {
        errors.push(
          `Vessel ${tag} ${service.label} port ${port.id} has no connected branch — missing supply path.`,
        );
        continue;
      }
      for (const branch of branches) {
        if (branch.utility !== service.id) {
          errors.push(
            `Vessel ${tag} ${service.label} port ${port.id} is connected to pipe run ${branch.id} carrying ${branch.utility ? `service ${branch.utility}` : "no utility identity"} — wrong-service connection.`,
          );
        } else if (!runReachesSource(design, branch.id, service.id)) {
          errors.push(
            `Vessel ${tag} ${service.label} port ${port.id}: branch ${branch.id} has no connected path to the designated ${service.label} source through ${service.label} piping — disconnected supply path.`,
          );
        }
      }
    }
  }
  return errors;
}
