// D3 dashboard: a deterministic squarified treemap layout (Bruls,
// Huizing, van Wijk 2000) — a pure geometry function with no chart
// library, no cloud call, no license to track. Given a list of
// positive weights and a container size, it returns each item's
// rectangle (x, y, width, height) in the same units as the container,
// laid out to keep tiles as close to square as the weights allow.
//
// Determinism: callers must pass items in a stable order (the D3
// summarizer sorts groups/statuses before this ever runs) — this
// function itself never reorders ties by anything but input order, so
// the same input always produces the same rectangles.

/** The "worst" aspect ratio a row of `weights` would have if laid out
 *  along a strip of length `side` (the shorter side of the remaining
 *  rectangle) — lower is better (closer to 1 = square). */
function worstRatio(weights, side) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const max = Math.max(...weights);
  const min = Math.min(...weights);
  const sideSq = side * side;
  const sumSq = sum * sum;
  return Math.max((sideSq * max) / sumSq, sumSq / (sideSq * min));
}

/**
 * Lay out `items` (each `{ weight, ...anything }`, weight > 0) inside a
 * `width` x `height` rectangle anchored at (x, y) (default 0,0).
 * Returns a new array, same order as input, each entry spread with
 * `{ x, y, width, height }` added. An item with weight <= 0 is dropped
 * entirely (never a zero-area tile) — callers that need to represent
 * "nothing here" render their own empty state instead of asking this
 * function for a zero-weight rectangle.
 */
export function layoutTreemap(items, width, height, x = 0, y = 0) {
  const positive = (items || []).filter((item) => Number(item.weight) > 0);
  if (positive.length === 0 || width <= 0 || height <= 0) return [];
  const totalWeight = positive.reduce((sum, item) => sum + item.weight, 0);
  const area = width * height;
  // Scale every weight into area units so the squarify algorithm's
  // "fill the remaining rectangle exactly" invariant holds.
  const scaled = positive.map((item) => ({ ...item, _area: (item.weight / totalWeight) * area }));

  const result = [];
  let remaining = scaled;
  let rx = x, ry = y, rw = width, rh = height;
  while (remaining.length > 0) {
    const side = Math.min(rw, rh);
    let row = [remaining[0]];
    let rowSum = remaining[0]._area;
    let bestRatio = worstRatio(row.map((r) => r._area), side);
    let i = 1;
    while (i < remaining.length) {
      const candidateAreas = [...row, remaining[i]].map((r) => r._area);
      const candidateRatio = worstRatio(candidateAreas, side);
      if (candidateRatio <= bestRatio) {
        row.push(remaining[i]);
        rowSum += remaining[i]._area;
        bestRatio = candidateRatio;
        i += 1;
      } else {
        break;
      }
    }
    remaining = remaining.slice(row.length);

    if (rw >= rh) {
      // The remaining rectangle is wider than tall: lay this row out as
      // a column (fixed width, items stacked top to bottom within it).
      const colWidth = rh > 0 ? rowSum / rh : 0;
      let cy = ry;
      for (const item of row) {
        const itemHeight = colWidth > 0 ? item._area / colWidth : 0;
        const { _area, ...rest } = item;
        result.push({ ...rest, x: rx, y: cy, width: colWidth, height: itemHeight });
        cy += itemHeight;
      }
      rx += colWidth;
      rw -= colWidth;
    } else {
      // Taller than wide: lay this row out as a horizontal strip.
      const rowHeight = rw > 0 ? rowSum / rw : 0;
      let cx = rx;
      for (const item of row) {
        const itemWidth = rowHeight > 0 ? item._area / rowHeight : 0;
        const { _area, ...rest } = item;
        result.push({ ...rest, x: cx, y: ry, width: itemWidth, height: rowHeight });
        cx += itemWidth;
      }
      ry += rowHeight;
      rh -= rowHeight;
    }
  }
  return result;
}
