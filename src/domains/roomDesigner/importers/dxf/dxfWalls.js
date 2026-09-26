/**
 * Wall reconstruction for DXF floor plans (Designer inches, Y-down).
 *
 * CAD floor plans draw a wall as its two FACE lines, broken where a door or
 * window cuts through. The Designer models a wall as a CENTERLINE with
 * openings. This module turns one into the other:
 *
 *  1. Pair faces: parallel segments 2"–18" apart whose spans overlap become
 *     a centerline midway between them (thickness = their separation).
 *     Pairing is greedy by distance and interval-aware, so one long face can
 *     pair with several shorter opposite faces without double-counting.
 *  2. Leftovers: long unpaired wall lines are taken as single-line walls
 *     (drawn as centerlines); short ones (end caps, ticks) are dropped.
 *  3. Rejoin: collinear pieces merge back into one wall when they touch, or
 *     when a door/window cluster sits in the gap — the gap becomes that
 *     opening (its width = the gap).
 *  4. Corners: wall ends near another wall's centerline are snapped to the
 *     intersection (L-corners and T-junctions), since face pairs stop short
 *     of the corner by half a wall thickness.
 *  5. Openings on unbroken walls: a door/window cluster that didn't match a
 *     gap is placed on the nearest wall by projecting its linework onto the
 *     wall (a door's swing arc spans the door width along the wall).
 *
 * Pure; conservative by design — anything that doesn't fit is returned for
 * the caller to keep as annotation, with notes explaining why.
 */

export const WALL_DEFAULTS = Object.freeze({
  minThicknessIn: 2,
  maxThicknessIn: 18,
  angleTolDeg: 2,
  collinearTolIn: 1.5,
  minPairOverlapIn: 3,
  minSingleLineWallIn: 24,
  maxOpeningIn: 144,
});

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const len = (a) => Math.hypot(a.x, a.y);

function seg(a, b) {
  const d = sub(b, a);
  const l = len(d);
  return { a, b, len: l, u: l > 0 ? mul(d, 1 / l) : { x: 1, y: 0 } };
}
const at = (s, t) => add(s.a, mul(s.u, t));

function distToSegment(p, a, b) {
  const d = sub(b, a);
  const l2 = dot(d, d);
  if (l2 <= 0) return len(sub(p, a));
  const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / l2));
  return len(sub(p, add(a, mul(d, t))));
}

/** Free sub-intervals of [lo, hi] not covered by `covered` (sorted merge). */
function freeIntervals(covered, lo, hi) {
  const out = [];
  let cursor = lo;
  for (const [c0, c1] of [...covered].sort((x, y) => x[0] - y[0])) {
    if (c1 <= cursor) continue;
    if (c0 >= hi) break;
    if (c0 > cursor) out.push([cursor, Math.min(c0, hi)]);
    cursor = Math.max(cursor, c1);
  }
  if (cursor < hi) out.push([cursor, hi]);
  return out.filter(([p, q]) => q - p > 1e-6);
}

function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Call visit(i, j) for every pair of lines that are near-parallel (within
 * tolRad) and whose perpendicular offsets differ by at most maxOffset.
 * Lines are bucketed by direction, then sorted by offset along the bucket's
 * normal, so each line only meets its plausible partners — O(n log n + k)
 * instead of comparing every pair (a 14k-line plan went from seconds to ms).
 */
