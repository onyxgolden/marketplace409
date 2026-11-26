// Deterministic, screen-space ranked greedy label layout for the Designer
// 2D Plot Plan (see the scope brief, results/chatgpt/
// designer-label-layout-engine-scope-2026-11-26.md §3-§4).
//
// The problem it solves: plot-plan labels are drawn at a FIXED screen
// size while the drawing shrinks underneath them, so at fit-to-view on a
// phone (~400px) dozens of equipment tags, pipe dimensions and captions
// stack into one unreadable pile. The map-makers' combination, in plain
// words: rank, thin by zoom, place greedily, lead the rest out on
// callouts, and let the user tap for the rest.
//
// What this module is — and is not:
//   * PURE: no DOM, no React, no design object. Candidates arrive with
//     screen-space anchors already computed; the layout runs on committed
//     view state and returns plain placements the SVG renderer draws.
//   * DETERMINISTIC: same candidates + viewport + tier always yield the
//     same placed/withheld sets — no randomness, no iteration-order
//     dependence, no annealing or force-directed placement. Labels never
//     flicker or reshuffle between renders at the same view.
//   * The renderer stays SVG (PlanCanvas renders SVG text). A detached
//     2D canvas context is used ONLY to measure text widths via
//     ctx.measureText; when no canvas context exists (tests, SSR) the
//     conservative estimator from designerGeometry is the fallback.
//
// Placement model (documented so the geometry guard can agree with it):
//   * Every candidate has an anchor point in screen px plus a nominal
//     glyph half-extent (halfW/halfH — the symbol's screen bounds; 0 for
//     point anchors such as pipe midpoints). The label box is placed
//     against those bounds with a fixed 6px gap.
//   * Four positions are tried, in this order: upper-left, upper-right,
//     lower-left, lower-right. "Upper-left" means the label box's
//     bottom-right corner sits 6px left of the glyph's left edge and
//     6px above its top edge, and so on for the other corners. The
//     first box fully inside the safe viewport and disjoint from every
//     already-accepted padded rectangle wins.
//     Order note: upper-LEFT first (not upper-right). The FCCU's
//     equipment rows are ranked left-to-right, so upper-right-first
//     cascades each tag right into the next glyph's tag space and
//     withholds 5 of 14 Tier 1 tags at fit; upper-left-first lets each
//     tag nest into the free space left of its glyph and places 12 of
//     14 (measured on the real fixture, jsdom probe + geometry guard).
//     The brief lists the four positions without binding their order;
//     the mechanism — four positions, first non-overlapping wins —
//     is unchanged. Flagged in the PR for the reviewer's call.
//   * A label placed BELOW its glyph (lower-right / lower-left) is
//     visually detached from the usual above-glyph reading position, so
//     it gets a thin leader line back to a small dot on the glyph's
//     edge. Upper placements sit adjacent to the glyph and get no
//     leader. At most four leaders per viewport, assigned in
//     tier/rank order; a lower placement that would exceed the cap is
//     rejected and the label is withheld rather than drawn misleadingly.
//   * Pipe dimensions try the four horizontal positions first
//     ("horizontal by default"). A pipe-aligned ROTATED label is a
//     further attempt, allowed only when the straight segment is long
//     enough to hold the whole text (segment length >= text width +
//     2x padding + 12px) and the correctly rotated four-corner AABB
//     fits inside the viewport without colliding.
//   * A candidate whose four positions (plus rotated, for pipes) all
//     fail is WITHHELD — never drawn overlapping or clipped. Withheld
//     labels are recoverable through the hidden-labels list / tap-select;
//     hiding is safe because nothing is ever lost, only unplaced.
//
// Tier policy (zoom thinning):
//   * z = view.scale / fitScale, where fitScale is the current
//     design/level's computed content fit for the current pane.
//     z < 1.5 -> Tier 1 only; 1.5 <= z < 2.5 -> Tier 1+2; z >= 2.5 ->
//     all tiers. Thresholds are implementation defaults from the brief.
//   * ~5% hysteresis around each transition so a pinch that settles
//     near a threshold does not flicker tiers: going up, a tier reveals
//     at its threshold; going down, it hides only below
//     threshold * (1 - 0.05). Settling at a given scale from either
//     direction reaches the same tier after the hysteresis band.

