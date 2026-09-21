// Pure 2D geometry helpers for the FORGE room/layout designer.
//
// All coordinates are in inches on a standard math-oriented plan grid
// (x right, y down — matching SVG screen space so plan math and rendering
// never need a flip). Angles are in degrees, lengths in inches.

export const DEFAULT_GRID_IN = 6;
export const DEFAULT_SNAP_RADIUS_IN = 9;

/** Visio-style grid spacing presets offered in the plan editor (inches). */
export const GRID_SPACING_OPTIONS = Object.freeze([6, 12]);

/**
 * A major (emphasized) grid line is drawn every N minor lines,
 * Visio-style. With the 6″ default this puts a major line every 30″.
 */
export const MAJOR_GRID_EVERY = 5;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export { isFiniteNumber };

export function isValidPoint(point) {
  return (
    !!point &&
    isFiniteNumber(point.x) &&
    isFiniteNumber(point.y)
  );
}

/** Euclidean length of a wall segment in inches. */
export function wallLength(wall) {
  if (!wall?.a || !wall?.b || !isValidPoint(wall.a) || !isValidPoint(wall.b)) {
    return 0;
  }
  return Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
}

/** Wall direction in degrees, 0 = east, positive clockwise (screen space). */
export function wallAngleDeg(wall) {
  if (!wall?.a || !wall?.b || !isValidPoint(wall.a) || !isValidPoint(wall.b)) {
    return 0;
  }
  const radians = Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x);
  return (radians * 180) / Math.PI;
}

/** Unit direction vector of a wall; {x:1,y:0} for a degenerate wall. */
export function wallDirection(wall) {
  const length = wallLength(wall);
  if (length === 0) return { x: 1, y: 0 };
  return {
    x: (wall.b.x - wall.a.x) / length,
    y: (wall.b.y - wall.a.y) / length,
  };
}

/** Left-hand normal of a wall (screen space: rotate direction -90°). */
export function wallNormal(wall) {
  const dir = wallDirection(wall);
  return { x: dir.y, y: -dir.x };
}

/** Distance from point p to the segment a→b, in inches. */
export function distancePointToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ray-casting point-in-polygon test (even-odd rule). Points exactly on the
 * boundary may report either way — pair with an edge-distance check for
 * hit testing. */
export function pointInPolygon(p, polygon) {
  if (!isValidPoint(p) || !Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (!isValidPoint(a) || !isValidPoint(b)) continue;
    if ((a.y > p.y) !== (b.y > p.y)) {
      const xIntersect = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < xIntersect) inside = !inside;
    }
  }
  return inside;
}

/** Closest point on the segment a→b to p, plus the 0..1 parameter t. */
export function nearestPointOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return { point: { x: a.x, y: a.y }, t: 0 };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return { point: { x: a.x + t * dx, y: a.y + t * dy }, t };
}

/**
 * Snap a raw pointer point: first to nearby existing endpoints (within
 * snapRadiusIn), otherwise to the grid. Returns the snapped point and what
 * it snapped to, so the UI can show a marker.
 *
 * snapToGrid=false disables grid rounding only — endpoint (object) snapping
 * still applies, matching Visio where the two snaps are independent.
 */
export function snapPoint(
  point,
  {
    gridIn = DEFAULT_GRID_IN,
    snapTargets = [],
    snapRadiusIn = DEFAULT_SNAP_RADIUS_IN,
    snapToGrid = true,
  } = {},
) {
  if (!isValidPoint(point)) return { point: { x: 0, y: 0 }, snappedTo: "none" };
  let best = null;
  let bestDistance = snapRadiusIn;
  for (const target of snapTargets) {
    if (!isValidPoint(target)) continue;
    const distance = Math.hypot(point.x - target.x, point.y - target.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = target;
    }
  }
  if (best) {
    return { point: { x: best.x, y: best.y }, snappedTo: "endpoint" };
  }
  if (!snapToGrid) {
    return { point: { x: point.x, y: point.y }, snappedTo: "none" };
  }
  return {
    point: {
      x: Math.round(point.x / gridIn) * gridIn,
      y: Math.round(point.y / gridIn) * gridIn,
    },
    snappedTo: "grid",
  };
}