function forNearParallel(lines, tolRad, maxOffset, visit) {
  const angleOf = (u) => {
    let a = Math.atan2(u.y, u.x);
    if (a < 0) a += Math.PI;
    if (a >= Math.PI) a -= Math.PI;
    return a;
  };
  const nBuckets = Math.max(1, Math.round(Math.PI / Math.max(tolRad, 1e-3)));
  const buckets = new Map();
  lines.forEach((l, i) => {
    const key = Math.floor((angleOf(l.u) / Math.PI) * nBuckets) % nBuckets;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  });
  const seen = new Set();
  for (const [key, members] of buckets) {
    // Compare within the bucket and with the next bucket (wrapping at π), so
    // a pair straddling a bucket boundary is still found.
    const nextKey = (key + 1) % nBuckets;
    const pool = nextKey === key ? members : [...members, ...(buckets.get(nextKey) || [])];
    const ang = ((key + 0.5) / nBuckets) * Math.PI;
    const n = { x: -Math.sin(ang), y: Math.cos(ang) };
    const sorted = pool.map((i) => ({ i, off: n.x * lines[i].a.x + n.y * lines[i].a.y })).sort((a, b) => a.off - b.off);
    for (let x = 0; x < sorted.length; x += 1) {
      for (let y = x + 1; y < sorted.length && sorted[y].off - sorted[x].off <= maxOffset; y += 1) {
        const i = Math.min(sorted[x].i, sorted[y].i);
        const j = Math.max(sorted[x].i, sorted[y].i);
        const k = i * lines.length + j;
        if (seen.has(k)) continue;
        seen.add(k);
        visit(i, j);
      }
    }
  }
}

/**
 * @param {Array<{a,b}>} segments   wall-layer segments
 * @param {Array<{type:"door"|"window", points:Array<{x,y}>}>} clusters  opening linework groups
 * @returns {{ walls: Array<{a,b,thicknessIn,openings:Array<{type,offsetIn,widthIn}>}>,
 *            unplaced: Array, notes: string[], stats: object }}
 */