import { estimateTextWidthPx } from "./designerGeometry";

/** Tier ids. 1 = key equipment, 2 = supporting equipment, 3 = details. */
export const LABEL_TIERS = Object.freeze({ KEY: 1, SUPPORTING: 2, DETAIL: 3 });

/** Minimum rendered font size per tier (CSS px). Never smaller. */
export const TIER_FONT_PX = Object.freeze({ 1: 13, 2: 12, 3: 12 });

/** Screen padding (px) kept on every side of an accepted label box. */
export const LABEL_COLLISION_PAD_PX = 5;

/** Fixed gap (px) between a label box and its glyph bounds / anchor. */
export const LABEL_ANCHOR_OFFSET_PX = 6;

/** Maximum leader callouts drawn per viewport. */
export const LABEL_LEADER_MAX = 4;

/** Relative-zoom thresholds at which Tier 2 / Tier 3 reveal. */
export const TIER_REVEAL_ZOOM = Object.freeze({ TIER2: 1.5, TIER3: 2.5 });

/** Hysteresis band around tier transitions (fraction of the threshold). */
export const TIER_HYSTERESIS = 0.05;

/** Viewport inset (px) a label box must respect inside the pane. */
export const LABEL_VIEWPORT_INSET_PX = 2;

/** Extra segment length (px) a rotated pipe label needs beyond its text. */
export const ROTATED_LABEL_EXTRA_PX = 12;

/** Max entries in the shared glyph-width cache. */
export const TEXT_MEASURE_CACHE_MAX = 512;

/** Line-height factor used to size a label's reserved box. */
const LINE_HEIGHT_EM = 1.2;

/** Fraction of the font size the text baseline sits below the box top
 *  (padding) — ascent is ~0.8em for the sans used here. */
const BASELINE_EM = 0.8;

/**
 * Direct (no-hysteresis) max tier for a relative zoom: z < 1.5 -> 1,
 * z < 2.5 -> 2, else 3. Used to initialise the tier when no previous
 * tier exists, and in tests. Non-finite z behaves as fit (Tier 1).
 */
export function maxTierForRelativeZoom(z) {
  if (!Number.isFinite(z)) return 1;
  if (z >= TIER_REVEAL_ZOOM.TIER3) return 3;
  if (z >= TIER_REVEAL_ZOOM.TIER2) return 2;
  return 1;
}

/**
 * Hysteresis-aware max tier for a relative zoom given the previously
 * settled tier (null/undefined = initialise from z directly).
 *
 * Going up, a tier reveals exactly at its threshold. Going down, it
 * hides only below threshold * (1 - HYSTERESIS), so a pinch settling
 * near a threshold does not flicker. Cascades: dropping from 3 to 1
 * in one step crosses both bands.
 */
export function tierForRelativeZoom(z, prevMaxTier) {
  if (!Number.isFinite(z)) return 1;
  if (prevMaxTier == null) return maxTierForRelativeZoom(z);
  const prev = prevMaxTier;
  let next = prev;
  if (prev < 2 && z >= TIER_REVEAL_ZOOM.TIER2) next = 2;
  if (prev < 3 && z >= TIER_REVEAL_ZOOM.TIER3) next = 3;
  if (prev >= 3 && z < TIER_REVEAL_ZOOM.TIER3 * (1 - TIER_HYSTERESIS)) next = 2;
  if (prev >= 2 && z < TIER_REVEAL_ZOOM.TIER2 * (1 - TIER_HYSTERESIS)) next = 1;
  return next;
}