/** Round a scalar (e.g. a door offset along a wall) to the grid. */
export function snapScalar(value, gridIn = DEFAULT_GRID_IN) {
  if (!isFiniteNumber(value) || !(gridIn > 0)) return value;
  return Math.round(value / gridIn) * gridIn;
}

/**
 * Compute a PlanCanvas view ({ scale, ox, oy }) that fits a plan-inches rect
 * ({ x, y, widthIn, heightIn }, top-left origin) inside a pixel viewport
 * ({ w, h }), centered with a padding margin. Pure — backs "zoom to sheet".
 * Scale is clamped to [minScale, maxScale].
 */
export function zoomToFitRect(
  rect,
  viewport,
  { paddingPx = 48, minScale = 0.35, maxScale = 12 } = {},
) {
  if (
    !rect ||
    !isFiniteNumber(rect.x) ||
    !isFiniteNumber(rect.y) ||
    !(rect.widthIn > 0) ||
    !(rect.heightIn > 0)
  ) {
    throw new Error("zoomToFitRect needs a rect with positive dimensions.");
  }
  if (!viewport || !(viewport.w > 0) || !(viewport.h > 0)) {
    throw new Error("zoomToFitRect needs a viewport with positive size.");
  }
  if (!(minScale > 0) || !(maxScale >= minScale)) {
    throw new Error("zoomToFitRect needs 0 < minScale <= maxScale.");
  }
  const pad = Math.max(0, paddingPx || 0);
  const availW = Math.max(1, viewport.w - pad * 2);
  const availH = Math.max(1, viewport.h - pad * 2);
  let scale = Math.min(availW / rect.widthIn, availH / rect.heightIn);
  if (!Number.isFinite(scale) || scale <= 0) scale = minScale;
  scale = Math.min(maxScale, Math.max(minScale, scale));
  return {
    scale,
    ox: (viewport.w - rect.widthIn * scale) / 2 - rect.x * scale,
    oy: (viewport.h - rect.heightIn * scale) / 2 - rect.y * scale,
  };
}

/** Short label for a grid spacing: 6 -> `6″`, 12 -> `1′`. */
export function gridSpacingLabel(inches) {
  if (!isFiniteNumber(inches) || !(inches > 0)) return "—";
  if (inches >= 12 && inches % 12 === 0) return `${inches / 12}′`;
  return `${inches}″`;
}

/** Tick length for architectural dimension lines, in inches. */
export const DIMENSION_TICK_IN = 6;

/**
 * Architectural dimension-line geometry for a wall: a line parallel to the
 * wall at `offsetIn`, 45° slash ticks at each end (architectural style),
 * plus a label position and rotation. All coordinates in plan inches.
 * Returns null for degenerate walls.
 */
export function dimensionGeometry(wall, offsetIn) {
  const length = wallLength(wall);
  if (length === 0 || !isFiniteNumber(offsetIn)) return null;
  const dir = wallDirection(wall);
  const normal = wallNormal(wall);
  const lineA = { x: wall.a.x + normal.x * offsetIn, y: wall.a.y + normal.y * offsetIn };
  const lineB = { x: wall.b.x + normal.x * offsetIn, y: wall.b.y + normal.y * offsetIn };
  // 45° slash tick: rotate the wall direction -45° (screen space).
  const tickAngle = -Math.PI / 4;
  const cos = Math.cos(tickAngle);
  const sin = Math.sin(tickAngle);
  const tickDir = { x: dir.x * cos - dir.y * sin, y: dir.x * sin + dir.y * cos };
  const half = DIMENSION_TICK_IN / 2;
  const tickAt = (p) => ({
    a: { x: p.x - tickDir.x * half, y: p.y - tickDir.y * half },
    b: { x: p.x + tickDir.x * half, y: p.y + tickDir.y * half },
  });
  const mid = { x: (lineA.x + lineB.x) / 2, y: (lineA.y + lineB.y) / 2 };
  // Label sits just past the dimension line, away from the wall.
  const labelPos = { x: mid.x + normal.x * 4, y: mid.y + normal.y * 4 };
  const angle = wallAngleDeg(wall);
  const labelAngle = angle > 90 ? angle - 180 : angle < -90 ? angle + 180 : angle;
  return { lineA, lineB, tickA: tickAt(lineA), tickB: tickAt(lineB), labelPos, labelAngle, length };
}

