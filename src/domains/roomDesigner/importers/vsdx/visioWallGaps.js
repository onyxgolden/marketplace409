/**
 * Rejoin Visio wall shapes across a door/window gap (Designer inches).
 *
 * A Visio "Wall" master is drawn as its own straight shape per span, broken
 * at every opening — the same convention CAD faces use (see the DXF
 * importer's dxfWalls.js), except Visio walls are already centerlines, so
 * there's no face-pairing step to do first. Two (or more) collinear Wall
 * shapes with a door/window sitting in the gap between them must become one
 * Designer wall with that opening, not two separate walls plus an orphaned
 * door/window annotation (KNOWN GAP G3: 0 of 11 openings landed before this
 * — every wall run was already fragmented at each opening, and the flat
 * nearest-whole-wall check in visioMapper's tryPlaceOpening only ever
 * compares against a whole (fragment) wall, never the gap between two).
 *
 * Grouping is exact (all pairs), not the bucketed approximation the DXF
 * importer's face-pairing needs for raw CAD linework: a floor plan's wall
 * COUNT (as opposed to raw line segments) is small enough that O(n²) here
 * is negligible, and exact avoids the equivalent bug fixed in dxfWalls.js's
 * own rejoin step (a coarse bucket-normal offset can miss a real collinear
 * pair when a long piece's reference point sits far from the comparison).
 *
 * Pure; conservative — a wall that doesn't group with anything, or a gap
 * with no matching opening nearby, is left exactly as found for the
 * caller's existing nearest-whole-wall fallback to try.
 */

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

function distToSegment(p, a, b) {
  const d = sub(b, a);
  const l2 = dot(d, d);
  if (l2 <= 0) return len(sub(p, a));
  const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / l2));
  return len(sub(p, add(a, mul(d, t))));
}

function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export const WALL_GAP_DEFAULTS = Object.freeze({
  angleTolDeg: 2,
  collinearTolIn: 1.5,
  maxOpeningIn: 144,
  // A door/window shape's pin sits exactly on the wall centerline by
  // construction (Visio PinX/PinY = LocPinX/LocPinY-centered geometry), so
  // this only needs to absorb ordinary floating-point/drawing slack — not
  // scale with opening width the way DXF's swept door-swing arcs do.
  reachIn: 6,
});

/**
 * @param {Array<{id, a, b}>} walls  Wall-classified pieces, in classification order.
 * @param {Array<{type:"door"|"window", center:{x,y}}>} candidates  opening candidates
 * @param {object} [options]
 * @returns {{
 *   walls: Array<{id, a, b, openings: Array<{type, candidateIndex, offsetIn, widthIn}>}>,
 *   matched: Set<number>,   // indices into `candidates` consumed by a gap
 * }}
 */
export function bridgeWallGaps(walls, candidates, options = {}) {
  const o = { ...WALL_GAP_DEFAULTS, ...options };
  const sinTol = Math.sin((o.angleTolDeg * Math.PI) / 180);
  const segs = walls.map((w) => seg(w.a, w.b));

  const parent = walls.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < segs.length; i += 1) {
    for (let j = i + 1; j < segs.length; j += 1) {
      if (Math.abs(cross(segs[i].u, segs[j].u)) > sinTol) continue;
      const mid = mul(add(segs[j].a, segs[j].b), 0.5);
      if (Math.abs(cross(segs[i].u, sub(mid, segs[i].a))) > o.collinearTolIn) continue;
      parent[find(i)] = find(j);
    }
  }
  const groupMap = new Map();
  walls.forEach((_, i) => {
    const r = find(i);
    if (!groupMap.has(r)) groupMap.set(r, []);
    groupMap.get(r).push(i);
  });

  const matched = new Set();
  const rawWalls = []; // { id, lo, hi, openings: [{type, lo, hi}] }, plus the group's point()
  for (const idxs of groupMap.values()) {
    const ref = segs[idxs[0]];
    const spans = idxs
      .map((i) => {
        const s = segs[i];
        const t0 = dot(sub(s.a, ref.a), ref.u);
        const t1 = dot(sub(s.b, ref.a), ref.u);
        const off = cross(ref.u, sub(mul(add(s.a, s.b), 0.5), ref.a));
        return { i, lo: Math.min(t0, t1), hi: Math.max(t0, t1), off };
      })
      .sort((x, y) => x.lo - y.lo);
    const offset = median(spans.map((sp) => sp.off)) || 0;
    const normal = { x: -ref.u.y, y: ref.u.x };
    const point = (t) => add(add(ref.a, mul(ref.u, t)), mul(normal, offset));

    let cur = null;
    const flush = () => {
      if (cur) rawWalls.push({ ...cur, point });
      cur = null;
    };
    for (const sp of spans) {
      if (!cur) {
        cur = { id: walls[sp.i].id, lo: sp.lo, hi: sp.hi, openings: [] };
        continue;
      }
      const gap = sp.lo - cur.hi;
      if (gap <= 1) {
        cur.hi = Math.max(cur.hi, sp.hi);
        continue;
      }
      if (gap <= o.maxOpeningIn) {
        const g0 = point(cur.hi);
        const g1 = point(sp.lo);
        const hit = candidates.findIndex((c, ci) => !matched.has(ci) && distToSegment(c.center, g0, g1) <= o.reachIn);
        if (hit !== -1) {
          matched.add(hit);
          cur.openings.push({ type: candidates[hit].type, candidateIndex: hit, lo: cur.hi, hi: sp.lo });
          cur.hi = Math.max(cur.hi, sp.hi);
          continue;
        }
      }
      flush();
      cur = { id: walls[sp.i].id, lo: sp.lo, hi: sp.hi, openings: [] };
    }
    flush();
  }

  const outWalls = rawWalls
    .filter((w) => w.hi - w.lo >= 1)
    .map((w) => ({
      id: w.id,
      a: w.point(w.lo),
      b: w.point(w.hi),
      openings: w.openings
        .map((op) => ({ type: op.type, candidateIndex: op.candidateIndex, offsetIn: round2(op.lo - w.lo), widthIn: round2(op.hi - op.lo) }))
        .filter((op) => op.widthIn >= 6)
        .sort((x, y) => x.offsetIn - y.offsetIn),
    }));

  return { walls: outWalls, matched };
}

function round2(v) {
  return Math.round(v * 100) / 100;
}
