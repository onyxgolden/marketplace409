/**
 * DXF entities → flat geometry in DRAWING units (CAD Y-up), per layer.
 *
 *   LINE                     → 2-point polyline
 *   LWPOLYLINE / POLYLINE    → polyline (bulge arcs flattened), closed flag kept
 *   ARC / CIRCLE / ELLIPSE   → flattened polyline
 *   SPLINE                   → control polygon (approximation, noted)
 *   INSERT                   → the block's geometry, transformed (scale,
 *                              rotation, position; nested up to MAX_NEST)
 *   TEXT / MTEXT             → text item { x, y, text, height }
 *   DIMENSION                → its anonymous block's geometry, as drawn
 *   everything else          → counted and reported as skipped
 *
 * An INSERT's geometry is placed on the INSERT's own layer when the block
 * entity is on layer "0" (the CAD convention), otherwise on its own layer.
 * Pure.
 */

export const MAX_NEST = 8;
/** Most block instances one array INSERT may expand to. */
export const MAX_ARRAY_INSTANCES = 10000;
const ARC_SEGMENT_DEG = 10;

const deg = (d) => (d * Math.PI) / 180;

/** Flatten an arc (center, radius, start/end degrees CCW) to points. */
export function arcPoints(cx, cy, r, startDeg, endDeg) {
  let sweep = endDeg - startDeg;
  while (sweep <= 0) sweep += 360;
  const n = Math.max(2, Math.ceil(sweep / ARC_SEGMENT_DEG));
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const a = deg(startDeg + (sweep * i) / n);
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/** Points along a polyline, expanding each bulged segment into an arc. */
export function bulgePolyline(vertices, closed) {
  const out = [];
  const count = vertices.length;
  const last = closed ? count : count - 1;
  for (let i = 0; i < count; i += 1) {
    const a = vertices[i];
    out.push({ x: a.x, y: a.y });
    if (i >= last) continue;
    const b = vertices[(i + 1) % count];
    const bulge = a.bulge || 0;
    if (Math.abs(bulge) < 1e-9) continue;
    // Bulge = tan(theta/4): theta is the arc's included angle, positive =
    // counter-clockwise from a to b. Standard center construction with a
    // signed radius: center = a + r·(cos φ, sin φ), φ = chord angle + (π − θ)/2.
    const theta = 4 * Math.atan(bulge);
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    if (chord < 1e-9) continue;
    const r = chord / (2 * Math.sin(theta / 2));
    const phi = Math.atan2(b.y - a.y, b.x - a.x) + (Math.PI - theta) / 2;
    const cx = a.x + r * Math.cos(phi);
    const cy = a.y + r * Math.sin(phi);
    const radius = Math.abs(r);
    const sa = Math.atan2(a.y - cy, a.x - cx);
    const steps = Math.max(2, Math.ceil(Math.abs((theta * 180) / Math.PI) / ARC_SEGMENT_DEG));
    for (let k = 1; k < steps; k += 1) {
      const t = sa + (theta * k) / steps;
      out.push({ x: cx + radius * Math.cos(t), y: cy + radius * Math.sin(t) });
    }
  }
  return out;
}

/** 2D affine matrix helpers: [a, b, c, d, e, f] maps (x, y) → (a x + c y + e, b x + d y + f). */
export const IDENTITY = [1, 0, 0, 1, 0, 0];
function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
export function applyMatrix(m, p) {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}
/**
 * INSERT transform: translate(-base) → scale → array offset → rotate →
 * translate(insertion). Array offsets (column/row spacing, groups 44/45) are
 * in the insert's rotated frame and are not scaled, per the DXF reference.
 */
function insertMatrix(e, base, offsetX = 0, offsetY = 0) {
  const sx = e.s41 || 1;
  const sy = e.s42 || sx;
  const r = deg(e.a50 || 0);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const toOrigin = [1, 0, 0, 1, -base.x, -base.y];
  const scale = [sx, 0, 0, sy, 0, 0];
  const rot = [cos, sin, -sin, cos, 0, 0];
  const place = [1, 0, 0, 1, e.x || 0, e.y || 0];
  const array = [1, 0, 0, 1, offsetX, offsetY];
  return multiply(place, multiply(rot, multiply(array, multiply(scale, toOrigin))));
}

/**
 * Collect geometry from entities.
 * Returns { polylines: [{ layer, points, closed, source }], texts: [{ layer, x, y, text, height }],
 *           skipped: Map(type → count), notes: [] }
 * Everything in drawing units, CAD Y-up.
 */
export function collectGeometry(parsed) {
  const polylines = [];
  const texts = [];
  const skipped = new Map();
  const notes = [];
  const skip = (type) => skipped.set(type, (skipped.get(type) || 0) + 1);
  let splineNoted = false;

  const walk = (entities, matrix, inheritedLayer, depth, source) => {
    for (const e of entities) {
      const layer = inheritedLayer && e.layer === "0" ? inheritedLayer : e.layer;
      const emit = (points, closed) => {
        const clean = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (clean.length >= 2) polylines.push({ layer, points: clean.map((p) => applyMatrix(matrix, p)), closed: !!closed, source: source || e.type });
      };
      switch (e.type) {
        case "LINE":
          emit([{ x: e.x, y: e.y }, { x: e.x2, y: e.y2 }], false);
          break;
        case "LWPOLYLINE":
        case "POLYLINE": {
          const closed = ((e.flags || 0) & 1) === 1;
          if ((e.flags || 0) & (16 | 64)) { skip(`${e.type} (3D mesh)`); break; }
          emit(bulgePolyline(e.points || [], closed), closed);
          break;
        }
        case "ARC":
          if (e.r40 > 0) emit(arcPoints(e.x, e.y, e.r40, e.a50 || 0, e.a51 || 360), false);
          break;
        case "CIRCLE":
          if (e.r40 > 0) emit(arcPoints(e.x, e.y, e.r40, 0, 360).slice(0, -1), true);
          break;
        case "ELLIPSE": {
          // Major axis endpoint (11,21) relative to center; ratio 40; params 41..42.
          const mx = e.x2 || 0;
          const my = e.y2 || 0;
          const ratio = e.r40 || 1;
          const t0 = e.s41 || 0;
          const t1 = e.s42 || Math.PI * 2;
          const n = 36;
          const pts = [];
          for (let i = 0; i <= n; i += 1) {
            const t = t0 + ((t1 - t0) * i) / n;
            pts.push({ x: e.x + mx * Math.cos(t) - my * ratio * Math.sin(t), y: e.y + my * Math.cos(t) + mx * ratio * Math.sin(t) });
          }
          emit(pts, Math.abs(t1 - t0 - Math.PI * 2) < 1e-6);
          break;
        }
        case "SPLINE": {
          const ctrl = [];
          let cur = null;
          for (const [code, value] of e.groups) {
            if (code === 10) { cur = { x: Number.parseFloat(value), y: 0 }; ctrl.push(cur); }
            else if (code === 20 && cur) cur.y = Number.parseFloat(value);
          }
          emit(ctrl, false);
          if (!splineNoted) {
            notes.push({ provenance: "drawing", message: "Splines were imported as their control polygon (an approximation of the curve)." });
            splineNoted = true;
          }
          break;
        }
        case "TEXT":
        case "MTEXT": {
          const text = cleanText(e.text || "");
          const anchor = e.type === "TEXT" ? textAnchor(e) : { x: e.x, y: e.y };
          if (text && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
            const p = applyMatrix(matrix, anchor);
            texts.push({ layer, x: p.x, y: p.y, text, height: e.r40 || 0 });
          }
          break;
        }
        case "INSERT":
        case "DIMENSION": {
          const block = e.name ? parsed.blocks.get(e.name) : null;
          if (!block) { skip(e.type === "DIMENSION" ? "DIMENSION (no geometry block)" : "INSERT (missing block)"); break; }
          if (depth >= MAX_NEST) { skip("INSERT (nested too deep)"); break; }
          if (e.type === "DIMENSION") {
            walk(block.entities, matrix, layer, depth + 1, "dimension");
            break;
          }
          // Array INSERT (MINSERT): group 70 = columns, 71 = rows,
          // 44/45 = column/row spacing. Stamp the block at every cell.
          const cols = Math.max(1, e.flags || 1);
          const rows = Math.max(1, e.i71 || 1);
          if (cols * rows > MAX_ARRAY_INSTANCES) {
            skip("INSERT (block array too large)");
            notes.push({ provenance: `block ${e.name}`, message: `A ${cols} x ${rows} block array was skipped (over ${MAX_ARRAY_INSTANCES.toLocaleString()} instances).` });
            break;
          }
          for (let r = 0; r < rows; r += 1) {
            for (let c = 0; c < cols; c += 1) {
              const m = multiply(matrix, insertMatrix(e, block.base, c * (e.s44 || 0), r * (e.s45 || 0)));
              walk(block.entities, m, layer, depth + 1, `block ${e.name}`);
            }
          }
          break;
        }
        default:
          skip(e.type);
      }
    }
  };

  walk(parsed.entities, IDENTITY, null, 0, null);
  return { polylines, texts, skipped, notes };
}

/**
 * TEXT anchor point. Left-justified text (72=0, 73=0) sits at 10/20. For any
 * other justification AutoCAD positions the text at its alignment point
 * 11/21, except Aligned (72=3) and Fit (72=5), whose text spans 10/20 → 11/21
 * — the midpoint is the text's center. Falls back to 10/20 when 11/21 is
 * missing. (MTEXT is not handled here: its 11/21 is a direction vector.)
 */
export function textAnchor(e) {
  const hasAlign = Number.isFinite(e.x2) && Number.isFinite(e.y2);
  if (hasAlign && (e.h72 === 3 || e.h72 === 5)) return { x: (e.x + e.x2) / 2, y: (e.y + e.y2) / 2 };
  if (hasAlign && ((e.h72 || 0) !== 0 || (e.v73 || 0) !== 0)) return { x: e.x2, y: e.y2 };
  return { x: e.x, y: e.y };
}

/** Strip MTEXT formatting codes (\P, {\f...;}, \A1; etc.) to plain text. */
export function cleanText(raw) {
  return String(raw)
    .replace(/\\P/gi, " ")
    .replace(/\\[A-Za-z][^;\\{}]*;/g, "")
    .replace(/[{}]/g, "")
    .replace(/%%[cC]/g, "⌀")
    .replace(/%%[dD]/g, "°")
    .replace(/%%[pP]/g, "±")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