/** Horizontal align modes for furniture arrangement (Visio-style). */
export const ALIGN_MODES = Object.freeze(["left", "center", "right"]);

/**
 * Horizontal extent of one furniture piece's rotated footprint along x.
 * Pieces carry their center (x, y) plus widthIn/depthIn/rotationDeg (the
 * shape stored by PLACE_FURNITURE); pieces without dimensions fall back to
 * a point footprint at their center. Pure.
 */
export function footprintXBounds(piece) {
  if (isFiniteNumber(piece?.widthIn) && isFiniteNumber(piece?.depthIn)) {
    const corners = rotatedFootprintCorners({
      x: piece.x,
      y: piece.y,
      widthIn: piece.widthIn,
      depthIn: piece.depthIn,
      rotationDeg: piece.rotationDeg ?? 0,
    });
    const xs = corners.map((c) => c.x);
    return { left: Math.min(...xs), right: Math.max(...xs) };
  }
  return { left: piece.x, right: piece.x };
}

/**
 * Align furniture pieces horizontally (Visio-style). `pieces` is
 * [{id, x, y, widthIn, depthIn, rotationDeg?}]; returns new positions with
 * y untouched. "left"/"right" match the rotated footprint EDGES of the
 * group (a 90°-rotated 84×36 sofa contributes a 36-inch-wide footprint),
 * while "center" matches footprint centers. Pure.
 */
export function alignFurniture(pieces, mode) {
  const list = (pieces || []).map((p) => ({ ...p }));
  if (list.length < 2) return list;
  if (!ALIGN_MODES.includes(mode)) throw new Error(`Unknown align mode: ${mode}`);
  const bounds = list.map(footprintXBounds);
  const leftEdge = Math.min(...bounds.map((b) => b.left));
  const rightEdge = Math.max(...bounds.map((b) => b.right));
  return list.map((p, i) => {
    if (mode === "center") {
      const center = (bounds[i].left + bounds[i].right) / 2;
      return { ...p, x: p.x + ((leftEdge + rightEdge) / 2 - center) };
    }
    const target = mode === "left" ? leftEdge : rightEdge;
    const edge = mode === "left" ? bounds[i].left : bounds[i].right;
    return { ...p, x: p.x + (target - edge) };
  });
}

/**
 * Distribute furniture evenly along x (Visio-style "Distribute
 * Horizontally"): the leftmost and rightmost pieces stay fixed and the
 * FREE GAPS between rotated footprints become equal, so mixed-size pieces
 * (desk, armchair, 84-inch sofa) cannot overlap each other. Dimension-less
 * pieces degenerate to point footprints, matching the old center-based
 * behavior for them. Needs 3+ pieces; fewer returns copies unchanged. Pure.
 */
export function distributeFurniture(pieces) {
  const list = (pieces || []).map((p) => ({ ...p }));
  if (list.length < 3) return list;
  const sorted = [...list].sort((a, b) => a.x - b.x);
  const bounds = sorted.map(footprintXBounds);
  const widths = bounds.map((b) => b.right - b.left);
  // Free space between the fixed outermost footprints, shared equally.
  const spanStart = bounds[0].right; // right edge of the fixed leftmost piece
  const spanEnd = bounds[bounds.length - 1].left; // left edge of the fixed rightmost piece
  const middleWidth = widths.slice(1, -1).reduce((sum, w) => sum + w, 0);
  const gap = (spanEnd - spanStart - middleWidth) / (sorted.length - 1);
  const byId = new Map();
  let cursor = bounds[0].right; // right edge of the fixed leftmost piece
  sorted.forEach((p, i) => {
    if (i === 0 || i === sorted.length - 1) {
      byId.set(p.id, { ...p }); // outermost pieces stay put
      return;
    }
    const newCenter = cursor + gap + widths[i] / 2;
    byId.set(p.id, { ...p, x: newCenter });
    cursor = newCenter + widths[i] / 2;
  });
  return list.map((p) => byId.get(p.id));
}

// ---- Background underlay (Visio trace-over workflow) ----

