// Parametric vector geometry for TEMA shell-and-tube exchangers.
//
// Original FORGE geometry: each of the 20 TEMA component types (see
// temaTypes.js) is built from simple primitives in a side-elevation
// cutaway, laid out along the symbol's WIDTH (front head at -x, rear head
// at +x) with the diameter across its DEPTH. Nothing here is traced from a
// standards plate; the shapes follow the mechanically distinguishing
// features of each type (covers, flanges, tubesheets, floating heads,
// U-bends, partitions, baffles, weirs, nozzles).
//
// Everything is derived from the instance's width and depth, so resizing
// keeps the relative geometry (heads scale with the diameter, the shell
// takes the remaining length) and a uniform resize scales every point.
//
// Primitives (local plan inches, y grows downward, origin at the symbol
// center):
//   { kind: "rect",   x, y, w, h, role }
//   { kind: "line",   x1, y1, x2, y2, role }
//   { kind: "poly",   points: [[x, y], ...], closed, role }
//   { kind: "circle", cx, cy, r, role }
//   { kind: "text",   x, y, text, size, role }
// Roles tell the renderer how to paint: body, flange, tubesheet, internal,
// hidden (dashed), weld, packing, nozzle, flow, weir, ubend, bolt, label.
//
// Connection anchors { id, x, y, dir } sit at nozzle flange faces on the
// footprint edge. They come from the same layout in both drawing modes, so
// switching detailed <-> P&ID never moves a connection.
//
// Pure and framework-free.

import { normalizeTemaConfig, temaDesignation, TEMA_PRESETS } from "./temaTypes";

// ---- primitives ----
const rect = (x, y, w, h, role) => ({ kind: "rect", x, y, w, h, role });
const line = (x1, y1, x2, y2, role) => ({ kind: "line", x1, y1, x2, y2, role });
const poly = (points, role, closed = false) => ({ kind: "poly", points, closed, role });
const circle = (cx, cy, r, role) => ({ kind: "circle", cx, cy, r, role });
const text = (x, y, value, size, role = "label") => ({ kind: "text", x, y, text: value, size, role });
/** Rect between two x positions and symmetric about cy with half-height hh. */
const band = (xa, xb, cy, hh, role) => rect(Math.min(xa, xb), cy - hh, Math.abs(xb - xa), hh * 2, role);

