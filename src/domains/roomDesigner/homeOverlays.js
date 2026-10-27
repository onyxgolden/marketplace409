// Home overlay foundation (H0 — FORGE Designer home parity, brief §3/§4).
//
// An optional per-level `homeOverlays` version-1 block lives on a
// room-designer document (design.homeOverlays). Absence means "no overlays
// authored", never fabricated devices. The block is home-only data: canvas,
// hit-testing, and print selectors gate on home mode (see homeLayers.js);
// validation here is mode-independent and fail-closed, so malformed overlay
// metadata is refused wherever it is encountered, including an industrial
// document that somehow carries it.
//
// Record contract (brief §3, minimum):
//   device     { id, catalogId, x, y, rotationDeg?, linkedBaseRef?, ports? }
//   run        { id, service, points, startRef?, endRef?, attributes? }
//   node       { id, kind, x, y, ports? }
//   annotation { id, targetRef?, text, position }
// Endpoint references are structured, never concatenated labels:
//   ref { levelId, trade, entityKind: "device"|"node", entityId, portId }
// A missing endpoint is an explicitly open draft run, not a connection.
// Crossings are graphical intersections unless an explicit junction exists.
// Hidden trade objects keep their data and links; hiding never deletes,
// disconnects, or changes estimates. Identical ids in different levels or
// trades are distinct by construction: identity is (levelId, trade, id).
//
// This module is pure data + validation — no React, no registry imports,
// no catalog lookups — so the document model, the reducer, and tests can
// all share it without import cycles. Device catalogIds are NOT resolved
// here: the trade catalogs land with slices H6–H8, and H0 must not hardcode
// their ids. A catalogId only has to be a non-empty string at this layer.
//
// Unknown fields are rejected at every level (block, trade collection,
// entity, endpoint ref, attributes). Attribute values are flat scalars
// only, and keys that could carry a URL, script, or resource reference are
// refused: labels and annotations are escaped by their renderers, but the
// stored record must never become an active-content carrier.

export const HOME_OVERLAYS_VERSION = 1;

export const HOME_OVERLAY_TRADES = Object.freeze(["electrical", "plumbing", "hvac"]);

/** Closed port-service vocabulary per trade. A port's service must be one
 * of its trade's entries; a run's service must be one as well. */
export const HOME_OVERLAY_TRADE_SERVICES = Object.freeze({
  electrical: Object.freeze(["circuit", "switch-control"]),
  plumbing: Object.freeze(["cold", "hot", "waste", "vent"]),
  hvac: Object.freeze(["supply", "return", "exhaust"]),
});

/** Closed node kinds. Covers the H6–H8 needs known at H0: junctions,
 * fittings, manifolds/shutoffs/transitions, riser stubs (§3 cross-level),
 * and DWV cleanouts / vent terminals (H7). */
export const HOME_OVERLAY_NODE_KINDS = Object.freeze([
  "junction",
  "tee",
  "elbow",
  "manifold",
  "shutoff",
  "transition",
  "riser-stub",
  "cleanout",
  "vent-terminal",
]);

/** Entity kinds an endpoint reference may address. */
export const HOME_OVERLAY_ENTITY_KINDS = Object.freeze(["device", "node"]);

/** Base-plan fixture kinds a device may link to by stable reference
 * (existing furniture/symbol instances — never a duplicate symbol). */
export const HOME_OVERLAY_BASE_REF_KINDS = Object.freeze(["furniture", "symbol"]);

const DEVICE_FIELDS = Object.freeze([
  "id",
  "catalogId",
  "x",
  "y",
  "rotationDeg",
  "linkedBaseRef",
  "ports",
]);
const RUN_FIELDS = Object.freeze([
  "id",
  "service",
  "points",
  "startRef",
  "endRef",
  "attributes",
]);
const NODE_FIELDS = Object.freeze(["id", "kind", "x", "y", "ports"]);
const ANNOTATION_FIELDS = Object.freeze(["id", "targetRef", "text", "position"]);
const COLLECTION_FIELDS = Object.freeze(["devices", "runs", "nodes", "annotations"]);
const REF_FIELDS = Object.freeze(["levelId", "trade", "entityKind", "entityId", "portId"]);
const BASE_REF_FIELDS = Object.freeze(["kind", "id"]);
/** A point is exactly { x, y } — no nested extras. Unknown nested fields
 * are validation problems, never silently dropped by normalization. */