/** Default on-screen width of a freshly imported underlay, in plan inches. */
export const DEFAULT_UNDERLAY_WIDTH_IN = 600;

/** Default underlay opacity (0..1). */
export const DEFAULT_UNDERLAY_OPACITY = 0.5;

/**
 * New pixels-per-inch for an underlay after scale calibration: the user
 * clicked two points on the image that are `realDistanceIn` inches apart
 * in the real world. Pure.
 */
export function calibrateUnderlayScale(underlay, clickA, clickB, realDistanceIn) {
  if (!underlay || !(underlay.pxPerIn > 0)) throw new Error("Underlay has no scale to calibrate.");
  if (!isValidPoint(clickA) || !isValidPoint(clickB)) throw new Error("Calibration points must be valid.");
  if (!(realDistanceIn > 0)) throw new Error("Real-world distance must be positive.");
  const planDist = Math.hypot(clickB.x - clickA.x, clickB.y - clickA.y);
  if (!(planDist > 0)) throw new Error("Calibration points must be distinct.");
  const pixelDist = planDist * underlay.pxPerIn;
  return pixelDist / realDistanceIn;
}

/**
 * Plan-space bounding box of an underlay image, or null when invalid.
 * The image top-left sits at (underlay.x, underlay.y) plan inches.
 */
export function underlayBounds(underlay) {
  if (
    !underlay ||
    !isFiniteNumber(underlay.x) ||
    !isFiniteNumber(underlay.y) ||
    !(underlay.widthPx > 0) ||
    !(underlay.heightPx > 0) ||
    !(underlay.pxPerIn > 0)
  ) {
    return null;
  }
  return {
    minX: underlay.x,
    minY: underlay.y,
    maxX: underlay.x + underlay.widthPx / underlay.pxPerIn,
    maxY: underlay.y + underlay.heightPx / underlay.pxPerIn,
  };
}

/** True when a plan point falls inside the underlay image bounds. */
export function underlayContainsPoint(underlay, point) {
  const box = underlayBounds(underlay);
  if (!box || !isValidPoint(point)) return false;
  return point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY;
}

/**
 * Parse a dimension typed by the user: `12'6"`, `12' 6"`, `12.5'`,
 * `12.5 ft`, `150"`, `150 in`, or plain `150` (inches).
 * Returns inches, or NaN when unparseable.
 */