/** Half-ellipse dished head: from (xBase, cy - r) bulging `depth` toward `dir` (+1 right, -1 left). */
function dish(xBase, cy, r, depth, dir, role = "body", n = 12) {
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const a = -Math.PI / 2 + (Math.PI * i) / n;
    pts.push([xBase + dir * depth * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return poly(pts, role);
}

/** Small flow arrow pointing `dir` ("right" | "left" | "up" | "down"). */
function arrow(x, y, dir, size) {
  const s = size;
  const pts = {
    right: [[x - s, y - s * 0.6], [x + s, y], [x - s, y + s * 0.6]],
    left: [[x + s, y - s * 0.6], [x - s, y], [x + s, y + s * 0.6]],
    down: [[x - s * 0.6, y - s], [x, y + s], [x + s * 0.6, y - s]],
    up: [[x - s * 0.6, y + s], [x, y - s], [x + s * 0.6, y + s]],
  }[dir];
  return poly(pts, "flow", true);
}

/** Weld symbol: small filled triangle at a joint corner. */
function weld(x, y, size, pointsDown) {
  const d = pointsDown ? size : -size;
  return poly([[x - size, y], [x + size, y], [x, y + d]], "weld", true);
}

/**
 * Radial nozzle from the vessel surface out to the footprint edge.
 * dir "up" ends at y = -H, "down" at y = +H. Returns { prims, anchor }.
 */
function nozzle(id, x, ySurface, dir, H, width) {
  const tip = dir === "up" ? -H : H;
  const flangeT = Math.min(width * 0.3, Math.abs(tip - ySurface) * 0.3);
  const y0 = Math.min(ySurface, tip);
  const neckH = Math.abs(tip - ySurface);
  const flangeY = dir === "up" ? tip : tip - flangeT;
  return {
    prims: [
      rect(x - width / 2, y0, width, neckH, "nozzle"),
      rect(x - width * 0.8, flangeY, width * 1.6, flangeT, "flange"),
    ],
    anchor: { id, x, y: tip, dir },
  };
}

function withNozzle(out, n) {
  out.prims.push(...n.prims);
  out.anchors.push(n.anchor);
}

function mirrorPrims(prims, axis2) {
  // Mirror about x = axis2 / 2 (axis2 = x0 + x1 of the slot).
  return prims.map((p) => {
    if (p.kind === "rect") return { ...p, x: axis2 - (p.x + p.w) };
    if (p.kind === "line") return { ...p, x1: axis2 - p.x1, x2: axis2 - p.x2 };
    if (p.kind === "poly") return { ...p, points: p.points.map(([x, y]) => [axis2 - x, y]) };
    if (p.kind === "circle" || p.kind === "text") return p.kind === "circle" ? { ...p, cx: axis2 - p.cx } : { ...p, x: axis2 - p.x };
    return p;
  });
}

/** Through-bolts across a gasketed flange joint (channel flange + tubesheet). */
function boltedJoint(xa, xb, cy, r, fr) {
  const yb = (r + fr) / 2;
  return [line(xa, cy - yb, xb, cy - yb, "bolt"), line(xa, cy + yb, xb, cy + yb, "bolt")];
}

// ---- head lengths, in units of the channel/bundle radius r ----
const FRONT_LEN = { A: 1.4, B: 1.1, C: 1.3, N: 1.3, D: 1.6 };
const REAR_LEN = { L: 1.4, M: 1.1, N: 1.3, P: 1.5, S: 1.5, T: 1.6, U: 1.2, W: 1.5 };

/**
 * Proportions shared by every builder. H = half the footprint depth (the
 * nozzle flange faces), r = channel/bundle radius, R = shell radius (the
 * kettle radius for K), cy = bundle centerline.
 */
function proportions(depthIn, kettle) {
  const H = depthIn / 2;
  if (kettle) {
    const R = H * 0.8;
    const r = R * 0.55;
    return { H, R, r, cy: R - r * 1.15 };
  }
  const R = H * 0.7;
  return { H, R, r: R, cy: 0 };
}

// ---- front heads: slot [x0, x1], stationary tubesheet at x1 ----
// opts: { nozzles, partition, passes }
function frontParts(letter, x0, x1, g, opts) {
  const { r, cy, H } = g;
  const ts = 0.12 * r; // tubesheet thickness
  const fw = 0.15 * r; // flange thickness
  const fr = 1.15 * r; // flange radius
  const prims = [];
  let barrel; // [xa, xb] of the channel barrel: nozzles go at its middle
  let surface = r; // barrel outer radius for nozzles
  let partitionFrom;

  switch (letter) {
    case "A": // channel + bolted flat cover; tubesheet sandwiched by flanges
      prims.push(band(x0, x0 + ts, cy, fr, "flange")); // removable cover
      prims.push(band(x0 + ts, x0 + ts + fw, cy, fr, "flange")); // cover flange
      barrel = [x0 + ts + fw, x1 - ts - fw];
      prims.push(band(barrel[0], barrel[1], cy, r, "body"));
      prims.push(band(x1 - ts - fw, x1 - ts, cy, fr, "flange")); // channel flange
      prims.push(band(x1 - ts, x1, cy, fr, "tubesheet"));
      prims.push(...boltedJoint(x1 - ts - fw, x1, cy, r, fr));
      partitionFrom = barrel[0];
      break;
    case "B": { // bonnet: dished head integral with the channel
      const dd = Math.min(0.5 * r, (x1 - x0) * 0.4);
      prims.push(dish(x0 + dd, cy, r, dd, -1));
      barrel = [x0 + dd, x1 - ts - fw];
      prims.push(band(barrel[0], barrel[1], cy, r, "body"));
      prims.push(band(x1 - ts - fw, x1 - ts, cy, fr, "flange"));
      prims.push(band(x1 - ts, x1, cy, fr, "tubesheet"));
      prims.push(...boltedJoint(x1 - ts - fw, x1, cy, r, fr));
      partitionFrom = x0 + dd * 0.5;
      break;
    }
    case "C": // channel welded to tubesheet; tubesheet extends to bolt to shell flange
      prims.push(band(x0, x0 + ts, cy, fr, "flange"));
      prims.push(band(x0 + ts, x0 + ts + fw, cy, fr, "flange"));
      barrel = [x0 + ts + fw, x1 - ts];
      prims.push(band(barrel[0], barrel[1], cy, r, "body"));
      prims.push(band(x1 - ts, x1, cy, fr, "tubesheet")); // extended tubesheet
      prims.push(weld(x1 - ts - r * 0.06, cy - r, r * 0.06, false));
      prims.push(weld(x1 - ts - r * 0.06, cy + r, r * 0.06, true));
      prims.push(line(x1 - ts / 2, cy - fr, x1 - ts / 2, cy - r * 1.02, "bolt"));
      prims.push(line(x1 - ts / 2, cy + fr, x1 - ts / 2, cy + r * 1.02, "bolt"));
      partitionFrom = barrel[0];
      break;
    case "N": { // channel AND shell welded to a flush tubesheet
      const wz = 0.12 * r; // room for the shell-side weld inside the slot
      prims.push(band(x0, x0 + ts, cy, fr, "flange"));
      prims.push(band(x0 + ts, x0 + ts + fw, cy, fr, "flange"));
      barrel = [x0 + ts + fw, x1 - ts - wz];
      prims.push(band(barrel[0], barrel[1], cy, r, "body"));
      prims.push(band(x1 - ts - wz, x1 - wz, cy, r, "tubesheet")); // flush, not extended
      prims.push(weld(x1 - ts - wz - r * 0.06, cy - r, r * 0.06, false));
      prims.push(weld(x1 - ts - wz - r * 0.06, cy + r, r * 0.06, true));
      prims.push(weld(x1 - r * 0.06, cy - r, r * 0.06, false));
      prims.push(weld(x1 - r * 0.06, cy + r, r * 0.06, true));
      prims.push(line(x1 - wz, cy - r, x1, cy - r, "body")); // shell stub welded on
      prims.push(line(x1 - wz, cy + r, x1, cy + r, "body"));
      partitionFrom = barrel[0];
      break;
    }
    case "D": { // forged high-pressure barrel, internal cover held by a shear ring
      const wall = 1.25 * r;
      const bore = 0.8 * r;
      prims.push(band(x0, x0 + 0.2 * r, cy, 1.05 * r, "flange")); // outer retainer
      barrel = [x0 + 0.2 * r, x1 - ts];
      prims.push(band(barrel[0], barrel[1], cy, wall, "body"));
      prims.push(line(barrel[0], cy - bore, barrel[1], cy - bore, "internal")); // bore
      prims.push(line(barrel[0], cy + bore, barrel[1], cy + bore, "internal"));
      prims.push(rect(x0 + 0.2 * r, cy - 0.97 * r, 0.12 * r, 0.22 * r, "packing")); // shear ring
      prims.push(rect(x0 + 0.2 * r, cy + 0.75 * r, 0.12 * r, 0.22 * r, "packing"));
      prims.push(band(x0 + 0.32 * r, x0 + 0.6 * r, cy, bore, "flange")); // internal cover
      prims.push(line(x0 + 0.9 * r, cy - bore, x0 + 0.9 * r, cy + bore, "internal")); // diaphragm
      prims.push(band(x1 - ts, x1, cy, wall, "tubesheet")); // integral forged tubesheet
      partitionFrom = x0 + 0.9 * r;
      surface = wall;
      break;
    }
    default:
      throw new Error(`Unknown TEMA front head: ${letter}`);
  }

  if (opts.partition) {
    prims.push(line(partitionFrom, cy, x1 - ts, cy, "internal")); // pass partition
    if (opts.passes >= 4) {
      prims.push(line(partitionFrom, cy - r * 0.5, x1 - ts, cy - r * 0.5, "hidden"));
      prims.push(line(partitionFrom, cy + r * 0.5, x1 - ts, cy + r * 0.5, "hidden"));
    }
  }
  const xn = (barrel[0] + barrel[1]) / 2;
  return { prims, xn, surface, H };
}

function buildFront(letter, x0, x1, g, opts) {
  const passes = opts.passes;
  const parts = frontParts(letter, x0, x1, g, { partition: opts.partition ?? passes >= 2, passes });
  const out = { prims: parts.prims, anchors: [] };
  if (opts.nozzles !== false) {
    const w = 0.35 * g.r;
    withNozzle(out, nozzle("tube-in", parts.xn, g.cy - parts.surface, "up", g.H, w));
    if (passes >= 2) withNozzle(out, nozzle("tube-out", parts.xn, g.cy + parts.surface, "down", g.H, w));
  }
  return out;
}

// ---- rear heads: slot [x0, x1], the shell side at x0 ----
// g.inKettle: only the bundle-end internals (the kettle shell encloses them).
function buildRear(letter, x0, x1, g, opts) {
  const { r, cy, H } = g;
  const passes = opts.passes;
  const out = { prims: [], anchors: [] };
  const ts = 0.12 * r;
  const fw = 0.15 * r;
  const fr = 1.15 * r;
  const tubeOut = (x, surface) => {
    if (passes === 1) withNozzle(out, nozzle("tube-out", x, cy + surface, "down", H, 0.35 * r));
  };
  const tubes = (xa, xb, rows = [0.5, 0.25]) => {
    for (const f of rows) {
      out.prims.push(line(xa, cy - r * f, xb, cy - r * f, "hidden"));
      out.prims.push(line(xa, cy + r * f, xb, cy + r * f, "hidden"));
    }
  };

  if (letter === "L" || letter === "M" || letter === "N") {
    // Owner decision: L is drawn like front A, M like B, N like N — mirrored.
    const front = { L: "A", M: "B", N: "N" }[letter];
    const parts = frontParts(front, x0, x1, g, { partition: passes >= 4, passes });
    out.prims.push(...mirrorPrims(parts.prims, x0 + x1));
    tubeOut(x0 + x1 - parts.xn, parts.surface);
    return out;
  }

  const len = x1 - x0;
  switch (letter) {
    case "P": { // outside packed floating head
      out.prims.push(band(x0, x0 + 0.2 * r, cy, 1.25 * r, "flange")); // packing box
      out.prims.push(rect(x0 + 0.05 * r, cy - 1.0 * r, 0.15 * r, 0.12 * r, "packing"));
      out.prims.push(rect(x0 + 0.05 * r, cy + 0.88 * r, 0.15 * r, 0.12 * r, "packing"));
      out.prims.push(band(x0 + 0.2 * r, x0 + 0.35 * r, cy, 1.15 * r, "flange")); // gland
      out.prims.push(band(x0 + 0.35 * r, x0 + 0.6 * r, cy, 0.88 * r, "body")); // tubesheet skirt
      out.prims.push(band(x0 + 0.6 * r, x0 + 0.72 * r, cy, 0.95 * r, "tubesheet"));
      out.prims.push(band(x0 + 0.72 * r, x0 + 0.85 * r, cy, 0.95 * r, "flange"));
      const dd = Math.min(0.45 * r, x1 - (x0 + 0.85 * r));
      out.prims.push(band(x0 + 0.85 * r, x1 - dd, cy, 0.88 * r, "body")); // floating head cover
      out.prims.push(dish(x1 - dd, cy, 0.88 * r, dd, 1));
      tubes(x0, x0 + 0.6 * r);
      if (passes >= 4) out.prims.push(line(x0 + 0.85 * r, cy, x1 - dd, cy, "internal"));
      tubeOut((x0 + 0.85 * r + x1 - dd) / 2, 0.88 * r);
      return out;
    }
    case "S": // floating head with split backing ring, inside a shell cover
    case "T": { // pull-through: floating cover bolted straight to the tubesheet
      const pull = letter === "T";
      const coverR = pull ? 1.12 * r : 1.05 * r;
      const fts = x0 + 0.45 * r; // floating tubesheet face
      if (!g.inKettle) {
        out.prims.push(band(x0, x0 + fw, cy, fr * (pull ? 1.05 : 1), "flange")); // shell flange
        out.prims.push(band(x0 + fw, x0 + 2 * fw, cy, fr * (pull ? 1.05 : 1), "flange")); // cover flange
        const dd = Math.min(0.5 * r, len * 0.3);
        out.prims.push(band(x0 + 2 * fw, x1 - dd, cy, coverR, "body"));
        out.prims.push(dish(x1 - dd, cy, coverR, dd, 1));
      }
      if (pull) {
        out.prims.push(band(fts, fts + 0.15 * r, cy, 0.95 * r, "tubesheet"));
        out.prims.push(band(fts + 0.15 * r, fts + 0.27 * r, cy, 0.95 * r, "flange"));
        out.prims.push(line(fts, cy - 0.88 * r, fts + 0.27 * r, cy - 0.88 * r, "bolt"));
        out.prims.push(line(fts, cy + 0.88 * r, fts + 0.27 * r, cy + 0.88 * r, "bolt"));
        out.prims.push(dish(fts + 0.27 * r, cy, 0.8 * r, 0.35 * r, 1, "internal"));
        tubes(x0, fts, [0.4, 0.2]); // smaller bundle: pull-through clearance
      } else {
        out.prims.push(band(fts, fts + 0.12 * r, cy, 0.8 * r, "tubesheet"));
        out.prims.push(rect(fts + 0.12 * r, cy - 0.95 * r, 0.15 * r, 0.23 * r, "flange")); // split backing ring
        out.prims.push(rect(fts + 0.12 * r, cy + 0.72 * r, 0.15 * r, 0.23 * r, "flange"));
        out.prims.push(band(fts + 0.27 * r, fts + 0.39 * r, cy, 0.95 * r, "flange")); // floating cover flange
        out.prims.push(dish(fts + 0.39 * r, cy, 0.8 * r, 0.35 * r, 1, "internal"));
        tubes(x0, fts);
      }
      if (g.inKettle) tubeOut(fts + 0.2 * r, 0.8 * r);
      else tubeOut((x0 + 2 * fw + x1 - Math.min(0.5 * r, len * 0.3)) / 2 + 0.3 * r, coverR);
      return out;
    }
    case "U": { // U-tube bundle, dished shell cover
      const bend = x0 + 0.35 * r;
      if (!g.inKettle) {
        const Rs = g.shellR ?? r;
        const dd = Math.min(0.5 * Rs, len * 0.4);
        out.prims.push(band(x0, x1 - dd, g.shellCy ?? cy, Rs, "body"));
        out.prims.push(dish(x1 - dd, g.shellCy ?? cy, Rs, dd, 1));
      }
      tubes(x0, bend);
      out.prims.push(dish(bend, cy, 0.5 * r, 0.5 * r, 1, "ubend"));
      out.prims.push(dish(bend, cy, 0.25 * r, 0.25 * r, 1, "ubend"));
      out.prims.push(line(x0 + 0.1 * r, cy - r * 0.9, x0 + 0.1 * r, cy + r * 0.9, "hidden")); // support plate
      return out;
    }
    case "W": { // externally sealed floating tubesheet, lantern ring between packings
      const a = x0 + fw;
      out.prims.push(band(x0, a, cy, fr, "flange")); // shell flange
      out.prims.push(band(a, a + 0.36 * r, cy, 1.0 * r, "tubesheet")); // floating tubesheet
      out.prims.push(rect(a, cy - 1.12 * r, 0.12 * r, 0.12 * r, "packing")); // shell-side packing
      out.prims.push(rect(a, cy + 1.0 * r, 0.12 * r, 0.12 * r, "packing"));
      out.prims.push(rect(a + 0.12 * r, cy - 1.12 * r, 0.12 * r, 0.12 * r, "flange")); // lantern ring
      out.prims.push(rect(a + 0.12 * r, cy + 1.0 * r, 0.12 * r, 0.12 * r, "flange"));
      out.prims.push(circle(a + 0.18 * r, cy - 1.06 * r, 0.035 * r, "internal")); // leak-off hole
      out.prims.push(rect(a + 0.24 * r, cy - 1.12 * r, 0.12 * r, 0.12 * r, "packing")); // tube-side packing
      out.prims.push(rect(a + 0.24 * r, cy + 1.0 * r, 0.12 * r, 0.12 * r, "packing"));
      const b = a + 0.36 * r;
      out.prims.push(band(b, b + fw, cy, fr, "flange")); // rear channel flange
      out.prims.push(band(b + fw, x1 - ts - fw, cy, r, "body")); // rear channel
      out.prims.push(band(x1 - ts - fw, x1 - ts, cy, fr, "flange"));
      out.prims.push(band(x1 - ts, x1, cy, fr, "flange")); // cover
      if (passes >= 4) out.prims.push(line(b + fw, cy, x1 - ts, cy, "internal"));
      tubes(x0, a);
      tubeOut((b + fw + x1 - ts - fw) / 2, r);
      return out;
    }
    default:
      throw new Error(`Unknown TEMA rear head: ${letter}`);
  }
}

// ---- shells: slot [s0, s1] ----
function segmentalBaffles(prims, from, to, cy, r, target) {
  const n = Math.max(2, Math.min(9, Math.round((to - from) / (0.9 * r)) - 1));
  for (let i = 1; i <= n; i += 1) {
    const x = from + ((to - from) * i) / (n + 1);
    if (target === "top") prims.push(line(x, cy - r, x, cy - 0.3 * r, "internal"));
    else if (target === "bottom") prims.push(line(x, cy + r, x, cy + 0.3 * r, "internal"));
    else if (i % 2) prims.push(line(x, cy - r, x, cy + 0.45 * r, "internal"));
    else prims.push(line(x, cy + r, x, cy - 0.45 * r, "internal"));
  }
}

function kettleOutline(s0, s1, g, withRearDish) {
  const { R, r, cy } = g;
  const Rn = 1.05 * r; // neck at the front tubesheet
  const neck = 0.3 * r;
  const cone = Math.min(0.8 * r, (s1 - s0) * 0.15);
  const dd = withRearDish ? Math.min(0.5 * R, (s1 - s0) * 0.15) : 0;
  const xa = s0 + neck;
  const xb = s0 + neck + cone;
  const xe = s1 - dd;
  const top = [[s0, cy - Rn], [xa, cy - Rn], [xb, -R], [xe, -R]];
  const bottom = [[xe, R], [xb, R], [xa, cy + Rn], [s0, cy + Rn]];
  const prims = [];
  if (withRearDish) {
    const d = dish(xe, 0, R, dd, 1).points;
    prims.push(poly([...top, ...d, ...bottom], "body", true));
  } else {
    prims.push(poly([...top, [s1, -R], [s1, R], ...bottom], "body", true));
  }
  return { prims, barrel: [xb, xe] };
}

function buildShell(letter, s0, s1, g, opts = {}) {
  const { r, cy, H } = g;
  const len = s1 - s0;
  const out = { prims: [], anchors: [] };
  const w = 0.35 * r;
  const top = (id, x, width = w, surface = cy - r) => withNozzle(out, nozzle(id, x, surface, "up", H, width));
  const bottom = (id, x, width = w, surface = cy + r) => withNozzle(out, nozzle(id, x, surface, "down", H, width));
  const tubes = (xa, xb) => {
    for (const f of [0.5, 0.25]) {
      out.prims.push(line(xa, cy - r * f, xb, cy - r * f, "hidden"));
      out.prims.push(line(xa, cy + r * f, xb, cy + r * f, "hidden"));
    }
  };
  const a = 0.18 * r; // arrow size
  const at = (f) => s0 + len * f;

  if (letter === "K") {
    // Kettle: enlarged shell above an eccentric bundle; a weir holds the
    // liquid over the tubes. The rear head's bundle end sits inside it.
    const standalone = opts.standalone;
    const k = kettleOutline(s0, s1, g, true);
    out.prims.push(...k.prims);
    const [xb, xe] = k.barrel;
    const weirX = xe - 0.35 * r;
    const bundleEnd = opts.bundleEnd ?? weirX - 0.3 * r;
    tubes(s0, bundleEnd);
    if (standalone) out.prims.push(line(bundleEnd, cy - r * 0.6, bundleEnd, cy + r * 0.6, "hidden"));
    out.prims.push(line(weirX, g.R, weirX, cy - r * 1.2, "weir"));
    out.prims.push(line(xb, cy - r * 1.2, weirX, cy - r * 1.2, "hidden")); // liquid level
    bottom("shell-in", xb + (weirX - xb) * 0.15, w, g.R); // liquid feed
    top("shell-out", (xb + weirX) / 2, w * 1.4, -g.R); // vapor outlet
    bottom("shell-out-2", (weirX + xe) / 2, w, g.R); // liquid overflow past the weir
    out.prims.push(arrow((xb + weirX) / 2, -g.R * 0.55, "up", a));
    return out;
  }

  out.prims.push(band(s0, s1, cy, r, "body"));
  tubes(s0, s1);
  switch (letter) {
    case "E":
      top("shell-in", at(0.15));
      bottom("shell-out", at(0.85));
      segmentalBaffles(out.prims, at(0.22), at(0.78), cy, r);
      out.prims.push(arrow(at(0.5), cy - 0.75 * r, "right", a));
      break;
    case "F":
      top("shell-in", at(0.15));
      bottom("shell-out", at(0.15));
      out.prims.push(line(s0, cy, at(0.85), cy, "internal")); // longitudinal baffle
      segmentalBaffles(out.prims, at(0.22), at(0.8), cy, r, "top");
      segmentalBaffles(out.prims, at(0.22), at(0.8), cy, r, "bottom");
      out.prims.push(arrow(at(0.5), cy - 0.65 * r, "right", a));
      out.prims.push(arrow(at(0.5), cy + 0.65 * r, "left", a));
      break;
    case "G":
      top("shell-in", at(0.5));
      bottom("shell-out", at(0.5));
      out.prims.push(line(at(0.25), cy, at(0.75), cy, "internal")); // split-flow baffle
      out.prims.push(line(at(0.1), cy - r, at(0.1), cy + r, "hidden")); // support plates
      out.prims.push(line(at(0.9), cy - r, at(0.9), cy + r, "hidden"));
      out.prims.push(arrow(at(0.38), cy - 0.6 * r, "left", a));
      out.prims.push(arrow(at(0.62), cy - 0.6 * r, "right", a));
      break;
    case "H":
      top("shell-in", at(0.25));
      top("shell-in-2", at(0.75));
      bottom("shell-out", at(0.25));
      bottom("shell-out-2", at(0.75));
      out.prims.push(line(at(0.08), cy, at(0.42), cy, "internal"));
      out.prims.push(line(at(0.58), cy, at(0.92), cy, "internal"));
      out.prims.push(line(at(0.5), cy - r, at(0.5), cy + r, "internal")); // central transverse baffle
      out.prims.push(arrow(at(0.15), cy - 0.6 * r, "left", a));
      out.prims.push(arrow(at(0.35), cy - 0.6 * r, "right", a));
      out.prims.push(arrow(at(0.65), cy - 0.6 * r, "left", a));
      out.prims.push(arrow(at(0.85), cy - 0.6 * r, "right", a));
      break;
    case "J":
      top("shell-in", at(0.5));
      bottom("shell-out", at(0.12));
      bottom("shell-out-2", at(0.88));
      segmentalBaffles(out.prims, at(0.18), at(0.42), cy, r);
      segmentalBaffles(out.prims, at(0.58), at(0.82), cy, r);
      out.prims.push(arrow(at(0.3), cy - 0.75 * r, "left", a));
      out.prims.push(arrow(at(0.7), cy - 0.75 * r, "right", a));
      break;
    case "X":
      top("shell-in", at(0.5), 0.6 * r);
      bottom("shell-out", at(0.5), 0.6 * r);
      for (const f of [0.25, 0.5, 0.75]) out.prims.push(line(at(f), cy - r, at(f), cy + r, "hidden")); // support plates
      out.prims.push(arrow(at(0.38), cy, "down", a));
      out.prims.push(arrow(at(0.62), cy, "down", a));
      break;
    default:
      throw new Error(`Unknown TEMA shell: ${letter}`);
  }
  return out;
}

// ---- public builders ----

/**
 * One TEMA component on its own, filling a widthIn x depthIn footprint.
 * position: "front" | "shell" | "rear". opts: { tubePasses = 2, nozzles, partition }.
 */
export function temaComponent(position, letter, widthIn, depthIn, opts = {}) {
  const passes = opts.tubePasses ?? 2;
  const x0 = -widthIn / 2;
  const x1 = widthIn / 2;
  if (position === "front") {
    const g = proportions(depthIn, false);
    return buildFront(letter, x0, x1, g, { passes, nozzles: opts.nozzles, partition: opts.partition });
  }
  if (position === "rear") {
    const g = proportions(depthIn, false);
    return buildRear(letter, x0, x1, g, { passes });
  }
  if (position === "shell") {
    const g = proportions(depthIn, letter === "K");
    return buildShell(letter, x0, x1, g, { standalone: true });
  }
  throw new Error(`Unknown TEMA component position: ${position}`);
}

/**
 * Layout for a complete exchanger: { segments: { front, shell, rear },
 * g } — head lengths scale with the channel radius; the shell takes the rest.
 */
function assemblyLayout(config, widthIn, depthIn) {
  const kettle = config.shell === "K";
  const g = proportions(depthIn, kettle);
  let fl = FRONT_LEN[config.front] * g.r;
  let rl = REAR_LEN[config.rear] * g.r;
  const maxHeads = widthIn * 0.6;
  if (fl + rl > maxHeads) {
    const k = maxHeads / (fl + rl);
    fl *= k;
    rl *= k;
  }
  const x0 = -widthIn / 2;
  const x1 = widthIn / 2;
  return {
    g,
    kettle,
    segments: { front: [x0, x0 + fl], shell: [x0 + fl, x1 - (kettle ? 0 : rl)], rear: [x1 - rl, x1] },
    rl,
  };
}

/**
 * A complete exchanger: { designation, prims, anchors, segments }.
 * For a kettle (K) the shell spans to the rear end and the rear head's
 * bundle-end internals are drawn inside it, ahead of the weir.
 */
export function temaAssembly(configInput, widthIn, depthIn) {
  const config = normalizeTemaConfig(configInput) || { ...TEMA_PRESETS.AES };
  const { g, kettle, segments, rl } = assemblyLayout(config, widthIn, depthIn);
  const passes = config.tubePasses;
  const front = buildFront(config.front, segments.front[0], segments.front[1], g, { passes });
  let shell;
  let rear;
  if (kettle) {
    // Rear internals sit inside the kettle, ending ahead of the weir.
    const { barrel } = kettleOutlineBarrel(segments.shell[0], segments.shell[1], g);
    const weirX = barrel[1] - 0.35 * g.r;
    const internalLen = Math.min(rl * 0.6, (weirX - barrel[0]) * 0.4);
    const rx1 = weirX - 0.15 * g.r;
    const rx0 = rx1 - internalLen;
    shell = buildShell("K", segments.shell[0], segments.shell[1], g, { bundleEnd: rx0 });
    rear = buildRear(config.rear, rx0, rx1, { ...g, inKettle: true }, { passes });
    segments.rear = [rx0, rx1];
  } else {
    shell = buildShell(config.shell, segments.shell[0], segments.shell[1], g);
    rear = buildRear(config.rear, segments.rear[0], segments.rear[1], g, { passes });
  }
  return {
    designation: temaDesignation(config),
    config,
    prims: [...shell.prims, ...front.prims, ...rear.prims],
    anchors: [...front.anchors, ...shell.anchors, ...rear.anchors],
    segments,
    g,
  };
}

function kettleOutlineBarrel(s0, s1, g) {
  return kettleOutline(s0, s1, g, true);
}

/** Tick + stub from the simplified body out to each shared anchor. */
function pidStubs(anchors, edgeY) {
  const prims = [];
  for (const a of anchors) {
    const y0 = edgeY(a);
    prims.push(line(a.x, y0, a.x, a.y, "nozzle"));
  }
  return prims;
}

/**
 * Simplified P&ID drawing of a complete exchanger: shell outline (kettle
 * outline for K), tube-side path, the designation, and nozzle stubs to the
 * SAME anchors as the detailed drawing.
 */
export function temaPidAssembly(configInput, widthIn, depthIn) {
  const detailed = temaAssembly(configInput, widthIn, depthIn);
  const { g, segments, designation, anchors } = detailed;
  const { r, cy } = g;
  const x0 = -widthIn / 2;
  const x1 = widthIn / 2;
  const prims = [];
  const kettle = detailed.config.shell === "K";
  if (kettle) {
    prims.push(...kettleOutline(segments.shell[0], x1, g, true).prims);
    prims.push(band(x0, segments.front[1], cy, r, "body"));
  } else {
    prims.push(rect(x0, cy - r, widthIn, 2 * r, "body"));
  }
  prims.push(line(segments.front[1], cy - r, segments.front[1], cy + r, "internal")); // tubesheet
  if (detailed.config.rear !== "U") {
    prims.push(line(segments.rear[0], cy - r, segments.rear[0], cy + r, "internal"));
  }
  // Tube-side path: a single line for one pass, a hairpin for multi-pass.
  if (detailed.config.tubePasses === 1) {
    prims.push(line(segments.front[1], cy, segments.rear[0], cy, "internal"));
  } else {
    const xr = segments.rear[0] + (segments.rear[1] - segments.rear[0]) * 0.3;
    prims.push(poly([[segments.front[1], cy - r * 0.4], [xr, cy - r * 0.4], [xr, cy + r * 0.4], [segments.front[1], cy + r * 0.4]], "internal"));
  }
  prims.push(text((segments.shell[0] + segments.shell[1]) / 2, kettle ? -g.R * 0.35 : cy, designation, r * 0.7));
  const edgeY = (a) => {
    const upward = a.dir === "up";
    if (kettle && a.x > segments.shell[0] + 0.3 * r) return upward ? -g.R : g.R;
    return upward ? cy - r : cy + r;
  };
  prims.push(...pidStubs(anchors, edgeY));
  return { designation, config: detailed.config, prims, anchors, segments };
}

/** Simplified P&ID drawing of one component: outline, letter, shared anchors. */
export function temaPidComponent(position, letter, widthIn, depthIn, opts = {}) {
  const detailed = temaComponent(position, letter, widthIn, depthIn, opts);
  const kettle = position === "shell" && letter === "K";
  const g = proportions(depthIn, kettle);
  const prims = [];
  if (kettle) prims.push(...kettleOutline(-widthIn / 2, widthIn / 2, g, true).prims);
  else prims.push(rect(-widthIn / 2, g.cy - g.r, widthIn, 2 * g.r, "body"));
  prims.push(text(0, kettle ? -g.R * 0.35 : g.cy, letter, g.r * 0.8));
  prims.push(...pidStubs(detailed.anchors, (a) => {
    const upward = a.dir === "up";
    if (kettle) return upward ? -g.R : g.R;
    return upward ? g.cy - g.r : g.cy + g.r;
  }));
  return { prims, anchors: detailed.anchors };
}

/**
 * Resolve what to draw for a TEMA catalog symbol + placed instance:
 * { mode: "detailed" | "pid", designation, prims, anchors, widthIn, depthIn }.
 * The instance's optional fields (tema, drawingMode, widthIn, depthIn)
 * override the catalog defaults.
 */
export function temaDrawing(symbol, instance = {}) {
  const spec = symbol?.tema;
  if (!spec) return null;
  const widthIn = instance.widthIn ?? symbol.widthIn;
  const depthIn = instance.depthIn ?? symbol.depthIn;
  const mode = instance.drawingMode === "pid" || instance.drawingMode === "detailed"
    ? instance.drawingMode
    : spec.defaultMode || "detailed";
  if (spec.kind === "assembly") {
    const config = normalizeTemaConfig(instance.tema) || spec.defaultConfig;
    const built = mode === "pid" ? temaPidAssembly(config, widthIn, depthIn) : temaAssembly(config, widthIn, depthIn);
    return { mode, designation: built.designation, prims: built.prims, anchors: built.anchors, widthIn, depthIn };
  }
  const opts = { tubePasses: normalizeTemaConfig(instance.tema)?.tubePasses ?? 2 };
  const built = mode === "pid"
    ? temaPidComponent(spec.position, spec.letter, widthIn, depthIn, opts)
    : temaComponent(spec.position, spec.letter, widthIn, depthIn, opts);
  return { mode, designation: spec.letter, prims: built.prims, anchors: built.anchors, widthIn, depthIn };
}

/** Anchors in plan coordinates for a placed TEMA instance (position, rotation, size applied). */
export function temaAnchorsWorld(symbol, instance) {
  const drawing = temaDrawing(symbol, instance);
  if (!drawing) return [];
  const rad = ((instance.rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return drawing.anchors.map((a) => ({
    id: a.id,
    x: instance.x + a.x * cos - a.y * sin,
    y: instance.y + a.x * sin + a.y * cos,
  }));
}