const POINT_FIELDS = Object.freeze(["x", "y"]);

/** Attribute keys that could carry a URL, script, or resource reference.
 * Exact (case-insensitive) matches, plus onXxx event-handler shapes. */
const RESOURCE_KEY_PATTERN = /^(url|href|src|dataurl|script)$/i;
const HANDLER_KEY_PATTERN = /^on[A-Z]/;

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** A point is exactly { x, y } with finite coordinates. Unknown nested
 * fields are problems (H679-001): validation runs before normalization,
 * so a bad point is refused rather than silently repaired. */
function checkPoint(point, where, problems) {
  if (!isPlainObject(point)) {
    problems.push(`${where} must be a point object.`);
    return;
  }
  checkUnknownFields(point, POINT_FIELDS, where, problems);
  if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
    problems.push(`${where} must have finite x/y.`);
  }
}

function checkUnknownFields(object, allowed, where, problems) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) problems.push(`${where} has unknown field "${key}".`);
  }
}

function checkId(value, where, problems) {
  if (!isNonEmptyString(value)) problems.push(`${where} must have a non-empty string id.`);
}

function checkPortList(ports, trade, where, problems) {
  if (ports === undefined) return;
  if (!Array.isArray(ports)) {
    problems.push(`${where} ports must be an array.`);
    return;
  }
  const services = HOME_OVERLAY_TRADE_SERVICES[trade];
  const seen = new Set();
  for (const port of ports) {
    const at = `${where} port ${port?.id ?? "?"}`;
    if (!isPlainObject(port)) {
      problems.push(`${at} must be an object.`);
      continue;
    }
    checkUnknownFields(port, ["id", "service"], at, problems);
    checkId(port.id, at, problems);
    if (port.id && seen.has(port.id)) problems.push(`${at} has a duplicate port id.`);
    if (port.id) seen.add(port.id);
    if (!services.includes(port.service)) {
      problems.push(`${at} has unknown service "${port.service}" for trade "${trade}".`);
    }
  }
}

/**
 * Validate one endpoint reference. When expectedTrade is given, the ref
 * must address that trade: a run/annotation endpoint inside a trade
 * collection never points at another trade's entity (cross-trade
 * coincident ids never imply connection).
 */
export function validateEndpointRef(ref, expectedTrade, where) {
  const problems = [];
  const at = where || "endpoint ref";
  if (!isPlainObject(ref)) {
    problems.push(`${at} must be an object.`);
    return problems;
  }
  checkUnknownFields(ref, REF_FIELDS, at, problems);
  if (!isNonEmptyString(ref.levelId)) problems.push(`${at} must have a non-empty levelId.`);
  if (!HOME_OVERLAY_TRADES.includes(ref.trade)) {
    problems.push(`${at} has unknown trade "${ref.trade}".`);
  } else if (expectedTrade !== undefined && ref.trade !== expectedTrade) {
    problems.push(`${at} addresses trade "${ref.trade}" but lives in "${expectedTrade}".`);
  }
  if (!HOME_OVERLAY_ENTITY_KINDS.includes(ref.entityKind)) {
    problems.push(`${at} has unknown entityKind "${ref.entityKind}".`);
  }
  if (!isNonEmptyString(ref.entityId)) problems.push(`${at} must have a non-empty entityId.`);
  if (!isNonEmptyString(ref.portId)) problems.push(`${at} must have a non-empty portId.`);
  return problems;
}

/** Build a validated endpoint reference (frozen). Throws on malformed input. */
export function makeEndpointRef({ levelId, trade, entityKind, entityId, portId }) {
  const ref = { levelId, trade, entityKind, entityId, portId };
  const problems = validateEndpointRef(ref);
  if (problems.length > 0) throw new Error(`Invalid endpoint ref: ${problems[0]}`);
  return Object.freeze({ ...ref });
}

/** Structural equality for endpoint references. */
export function refsEqual(a, b) {
  if (a === b) return true;
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  return (
    a.levelId === b.levelId &&
    a.trade === b.trade &&
    a.entityKind === b.entityKind &&
    a.entityId === b.entityId &&
    a.portId === b.portId
  );
}