export function parseDimensionInput(input) {
  if (typeof input !== "string") return NaN;
  const s = input.trim().toLowerCase();
  if (s === "") return NaN;
  const m = s.match(/^(?:(\d+(?:\.\d+)?)\s*(?:'|ft|feet))?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?)?\s*$/);
  if (!m || (m[1] === undefined && m[2] === undefined)) return NaN;
  const feet = m[1] !== undefined ? parseFloat(m[1]) : 0;
  const inches = m[2] !== undefined ? parseFloat(m[2]) : 0;
  return feet * 12 + inches;
}

/**
 * Offset along a wall, in inches from wall.a, of the point on the wall
 * nearest to p. Clamped to [0, wallLength]. Used to position doors/windows.
 */
export function offsetAlongWall(p, wall) {
  const length = wallLength(wall);
  if (length === 0) return 0;
  const { t } = nearestPointOnSegment(p, wall.a, wall.b);
  return t * length;
}

/** True when segments p1→p2 and p3→p4 intersect at an interior point. */
export function segmentsIntersect(p1, p2, p3, p4) {
  const denom =
    (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (denom === 0) return false; // parallel or collinear
  const t =
    ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / denom;
  const u =
    ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / denom;
  const eps = 1e-9;
  return t > eps && t < 1 - eps && u > eps && u < 1 - eps;
}

/**
 * Intersection point of two segments, or null when they do not cross at an
 * interior point of both.
 */
export function segmentIntersectionPoint(p1, p2, p3, p4) {
  const denom =
    (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (denom === 0) return null;
  const t =
    ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / denom;
  const u =
    ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / denom;
  const eps = 1e-9;
  if (t < eps || t > 1 - eps || u < eps || u > 1 - eps) return null;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

/** Signed area via shoelace; absolute value is the polygon area in sq inches. */
export function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    if (!isValidPoint(p) || !isValidPoint(q)) return 0;
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

/** Area of a room polygon in square feet. */
export function roomAreaSqFt(room) {
  if (!room || !Array.isArray(room.polygon)) return 0;
  return polygonArea(room.polygon) / 144;
}

/** Format inches as a dimension label, e.g. 150 -> `12' 6"`. */
export function feetInchesLabel(inches) {
  if (!isFiniteNumber(inches)) return "—";
  const rounded = Math.round(inches);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const feet = Math.floor(abs / 12);
  const rest = abs % 12;
  return `${sign}${feet}' ${rest}"`;
}

/** Bounding box of a set of points, or null when empty. */
export function boundingBox(points) {
  const valid = (points || []).filter(isValidPoint);
  if (valid.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of valid) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Rotate a point around an origin by degrees clockwise (screen space). */
export function rotatePoint(point, origin, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}

/** Axis-aligned corners of a furniture footprint after rotation. */
export function rotatedFootprintCorners({ x, y, widthIn, depthIn, rotationDeg = 0 }) {
  const hw = widthIn / 2;
  const hd = depthIn / 2;
  const origin = { x, y };
  return [
    rotatePoint({ x: x - hw, y: y - hd }, origin, rotationDeg),
    rotatePoint({ x: x + hw, y: y - hd }, origin, rotationDeg),
    rotatePoint({ x: x + hw, y: y + hd }, origin, rotationDeg),
    rotatePoint({ x: x - hw, y: y + hd }, origin, rotationDeg),
  ];
}

/**
 * Placement-ghost geometry: where the mouse-following preview shows before
 * the user commits a placement. Pure functions — the ghost lives in
 * component-local preview state and never touches the design document, so
 * cursor tracking can never write to the design or the undo stack.
 */

/**
 * Corners of a room-template footprint dropped at `at` (the top-left
 * corner in inches, exactly like addRoomFromTemplate). Throws on an
 * invalid template or origin so the ghost can only preview a room that
 * could actually be placed.
 */
export function ghostRoomPolygon(template, at) {
  const { widthIn, depthIn } = template || {};
  if (
    !isFiniteNumber(widthIn) ||
    widthIn <= 0 ||
    !isFiniteNumber(depthIn) ||
    depthIn <= 0
  ) {
    throw new Error("Ghost room needs a template with positive widthIn/depthIn.");
  }
  if (!isValidPoint(at)) {
    throw new Error("Ghost room origin must be a valid point.");
  }
  return [
    { x: at.x, y: at.y },
    { x: at.x + widthIn, y: at.y },
    { x: at.x + widthIn, y: at.y + depthIn },
    { x: at.x, y: at.y + depthIn },
  ];
}

/**
 * Wall and gap endpoints for an opening (door/window) ghost: finds the
 * nearest wall within tolIn of the cursor and lays the opening out at the
 * offset — snapped to the grid when snapOffset is true, mirroring the
 * ADD_OPENING commit path. Returns null when no wall is near the cursor.
 * The width is the type's placement default; the ghost shows the span the
 * click would cut.
 */
export function ghostOpeningSpan(
  walls,
  plan,
  { widthIn, gridIn = DEFAULT_GRID_IN, snapOffset = true, tolIn = 16 } = {},
) {
  if (!isFiniteNumber(widthIn) || widthIn <= 0) {
    throw new Error("Ghost opening needs a positive widthIn.");
  }
  if (!isValidPoint(plan)) return null;
  let best = null;
  let bestD = tolIn;
  for (const wall of walls || []) {
    const d = distancePointToSegment(plan, wall.a, wall.b);
    if (d < bestD) {
      bestD = d;
      best = wall;
    }
  }
  if (!best) return null;
  const length = wallLength(best);
  if (length === 0) return null;
  const rawOffset = offsetAlongWall(plan, best);
  const offsetIn = snapOffset ? snapScalar(rawOffset, gridIn) : rawOffset;
  const dir = wallDirection(best);
  return {
    wallId: best.id,
    offsetIn,
    widthIn,
    g1: { x: best.a.x + dir.x * offsetIn, y: best.a.y + dir.y * offsetIn },
    g2: {
      x: best.a.x + dir.x * (offsetIn + widthIn),
      y: best.a.y + dir.y * (offsetIn + widthIn),
    },
  };
}