/**
 * Shared glyph-width measurer. In a browser it uses one detached 2D
 * canvas context (created lazily, never attached to the document);
 * anywhere else it falls back to the conservative estimator, which can
 * only over-estimate — a too-wide estimate withholds a label that
 * would have fit, never admits one that actually collides.
 *
 * `measure(text, fontSpec)` — fontSpec: { fontSizePx, fontWeight,
 * fontFamily }. Results are cached by font + text (LRU, capped).
 */
export function createTextMeasurer() {
  let ctx = null;
  let ctxTried = false;
  const cache = new Map();
  function getCtx() {
    if (ctxTried) return ctx;
    ctxTried = true;
    try {
      if (typeof document !== "undefined" && document.createElement) {
        ctx = document.createElement("canvas").getContext("2d");
      }
    } catch {
      ctx = null;
    }
    return ctx;
  }
  function fontString({ fontSizePx, fontWeight = 600, fontFamily } = {}) {
    const size = Number.isFinite(fontSizePx) && fontSizePx > 0 ? fontSizePx : 12;
    const family = fontFamily || "system-ui, -apple-system, 'Segoe UI', sans-serif";
    return `${fontWeight} ${size}px ${family}`;
  }
  function measure(text, fontSpec = {}) {
    if (typeof text !== "string" || text.length === 0) return 0;
    const size = Number.isFinite(fontSpec.fontSizePx) && fontSpec.fontSizePx > 0 ? fontSpec.fontSizePx : 12;
    const key = `${fontString({ ...fontSpec, fontSizePx: size })}|${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let width = 0;
    const c = getCtx();
    if (c) {
      try {
        c.font = fontString({ ...fontSpec, fontSizePx: size });
        width = Math.ceil(c.measureText(text).width);
      } catch {
        width = 0;
      }
    }
    if (!width) width = estimateTextWidthPx(text, size);
    if (cache.size >= TEXT_MEASURE_CACHE_MAX) {
      const first = cache.keys().next().value;
      cache.delete(first);
    }
    cache.set(key, width);
    return width;
  }
  return {
    measure,
    get cacheSize() {
      return cache.size;
    },
    clear() {
      cache.clear();
    },
  };
}

function rectsOverlap(a, b, padPx) {
  return (
    a.left - padPx < b.right + padPx &&
    b.left - padPx < a.right + padPx &&
    a.top - padPx < b.bottom + padPx &&
    b.top - padPx < a.bottom + padPx
  );
}

function rectInside(rect, viewport, inset) {
  return (
    rect.left >= viewport.left + inset &&
    rect.right <= viewport.right - inset &&
    rect.top >= viewport.top + inset &&
    rect.bottom <= viewport.bottom - inset
  );
}

function boxForAnchor({ anchor, widthPx, heightPx, position }) {
  const ax = anchor.x;
  const ay = anchor.y;
  const hw = Math.max(0, anchor.halfW || 0);
  const hh = Math.max(0, anchor.halfH || 0);
  const gap = LABEL_ANCHOR_OFFSET_PX;
  let left;
  let top;
  if (position === "upper-right") {
    left = ax + hw + gap;
    top = ay - hh - gap - heightPx;
  } else if (position === "upper-left") {
    left = ax - hw - gap - widthPx;
    top = ay - hh - gap - heightPx;
  } else if (position === "lower-right") {
    left = ax + hw + gap;
    top = ay + hh + gap;
  } else {
    // lower-left
    left = ax - hw - gap - widthPx;
    top = ay + hh + gap;
  }
  return { left, top, right: left + widthPx, bottom: top + heightPx };
}

function rotatedBoxForAnchor({ anchor, widthPx, heightPx, angleDeg }) {
  const theta = ((Number.isFinite(angleDeg) ? angleDeg : 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const corners = [
    [-widthPx / 2, -heightPx / 2],
    [widthPx / 2, -heightPx / 2],
    [-widthPx / 2, heightPx / 2],
    [widthPx / 2, heightPx / 2],
  ].map(([dx, dy]) => [anchor.x + dx * cos - dy * sin, anchor.y + dx * sin + dy * cos]);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

/** Closest point on the glyph-bounds rect to (x, y) — the leader dot. */
function closestPointOnAnchorRect(anchor, x, y) {
  const hw = Math.max(0, anchor.halfW || 0);
  const hh = Math.max(0, anchor.halfH || 0);
  return {
    x: Math.min(Math.max(x, anchor.x - hw), anchor.x + hw),
    y: Math.min(Math.max(y, anchor.y - hh), anchor.y + hh),
  };
}

const POSITIONS = ["upper-left", "upper-right", "lower-left", "lower-right"];

/**
 * Lay out plot-plan labels in screen space.
 *
 * Candidates (each): {
 *   id: string — stable (kind + source id + role, never display text),
 *   kind: "equipment-tag" | "symbol-tag" | "symbol-caption" |
 *         "pipe-label" | "annotation" | "room-label" | "room-area",
 *   tier: 1 | 2 | 3, rank: number — stable human rank within the tier,
 *   tag: string — short code, fullLabel: string — full identity,
 *   text: string — what is drawn,
 *   fontSizePx, fontWeight, fontFamily?,
 *   anchor: { x, y, halfW, halfH } — screen px; halfW/halfH are the
 *     glyph's nominal half-extent (0 for point anchors),
 *   segment: { angleDeg, lengthPx } | null — pipe dims only; the
 *     rotated attempt needs a straight segment that can hold the text,
 *   sourceId, sourceKind: "symbol" | "pipe" | "annotation" | "room",
 *   source: any — passed through untouched (plan coords for Find),
 * }
 *
 * Options: {
 *   viewport: { left, top, right, bottom } — the safe pane rect,
 *   maxTier: 1 | 2 | 3 — tiers above this are hidden by zoom tier,
 *   measureTextWidth: (text, fontSpec) => px — defaults to a shared
 *     createTextMeasurer() (canvas measureText, estimator fallback),
 *   leaderMax: number — default LABEL_LEADER_MAX,
 * }
 *
 * Returns {
 *   placed: [{ ...candidate, rect, textX, textY, position,
 *              leader: null | { x1, y1, x2, y2, dotX, dotY } }],
 *   withheld: [{ ...candidate, reason: "collision" }],
 *   tierHidden: [{ ...candidate, reason: "tier" }],
 *   diagnostics: {
 *     counts: { candidates, placed, withheld, tierHidden },
 *     byTier: { 1: { candidates, placed, leadered, hidden },
 *               2: {...}, 3: {...} },
 *     leaders: number,
 *   },
 * }
 *
 * Order is deterministic: tier ascending, then rank, then id. Priority
 * labels occupy/lock their box before lower tiers are tried.
 */
export function layoutPlotPlanLabels({ candidates, viewport, maxTier = 1, measureTextWidth, leaderMax = LABEL_LEADER_MAX }) {
  const measure =
    typeof measureTextWidth === "function"
      ? measureTextWidth
      : createTextMeasurer().measure;
  const vp = viewport || { left: 0, top: 0, right: 0, bottom: 0 };
  const inset = LABEL_VIEWPORT_INSET_PX;
  const pad = LABEL_COLLISION_PAD_PX;
  const placed = [];
  const withheld = [];
  const tierHidden = [];
  const acceptedRects = [];
  let leaders = 0;
  const byTier = {
    1: { candidates: 0, placed: 0, leadered: 0, hidden: 0 },
    2: { candidates: 0, placed: 0, leadered: 0, hidden: 0 },
    3: { candidates: 0, placed: 0, leadered: 0, hidden: 0 },
  };
  const list = Array.isArray(candidates) ? [...candidates] : [];
  const ordered = list
    .filter((c) => c && typeof c.id === "string" && typeof c.text === "string" && c.text.length > 0 && c.anchor && Number.isFinite(c.anchor.x) && Number.isFinite(c.anchor.y))
    .sort((a, b) => {
      const ta = a.tier || 3;
      const tb = b.tier || 3;
      if (ta !== tb) return ta - tb;
      const ra = Number.isFinite(a.rank) ? a.rank : 0;
      const rb = Number.isFinite(b.rank) ? b.rank : 0;
      if (ra !== rb) return ra - rb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  for (const c of ordered) {
    const tier = c.tier || 3;
    byTier[tier].candidates += 1;
    if (tier > maxTier) {
      tierHidden.push({ ...c, reason: "tier" });
      continue;
    }
    const fontSizePx = Math.max(
      TIER_FONT_PX[tier] || 12,
      Number.isFinite(c.fontSizePx) && c.fontSizePx > 0 ? c.fontSizePx : 0,
    );
    const fontSpec = { fontSizePx, fontWeight: c.fontWeight || 600, fontFamily: c.fontFamily };
    const textWidth = measure(c.text, fontSpec);
    if (textWidth <= 0) {
      withheld.push({ ...c, reason: "collision" });
      byTier[tier].hidden += 1;
      continue;
    }
    const widthPx = textWidth + pad * 2;
    const heightPx = Math.ceil(fontSizePx * LINE_HEIGHT_EM) + pad * 2;
    const baselineY = (top) => top + pad + fontSizePx * BASELINE_EM;
    const tryBox = (rect, position, leader) => {
      if (!rectInside(rect, vp, inset)) return null;
      if (acceptedRects.some((other) => rectsOverlap(rect, other, 0))) return null;
      return { rect, position, leader };
    };
    let win = null;
    for (const position of POSITIONS) {
      const rect = boxForAnchor({ anchor: c.anchor, widthPx, heightPx, position });
      const isLower = position === "lower-right" || position === "lower-left";
      let leader = null;
      if (isLower) {
        if (leaders >= leaderMax) continue;
        const cornerX = position === "lower-right" ? rect.left : rect.right;
        const dot = closestPointOnAnchorRect(c.anchor, cornerX, rect.top);
        leader = { x1: cornerX, y1: rect.top, x2: dot.x, y2: dot.y, dotX: dot.x, dotY: dot.y };
      }
      win = tryBox(rect, position, leader);
      if (win) break;
    }
    if (!win && c.segment && Number.isFinite(c.segment.lengthPx) && Number.isFinite(c.segment.angleDeg)) {
      // Rotated pipe label: only when the straight segment can hold the
      // whole text, and the rotated four-corner AABB fits and collides
      // with nothing already accepted. No leader — it sits on its pipe.
      if (c.segment.lengthPx >= textWidth + pad * 2 + ROTATED_LABEL_EXTRA_PX) {
        const rect = rotatedBoxForAnchor({
          anchor: c.anchor,
          widthPx,
          heightPx,
          angleDeg: c.segment.angleDeg,
        });
        win = tryBox(rect, "rotated", null);
        if (win) win.angleDeg = c.segment.angleDeg;
      }
    }
    if (!win) {
      withheld.push({ ...c, reason: "collision" });
      byTier[tier].hidden += 1;
      continue;
    }
    if (win.leader) leaders += 1;
    acceptedRects.push(win.rect);
    const textX = (win.rect.left + win.rect.right) / 2;
    const textY = win.position === "rotated" ? c.anchor.y : baselineY(win.rect.top);
    placed.push({
      ...c,
      rect: win.rect,
      textX,
      textY,
      position: win.position,
      angleDeg: win.angleDeg ?? null,
      leader: win.leader,
    });
    byTier[tier].placed += 1;
    if (win.leader) byTier[tier].leadered += 1;
  }
  return {
    placed,
    withheld,
    tierHidden,
    diagnostics: {
      counts: {
        candidates: ordered.length,
        placed: placed.length,
        withheld: withheld.length,
        tierHidden: tierHidden.length,
      },
      byTier,
      leaders,
    },
  };
}