function checkAttributes(attributes, where, problems) {
  if (attributes === undefined) return;
  if (!isPlainObject(attributes)) {
    problems.push(`${where} attributes must be an object.`);
    return;
  }
  for (const [key, value] of Object.entries(attributes)) {
    if (key.trim() === "") {
      problems.push(`${where} attributes must not have blank keys.`);
      continue;
    }
    if (RESOURCE_KEY_PATTERN.test(key) || HANDLER_KEY_PATTERN.test(key)) {
      problems.push(`${where} attribute "${key}" could carry a URL, script, or resource reference.`);
      continue;
    }
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "boolean" &&
      !isFiniteNumber(value)
    ) {
      problems.push(`${where} attribute "${key}" must be a flat scalar (string, finite number, boolean, or null).`);
    }
  }
}

function checkRunPoints(points, where, problems) {
  if (!Array.isArray(points) || points.length < 2) {
    problems.push(`${where} must have at least two points.`);
    return;
  }
  points.forEach((point, index) => checkPoint(point, `${where} point ${index + 1}`, problems));
}

function validateTradeCollection(collection, trade, where) {
  const problems = [];
  if (collection === undefined) return problems;
  if (!isPlainObject(collection)) {
    problems.push(`${where} must be an object.`);
    return problems;
  }
  checkUnknownFields(collection, COLLECTION_FIELDS, where, problems);
  const checkUnique = (items, kind) => {
    if (items === undefined) return;
    if (!Array.isArray(items)) {
      problems.push(`${where} ${kind} must be an array.`);
      return;
    }
    const seen = new Set();
    for (const item of items) {
      if (item?.id && seen.has(item.id)) {
        problems.push(`${where} ${kind} "${item.id}" is duplicated.`);
      }
      if (item?.id) seen.add(item.id);
    }
  };
  const devices = Array.isArray(collection.devices) ? collection.devices : [];
  const runs = Array.isArray(collection.runs) ? collection.runs : [];
  const nodes = Array.isArray(collection.nodes) ? collection.nodes : [];
  const annotations = Array.isArray(collection.annotations) ? collection.annotations : [];
  checkUnique(collection.devices, "device");
  checkUnique(collection.runs, "run");
  checkUnique(collection.nodes, "node");
  checkUnique(collection.annotations, "annotation");
  const services = HOME_OVERLAY_TRADE_SERVICES[trade];
  for (const device of devices) {
    const at = `${where} device ${device?.id ?? "?"}`;
    if (!isPlainObject(device)) {
      problems.push(`${at} must be an object.`);
      continue;
    }
    checkUnknownFields(device, DEVICE_FIELDS, at, problems);
    checkId(device.id, at, problems);
    if (!isNonEmptyString(device.catalogId)) {
      problems.push(`${at} must have a non-empty catalogId.`);
    }
    if (!isFiniteNumber(device.x) || !isFiniteNumber(device.y)) {
      problems.push(`${at} must have finite x/y.`);
    }
    if (device.rotationDeg !== undefined && !isFiniteNumber(device.rotationDeg)) {
      problems.push(`${at} rotationDeg must be finite.`);
    }
    if (device.linkedBaseRef !== undefined) {
      const ref = device.linkedBaseRef;
      const rat = `${at} linkedBaseRef`;
      if (!isPlainObject(ref)) {
        problems.push(`${rat} must be an object.`);
      } else {
        checkUnknownFields(ref, BASE_REF_FIELDS, rat, problems);
        if (!HOME_OVERLAY_BASE_REF_KINDS.includes(ref.kind)) {
          problems.push(`${rat} has unknown kind "${ref.kind}".`);
        }
        if (!isNonEmptyString(ref.id)) problems.push(`${rat} must have a non-empty id.`);
      }
    }
    checkPortList(device.ports, trade, at, problems);
  }
  for (const run of runs) {
    const at = `${where} run ${run?.id ?? "?"}`;
    if (!isPlainObject(run)) {
      problems.push(`${at} must be an object.`);
      continue;
    }
    checkUnknownFields(run, RUN_FIELDS, at, problems);
    checkId(run.id, at, problems);
    if (!services.includes(run.service)) {
      problems.push(`${at} has unknown service "${run.service}" for trade "${trade}".`);
    }
    checkRunPoints(run.points, at, problems);
    if (run.startRef !== undefined) {
      problems.push(...validateEndpointRef(run.startRef, trade, `${at} startRef`));
    }
    if (run.endRef !== undefined) {
      problems.push(...validateEndpointRef(run.endRef, trade, `${at} endRef`));
    }
    checkAttributes(run.attributes, at, problems);
  }
  for (const node of nodes) {
    const at = `${where} node ${node?.id ?? "?"}`;
    if (!isPlainObject(node)) {
      problems.push(`${at} must be an object.`);
      continue;
    }
    checkUnknownFields(node, NODE_FIELDS, at, problems);
    checkId(node.id, at, problems);
    if (!HOME_OVERLAY_NODE_KINDS.includes(node.kind)) {
      problems.push(`${at} has unknown kind "${node.kind}".`);
    }
    if (!isFiniteNumber(node.x) || !isFiniteNumber(node.y)) {
      problems.push(`${at} must have finite x/y.`);
    }
    checkPortList(node.ports, trade, at, problems);
  }
  for (const annotation of annotations) {
    const at = `${where} annotation ${annotation?.id ?? "?"}`;
    if (!isPlainObject(annotation)) {
      problems.push(`${at} must be an object.`);
      continue;
    }
    checkUnknownFields(annotation, ANNOTATION_FIELDS, at, problems);
    checkId(annotation.id, at, problems);
    if (typeof annotation.text !== "string") {
      problems.push(`${at} must have string text.`);
    }
    checkPoint(annotation.position, `${at} position`, problems);
    if (annotation.targetRef !== undefined) {
      problems.push(...validateEndpointRef(annotation.targetRef, trade, `${at} targetRef`));
    }
  }
  return problems;
}