export function reconstructWalls(segments, clusters = [], options = {}) {
  const o = { ...WALL_DEFAULTS, ...options };
  const sinTol = Math.sin((o.angleTolDeg * Math.PI) / 180);
  const segs = segments.map((s) => seg(s.a, s.b)).filter((s) => s.len >= 1);
  const covered = segs.map(() => []);

  // ---- 1. face pairing -------------------------------------------------
  const candidates = [];
  const tolRad = (o.angleTolDeg * Math.PI) / 180;
  const consider = (i, j) => {
    const si = segs[i];
    const sj = segs[j];
    if (Math.abs(cross(si.u, sj.u)) > sinTol) return;
    const mid = mul(add(sj.a, sj.b), 0.5);
    const side = cross(si.u, sub(mid, si.a));
    const d = Math.abs(side);
    if (d < o.minThicknessIn || d > o.maxThicknessIn) return;
    const t0 = dot(sub(sj.a, si.a), si.u);
    const t1 = dot(sub(sj.b, si.a), si.u);
    const lo = Math.max(0, Math.min(t0, t1));
    const hi = Math.min(si.len, Math.max(t0, t1));
    if (hi - lo < o.minPairOverlapIn) return;
    candidates.push({ i, j, d, lo, hi, side: Math.sign(side) });
  };
  // Offset slack covers the small angle tolerance over long lines.
  forNearParallel(segs, tolRad, o.maxThicknessIn + 2, (i, j) => {
    consider(i, j);
    consider(j, i);
  });
  candidates.sort((x, y) => x.d - y.d || y.hi - y.lo - (x.hi - x.lo));

  const pieces = []; // centerline pieces { s: seg, thicknessIn }
  for (const c of candidates) {
    const si = segs[c.i];
    const sj = segs[c.j];
    for (const [p, q] of freeIntervals(covered[c.i], c.lo, c.hi)) {
      // Map [p,q] on i to j's parameter, intersect with j's free space.
      const tj0 = dot(sub(at(si, p), sj.a), sj.u);
      const tj1 = dot(sub(at(si, q), sj.a), sj.u);
      const jlo = Math.max(0, Math.min(tj0, tj1));
      const jhi = Math.min(sj.len, Math.max(tj0, tj1));
      for (const [g0, g1] of freeIntervals(covered[c.j], jlo, jhi)) {
        const x0 = dot(sub(at(sj, g0), si.a), si.u);
        const x1 = dot(sub(at(sj, g1), si.a), si.u);
        const lo = Math.max(p, Math.min(x0, x1));
        const hi = Math.min(q, Math.max(x0, x1));
        if (hi - lo < o.minPairOverlapIn) continue;
        const normal = mul({ x: -si.u.y, y: si.u.x }, (c.side * c.d) / 2);
        pieces.push({ s: seg(add(at(si, lo), normal), add(at(si, hi), normal)), thicknessIn: c.d });
        covered[c.i].push([lo, hi]);
        covered[c.j].push([g0, g1]);
      }
    }
  }
  const pairedCount = pieces.length;

  // ---- 2. single-line leftovers ------------------------------------------
  let singleLineCount = 0;
  segs.forEach((s, i) => {
    for (const [p, q] of freeIntervals(covered[i], 0, s.len)) {
      if (q - p >= o.minSingleLineWallIn) {
        pieces.push({ s: seg(at(s, p), at(s, q)), thicknessIn: null });
        singleLineCount += 1;
      }
    }
  });

  // ---- 3. rejoin collinear pieces across gaps (openings) -------------------
  const used = new Set();
  const parent = pieces.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  forNearParallel(pieces.map((pc) => pc.s), tolRad, o.collinearTolIn + 1, (i, j) => {
    const pi = pieces[i].s;
    const pj = pieces[j].s;
    if (Math.abs(cross(pi.u, pj.u)) > sinTol) return;
    const mid = mul(add(pj.a, pj.b), 0.5);
    if (Math.abs(cross(pi.u, sub(mid, pi.a))) > o.collinearTolIn) return;
    parent[find(i)] = find(j);
  });
  const groupMap = new Map();
  pieces.forEach((_, i) => {
    const r = find(i);
    if (!groupMap.has(r)) groupMap.set(r, []);
    groupMap.get(r).push(i);
  });
  const groups = [...groupMap.values()];

  const walls = [];
  for (const g of groups) {
    const ref = pieces[g[0]].s;
    const spans = g
      .map((idx) => {
        const s = pieces[idx].s;
        const t0 = dot(sub(s.a, ref.a), ref.u);
        const t1 = dot(sub(s.b, ref.a), ref.u);
        const off = cross(ref.u, sub(mul(add(s.a, s.b), 0.5), ref.a));
        return { lo: Math.min(t0, t1), hi: Math.max(t0, t1), off, thicknessIn: pieces[idx].thicknessIn };
      })
      .sort((x, y) => x.lo - y.lo);
    const offset = median(spans.map((sp) => sp.off)) || 0;
    const normal = { x: -ref.u.y, y: ref.u.x };
    const point = (t) => add(add(ref.a, mul(ref.u, t)), mul(normal, offset));

    const groupWalls = [];
    let cur = null;
    const closeCurrent = () => {
      if (cur) groupWalls.push(cur);
      cur = null;
    };
    for (const sp of spans) {
      if (!cur) {
        cur = { lo: sp.lo, hi: sp.hi, thick: [sp.thicknessIn], openings: [] };
        continue;
      }
      const gap = sp.lo - cur.hi;
      if (gap <= 1) {
        cur.hi = Math.max(cur.hi, sp.hi);
        cur.thick.push(sp.thicknessIn);
        continue;
      }
      if (gap <= o.maxOpeningIn) {
        const g0 = point(cur.hi);
        const g1 = point(sp.lo);
        const reach = (median(cur.thick) || 6) / 2 + 3;
        const hit = clusters.findIndex((cl, ci) => !used.has(ci) && cl.points.some((p) => distToSegment(p, g0, g1) <= reach));
        if (hit !== -1) {
          used.add(hit);
          cur.openings.push({ type: clusters[hit].type, lo: cur.hi, hi: sp.lo });
          cur.hi = Math.max(cur.hi, sp.hi);
          cur.thick.push(sp.thicknessIn);
          continue;
        }
      }
      closeCurrent();
      cur = { lo: sp.lo, hi: sp.hi, thick: [sp.thicknessIn], openings: [] };
    }
    closeCurrent();
    // Spans → endpoints. Openings are kept as absolute points so corner
    // snapping (which may move `a`) can't shift them along the wall.
    for (const w of groupWalls) {
      walls.push({
        a: point(w.lo),
        b: point(w.hi),
        thicknessIn: median(w.thick),
        openings: w.openings.map((op) => ({ type: op.type, p0: point(op.lo), p1: point(op.hi) })),
      });
    }
  }

  // ---- 4. corner / T-junction snapping --------------------------------------
  const maxSnap = o.maxThicknessIn;
  const lineIntersect = (w1, w2) => {
    const d1 = sub(w1.b, w1.a);
    const d2 = sub(w2.b, w2.a);
    const den = cross(d1, d2);
    if (Math.abs(den) < 1e-9 * len(d1) * len(d2)) return null;
    const t = cross(sub(w2.a, w1.a), d2) / den;
    return add(w1.a, mul(d1, t));
  };
  const onOrNear = (w, x, slack) => distToSegment(x, w.a, w.b) <= slack;
  for (let i = 0; i < walls.length; i += 1) {
    for (const end of ["a", "b"]) {
      const e = walls[i][end];
      let best = null;
      for (let j = 0; j < walls.length; j += 1) {
        if (j === i) continue;
        const x = lineIntersect(walls[i], walls[j]);
        if (!x) continue;
        const dist = len(sub(e, x));
        if (dist > maxSnap || !onOrNear(walls[j], x, maxSnap)) continue;
        if (!best || dist < best.dist) best = { j, x, dist };
      }
      if (!best) continue;
      walls[i][end] = best.x;
      // L-corner: also bring the other wall's nearer end to the corner.
      const wj = walls[best.j];
      const endJ = len(sub(wj.a, best.x)) <= len(sub(wj.b, best.x)) ? "a" : "b";
      if (len(sub(wj[endJ], best.x)) <= maxSnap && !onOrNear({ a: wj.a, b: wj.b }, best.x, 0.01)) wj[endJ] = best.x;
    }
  }

  // ---- 5. openings on unbroken walls ---------------------------------------
  const unplaced = [];
  clusters.forEach((cl, ci) => {
    if (used.has(ci)) return;
    const c = cl.points.reduce((acc, p) => add(acc, mul(p, 1 / cl.points.length)), { x: 0, y: 0 });
    let best = null;
    for (const w of walls) {
      const d = distToSegment(c, w.a, w.b);
      const reach = (w.thicknessIn || 6) / 2 + 24;
      if (d <= reach && (!best || d < best.d)) best = { w, d };
    }
    if (!best) {
      unplaced.push(cl);
      return;
    }
    const s = seg(best.w.a, best.w.b);
    const ts = cl.points.map((p) => dot(sub(p, s.a), s.u));
    const lo = Math.max(0, Math.min(...ts));
    const hi = Math.min(s.len, Math.max(...ts));
    if (hi - lo < 12) {
      unplaced.push(cl);
      return;
    }
    best.w.openings.push({ type: cl.type, p0: at(s, lo), p1: at(s, hi) });
  });

  // ---- output: offsets measured from the (possibly snapped) wall start --------
  const out = walls
    .filter((w) => len(sub(w.b, w.a)) >= 1)
    .map((w) => {
      const s = seg(w.a, w.b);
      const openings = w.openings
        .map((op) => {
          const t0 = dot(sub(op.p0, s.a), s.u);
          const t1 = dot(sub(op.p1, s.a), s.u);
          const lo = Math.max(0, Math.min(t0, t1));
          const hi = Math.min(s.len, Math.max(t0, t1));
          return { type: op.type, offsetIn: round2(lo), widthIn: round2(hi - lo) };
        })
        .filter((op) => op.widthIn >= 6)
        .sort((x, y) => x.offsetIn - y.offsetIn);
      return { a: roundPt(w.a), b: roundPt(w.b), thicknessIn: w.thicknessIn == null ? null : round2(w.thicknessIn), openings };
    });

  const notes = [];
  if (singleLineCount > 0) {
    notes.push(`${singleLineCount} single wall line${singleLineCount === 1 ? " was" : "s were"} taken as wall centerline${singleLineCount === 1 ? "" : "s"} (no parallel face found).`);
  }
  return {
    walls: out,
    unplaced,
    notes,
    stats: { pairedPieces: pairedCount, singleLinePieces: singleLineCount, thicknessIn: median(out.map((w) => w.thicknessIn)) },
  };
}

function round2(v) {
  return Math.round(v * 100) / 100;
}
function roundPt(p) {
  return { x: round2(p.x), y: round2(p.y) };
}
