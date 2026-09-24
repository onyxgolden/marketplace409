/**
 * Geometry-only classification for PDF import.
 *
 * A VSDX shape carries semantics (a master literally named "Wall"), so the
 * VSDX classifier can refuse to guess. A PDF carries NONE: by the time a
 * drawing is printed to PDF, walls, dimension strings, hatching, the title
 * block and the north arrow are all just stroked paths. There is no honest
 * way to tell a wall from a leader line.
 *
 * So this importer does not pretend to. It performs a faithful GEOMETRIC
 * TRANSCRIPTION: every visible path becomes real, editable Designer wall
 * segments — selectable, movable, deletable, exactly like hand-drawn ones —
 * and the user prunes what they do not want. The alternative (inventing
 * semantics from line weights) would silently mislabel geometry, which this
 * codebase's importer discipline forbids.
 *
 * What IS filtered is only what is defensible without semantics:
 *   - dashed strokes (centerlines, hidden lines, leaders by convention),
 *     excludable by option and on by default;
 *   - segments below a length floor, which would otherwise turn hatching and
 *     text outlines into thousands of one-inch walls;
 *   - degenerate geometry the document model would reject anyway.
 *
 * Output: { kind, reason, detail } with kind ∈ wall | skipped.
 */

/** The document model rejects walls under 1 inch; never emit one. */
export const MIN_WALL_LENGTH_IN = 1;

/** Default minimum segment length kept, in final plan inches. */
export const DEFAULT_MIN_SEGMENT_IN = 6;

export const CLASSIFIER_DEFAULTS = Object.freeze({
  minSegmentIn: DEFAULT_MIN_SEGMENT_IN,
  includeDashed: false,
  includeFilledOutlines: true,
});

/**
 * Classify one path (already flattened, scaled, and in Designer inches).
 *
 * path: { polylines: [{ points, closed }], dashed, stroked, filled,
 *         lineWidthIn }
 */
export function classifyPath(path, options = {}) {
  const opts = { ...CLASSIFIER_DEFAULTS, ...options };
  const minSegmentIn = Math.max(MIN_WALL_LENGTH_IN, Number(opts.minSegmentIn) || MIN_WALL_LENGTH_IN);

  if (!path || !Array.isArray(path.polylines) || path.polylines.length === 0) {
    return { kind: "skipped", reason: "no drawable geometry", detail: null };
  }
  if (path.dashed && !opts.includeDashed) {
    return {
      kind: "skipped",
      reason: "dashed stroke (centerline / hidden line / leader by drafting convention)",
      detail: null,
    };
  }
  if (!path.stroked && path.filled && !opts.includeFilledOutlines) {
    return { kind: "skipped", reason: "filled region without an outline stroke", detail: null };
  }

  const segments = [];
  let droppedShort = 0;
  for (const line of path.polylines) {
    const points = (line && line.points) || [];
    if (points.length < 2) continue;
    // A closed subpath's final edge (last → first) is real geometry and is
    // only present as the `closed` flag, so it is re-added here.
    const ordered = line.closed ? [...points, points[0]] : points;
    for (let i = 1; i < ordered.length; i += 1) {
      const a = ordered[i - 1];
      const b = ordered[i];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (!(length >= minSegmentIn)) {
        droppedShort += 1;
        continue;
      }
      segments.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, lengthIn: length });
    }
  }

  if (segments.length === 0) {
    return {
      kind: "skipped",
      reason:
        droppedShort > 0
          ? `every segment is shorter than the ${minSegmentIn}″ minimum (${droppedShort} dropped)`
          : "no segments with length",
      detail: null,
    };
  }

  return {
    kind: "wall",
    reason: path.stroked ? "stroked path" : "filled outline",
    detail: { segments, droppedShort, fromFill: !path.stroked && !!path.filled },
  };
}

/**
 * Census of a page's content used to decide vector vs. scanned. Pure.
 *
 * A scanned page is one big image and (with OCR) possibly invisible text, but
 * essentially no path geometry. A vector page is the opposite. Pages that are
 * genuinely both (a vector plan with a raster site photo, or a scan with a
 * vector title block stamped on top) are reported as `mixed` so the UI can
 * offer BOTH paths rather than picking one behind the user's back.
 *
 * The measure is SEGMENTS, not paths. A clean floor plan can be a dozen
 * polylines carrying hundreds of segments, and judging it by path count alone
 * declares a perfectly importable drawing empty. What distinguishes a scan is
 * that its vector content is incidental — a border, a stamp, a few ticks.
 */

/**
 * Below this many drawable segments, vector content is treated as incidental.
 * Calibrated against real files: a scanned sheet's vector extras (a frame, a
 * stamp, a few registration ticks) run to a handful of segments, while even a
 * deliberately simple to-scale floor plan clears twenty.
 */
export const INCIDENTAL_SEGMENT_LIMIT = 12;

export function classifyPageKind(census) {
  const paths = (census && census.pathCount) || 0;
  const images = (census && census.imageCount) || 0;
  // Older censuses (and hand-written fixtures) may carry no segment count;
  // fall back to paths so such input still classifies sensibly.
  const segments = census && Number.isFinite(census.segmentCount) ? census.segmentCount : paths;
  const hasVector = paths > 0 && segments > INCIDENTAL_SEGMENT_LIMIT;

  if (paths === 0 && images === 0) {
    return { kind: "empty", reason: "This page has no vector paths and no images — there is nothing to import." };
  }
  if (images > 0 && !hasVector) {
    return {
      kind: "raster",
      reason: `${images} image${images === 1 ? "" : "s"} and only ${segments} vector segment${segments === 1 ? "" : "s"} — this page is a scan.`,
    };
  }
  if (images > 0) {
    return {
      kind: "mixed",
      reason: `${segments} vector segments and ${images} image${images === 1 ? "" : "s"} — this page has both; choose how to import it.`,
    };
  }
  if (hasVector) {
    return { kind: "vector", reason: `${segments} vector segments across ${paths} path${paths === 1 ? "" : "s"}, no images.` };
  }
  return {
    kind: "sparse",
    reason: `only ${segments} vector segment${segments === 1 ? "" : "s"} and no images — there may be little worth importing here.`,
  };
}