/**
 * Structural validation for a homeOverlays block. Returns a list of
 * human-readable problems; empty means valid. Absent blocks are not
 * validated here — absence means "no overlays", and validateDesign only
 * calls this when the field is present.
 */
export function validateHomeOverlays(block) {
  if (!isPlainObject(block)) return ["homeOverlays must be an object."];
  const problems = [];
  checkUnknownFields(block, ["version", ...HOME_OVERLAY_TRADES], "homeOverlays", problems);
  if (block.version !== HOME_OVERLAYS_VERSION) {
    problems.push(`homeOverlays version must be ${HOME_OVERLAYS_VERSION}.`);
  }
  for (const trade of HOME_OVERLAY_TRADES) {
    problems.push(...validateTradeCollection(block[trade], trade, `homeOverlays.${trade}`));
  }
  return problems;
}

function normalizeCollection(collection, trade) {
  const out = { devices: [], runs: [], nodes: [], annotations: [] };
  if (collection === undefined) return out;
  const normalizePorts = (ports) =>
    (ports || []).map((port) => ({ id: port.id, service: port.service }));
  out.devices = (collection.devices || []).map((device) => {
    const next = {
      id: device.id,
      catalogId: device.catalogId,
      x: device.x,
      y: device.y,
      rotationDeg: device.rotationDeg ?? 0,
    };
    if (device.linkedBaseRef !== undefined) {
      next.linkedBaseRef = { kind: device.linkedBaseRef.kind, id: device.linkedBaseRef.id };
    }
    if (device.ports !== undefined) next.ports = normalizePorts(device.ports);
    return next;
  });
  out.runs = (collection.runs || []).map((run) => {
    const next = {
      id: run.id,
      service: run.service,
      points: run.points.map((point) => ({ x: point.x, y: point.y })),
    };
    if (run.startRef !== undefined) next.startRef = { ...run.startRef };
    if (run.endRef !== undefined) next.endRef = { ...run.endRef };
    if (run.attributes !== undefined) next.attributes = { ...run.attributes };
    return next;
  });
  out.nodes = (collection.nodes || []).map((node) => {
    const next = { id: node.id, kind: node.kind, x: node.x, y: node.y };
    if (node.ports !== undefined) next.ports = normalizePorts(node.ports);
    return next;
  });
  out.annotations = (collection.annotations || []).map((annotation) => {
    const next = {
      id: annotation.id,
      text: annotation.text,
      position: { x: annotation.position.x, y: annotation.position.y },
    };
    if (annotation.targetRef !== undefined) next.targetRef = { ...annotation.targetRef };
    return next;
  });
  return out;
}

/**
 * Normalize a homeOverlays block into canonical form (missing collections
 * become empty arrays, rotationDeg defaults to 0). Throws on the first
 * validation problem — malformed metadata is refused, never silently
 * repaired. The input block is never mutated.
 */
export function normalizeHomeOverlays(block) {
  const problems = validateHomeOverlays(block);
  if (problems.length > 0) throw new Error(`Invalid homeOverlays: ${problems[0]}`);
  const out = { version: HOME_OVERLAYS_VERSION };
  for (const trade of HOME_OVERLAY_TRADES) {
    out[trade] = normalizeCollection(block[trade], trade);
  }
  return out;
}

/** A canonical empty block: every trade collection present but empty. */
export function emptyHomeOverlays() {
  return normalizeHomeOverlays({ version: HOME_OVERLAYS_VERSION });
}

/**
 * Set (or clear) a design's homeOverlays block. A block is validated and
 * normalized; null/undefined removes the field entirely, restoring the
 * legacy "no overlays" shape. The input design is never mutated.
 */
export function setHomeOverlays(design, block) {
  if (!isPlainObject(design)) throw new Error("setHomeOverlays needs a design object.");
  if (block === null || block === undefined) {
    const { homeOverlays: _dropped, ...rest } = design;
    return rest;
  }
  return { ...design, homeOverlays: normalizeHomeOverlays(block) };
}

/** The design's stored block, or undefined when none was authored. */
export function getHomeOverlays(design) {
  return design?.homeOverlays;
}

/** Find a device/node inside one level's block by entity kind + id. */
export function findOverlayEntity(collection, entityKind, entityId) {
  if (!isPlainObject(collection)) return null;
  const list = entityKind === "device" ? collection.devices : collection.nodes;
  if (!Array.isArray(list)) return null;
  return list.find((entity) => entity?.id === entityId) || null;
}

/**
 * Resolve an endpoint reference inside one level's block. Returns the
 * referenced entity, or null when the level, trade, entity, or port does
 * not resolve — a null here is a dangling link, never a cross-level or
 * cross-trade leap: the ref's levelId must equal the level being resolved
 * and its trade must equal the collection's trade.
 */
export function resolveEndpointRef(block, ref, levelId, trade) {
  if (!isPlainObject(block) || !isPlainObject(ref)) return null;
  if (ref.levelId !== levelId || ref.trade !== trade) return null;
  const collection = block[trade];
  const entity = findOverlayEntity(collection, ref.entityKind, ref.entityId);
  if (!entity) return null;
  const ports = Array.isArray(entity.ports) ? entity.ports : [];
  return ports.some((port) => port.id === ref.portId) ? entity : null;
}

function collectRefs(collection, trade) {
  const found = [];
  if (!isPlainObject(collection)) return found;
  for (const run of collection.runs || []) {
    if (run.startRef) found.push({ where: `run ${run.id} startRef`, ref: run.startRef });
    if (run.endRef) found.push({ where: `run ${run.id} endRef`, ref: run.endRef });
  }
  for (const annotation of collection.annotations || []) {
    if (annotation.targetRef) {
      found.push({ where: `annotation ${annotation.id} targetRef`, ref: annotation.targetRef });
    }
  }
  return found;
}

/**
 * Every endpoint reference in one level's block that does not resolve to a
 * live entity + port. Each entry names where the ref lives and why it
 * dangles; an empty list means every authored link resolves. A missing
 * endpoint (no ref at all) is an open draft run, not a dangling link, and
 * is not reported here.
 */
export function findDanglingRefs(block, levelId) {
  const dangling = [];
  if (!isPlainObject(block)) return dangling;
  for (const trade of HOME_OVERLAY_TRADES) {
    const collection = block[trade];
    for (const { where, ref } of collectRefs(collection, trade)) {
      if (ref.levelId !== levelId) {
        dangling.push({ where, ref, reason: "levelId does not match this level" });
        continue;
      }
      if (ref.trade !== trade) {
        dangling.push({ where, ref, reason: "trade does not match this collection" });
        continue;
      }
      const entity = findOverlayEntity(collection, ref.entityKind, ref.entityId);
      if (!entity) {
        dangling.push({ where, ref, reason: "entity does not exist" });
        continue;
      }
      const ports = Array.isArray(entity.ports) ? entity.ports : [];
      if (!ports.some((port) => port.id === ref.portId)) {
        dangling.push({ where, ref, reason: "port does not exist on the entity" });
      }
    }
  }
  return dangling;
}

/**
 * Endpoint-compatibility problems for one run: a referenced endpoint must
 * resolve, and its port's service must equal the run's service. A
 * wrong-service connection is flagged, never joined by proximity; a
 * missing endpoint is an open draft run and is not a problem here.
 */
export function checkRunEndpointCompatibility(block, run, levelId) {
  const problems = [];
  if (!isPlainObject(block) || !isPlainObject(run)) return ["run must be an object."];
  const trade = run.service ? tradeOfService(run.service) : null;
  for (const [key, ref] of [
    ["startRef", run.startRef],
    ["endRef", run.endRef],
  ]) {
    if (ref === undefined) continue;
    const at = `run ${run.id} ${key}`;
    const collection = trade ? block[trade] : undefined;
    const entity = collection
      ? findOverlayEntity(collection, ref.entityKind, ref.entityId)
      : null;
    if (!entity || ref.levelId !== levelId || ref.trade !== trade) {
      problems.push(`${at} does not resolve to a live endpoint.`);
      continue;
    }
    const port = (entity.ports || []).find((p) => p.id === ref.portId);
    if (!port) {
      problems.push(`${at} references a missing port.`);
    } else if (port.service !== run.service) {
      problems.push(
        `${at} port service "${port.service}" does not match run service "${run.service}".`,
      );
    }
  }
  return problems;
}

/** The trade that owns a service id, or null when the service is unknown. */
export function tradeOfService(service) {
  for (const trade of HOME_OVERLAY_TRADES) {
    if (HOME_OVERLAY_TRADE_SERVICES[trade].includes(service)) return trade;
  }
  return null;
}

/**
 * Remap endpoint references for copy/paste and level operations. Pure:
 * the input block is never mutated.
 *
 *   mapping.sourceLevelId — the level the moved/copied content comes
 *     from. REQUIRED whenever mapping.levelId is given: without proven
 *     source-level belonging, no level rewrite happens at all (a bare
 *     levelId rewrite throws instead of rebinding foreign refs).
 *   mapping.levelId — when given (with sourceLevelId), refs proven to
 *     belong to the source level are rewritten to it (level duplication
 *     / move). Foreign refs (levelId !== sourceLevelId) are NEVER
 *     rebound: in default mode a non-colliding foreign ref is kept
 *     exactly as-is (still dangling, never falsely connected); in
 *     dropUnmappedRefs mode it is dropped and reported in `dropped`.
 *     EXCEPTION (H679-002A): a foreign ref whose levelId EQUALS the
 *     destination level is dropped with a report in EVERY mode — kept
 *     bytes would resolve accidentally against the moved block's own
 *     same-id entities, silently turning a dangling link into a valid
 *     one. Preserved unresolvedness, not preserved bytes, is the rule.
 *   mapping.ids — { [trade]: { [entityKind]: { [oldId]: newId } } }.
 *     When ids is ABSENT, a source-level ref keeps its entity id: the
 *     whole level moved, so every source ref follows it. When ids is
 *     PRESENT, a ref is rewritten only with an explicit entry; without
 *     one it is kept as-is (default) or dropped and reported
 *     (dropUnmappedRefs) — never rebound to a same-id entity in the
 *     target level. No automatic cross-level network joining. The
 *     drop-on-unmapped rule applies to level-changing AND id-only
 *     remaps alike (H679-002A), including annotation targets.
 *   dropUnmappedRefs — when true, a ref with NO intended mapping is
 *     dropped (set to undefined) and reported in `dropped`, so a paste
 *     never falsely connects to the original's entities. When false (the
 *     default), unmapped refs are kept as-is — level switches and saves
 *     preserve references — except colliding foreign refs, which drop
 *     in every mode (see above).
 *
 * Returns { block, dropped: [{ where, ref }] }. The returned block is
 * re-validated; a mapping that would produce an invalid block throws.
 */
export function remapOverlayReferences(block, mapping = {}) {
  const problems = validateHomeOverlays(block);
  if (problems.length > 0) throw new Error(`Cannot remap invalid homeOverlays: ${problems[0]}`);
  const levelId = mapping.levelId;
  const sourceLevelId = mapping.sourceLevelId;
  if (levelId !== undefined && sourceLevelId === undefined) {
    throw new Error(
      "remapOverlayReferences requires sourceLevelId when levelId is given: refusing blanket level replacement.",
    );
  }
  const ids = mapping.ids;
  const dropUnmapped = mapping.dropUnmappedRefs === true;
  const dropped = [];
  const remapRef = (ref, where) => {
    if (ref === undefined) return undefined;
    // Foreign refs are never rebound, in either mode. A foreign ref
    // whose level IS the destination is dropped with a report in every
    // mode: kept bytes would resolve accidentally against the moved
    // block's own same-id entities (H679-002A). Non-colliding foreign
    // refs stay as-is (still dangling) in default mode.
    if (sourceLevelId !== undefined && ref.levelId !== sourceLevelId) {
      if (levelId !== undefined && ref.levelId === levelId) {
        dropped.push({ where, ref: { ...ref } });
        return undefined;
      }
      if (dropUnmapped) {
        dropped.push({ where, ref: { ...ref } });
        return undefined;
      }
      return { ...ref };
    }
    let next = { ...ref };
    if (levelId !== undefined) {
      // Level rewrite: source-level refs only, with whole-level move
      // (no ids map) or an explicit entity entry. Without an entry the
      // ref is not rebound to a same-id entity in the target level.
      const tradeMap = ids?.[ref.trade]?.[ref.entityKind];
      if (ids === undefined) {
        next.levelId = levelId;
      } else if (tradeMap && tradeMap[ref.entityId] !== undefined) {
        next.levelId = levelId;
        next.entityId = tradeMap[ref.entityId];
      } else if (dropUnmapped) {
        dropped.push({ where, ref: { ...ref } });
        return undefined;
      } else {
        return { ...ref };
      }
    } else {
      // No level rewrite: id mapping only (a level mismatch still
      // dangles, so id mapping alone can never resurrect a foreign ref).
      // When an id map is PRESENT, a ref without an explicit entry is
      // unmapped: kept as-is in default mode, dropped with a report in
      // dropUnmappedRefs mode (H679-002A — the id-only branch previously
      // never applied the drop). No map at all means no-op preservation.
      const tradeMap = ids?.[ref.trade]?.[ref.entityKind];
      if (tradeMap && tradeMap[ref.entityId] !== undefined) {
        next.entityId = tradeMap[ref.entityId];
      } else if (ids !== undefined && dropUnmapped) {
        dropped.push({ where, ref: { ...ref } });
        return undefined;
      }
    }
    return next;
  };
  const out = { version: HOME_OVERLAYS_VERSION };
  for (const trade of HOME_OVERLAY_TRADES) {
    const collection = block[trade] || { devices: [], runs: [], nodes: [], annotations: [] };
    out[trade] = {
      devices: (collection.devices || []).map((d) => ({ ...d })),
      runs: (collection.runs || []).map((run) => {
        const next = { ...run };
        const start = remapRef(run.startRef, `run ${run.id} startRef`);
        const end = remapRef(run.endRef, `run ${run.id} endRef`);
        if (start === undefined) delete next.startRef;
        else next.startRef = start;
        if (end === undefined) delete next.endRef;
        else next.endRef = end;
        return next;
      }),
      nodes: (collection.nodes || []).map((n) => ({ ...n })),
      annotations: (collection.annotations || []).map((annotation) => {
        const next = { ...annotation };
        const target = remapRef(annotation.targetRef, `annotation ${annotation.id} targetRef`);
        if (target === undefined) delete next.targetRef;
        else next.targetRef = target;
        return next;
      }),
    };
  }
  const after = validateHomeOverlays(out);
  if (after.length > 0) throw new Error(`Remap produced invalid homeOverlays: ${after[0]}`);
  return { block: out, dropped };
}
