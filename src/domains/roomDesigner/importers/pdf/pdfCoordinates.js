/**
 * The SOLE coordinate conversion boundary for the PDF importer.
 *
 * PDF space:      points (1/72 inch), origin bottom-left of the page box,
 *                 Y-up, optionally rotated by /Rotate and scaled by
 *                 /UserUnit.
 * Designer space: inches, origin top-left, Y-down.
 *
 * Rather than hand-rolling a second flip, `pageToDesignerMatrix` reproduces
 * pdf.js's own `PageViewport` transform algebra at scale 1/72. That is
 * deliberate: the viewport transform is what pdf.js uses to rasterize a page,
 * so vector geometry converted through this matrix and a raster underlay
 * rendered by pdf.js land in EXACTLY the same place at the same size. A
 * separately-invented flip would drift from the raster path on rotated pages
 * or a CropBox whose origin is not (0,0), and the two import modes would
 * silently disagree.
 *
 * No other module in this importer negates, flips, or mirrors Y.
 */

/** PDF user-space units per inch. Fixed by the PDF specification. */
export const PDF_POINTS_PER_INCH = 72;

/**
 * PDF user space → Designer inches (Y-down, origin at the top-left of the
 * rotated page box). Mirrors pdfjs-dist PageViewport, with dontFlip=false and
 * no offsets, at scale = 1/72.
 *
 * `viewBox` is the page box as [x0, y0, x1, y1] in points (pdf.js exposes it
 * as `page.view`). `rotation` is /Rotate in degrees, `userUnit` is /UserUnit.
 */
export function pageToDesignerMatrix({ viewBox, rotation = 0, userUnit = 1, unitsPerInch = PDF_POINTS_PER_INCH }) {
  const box = normalizeViewBox(viewBox);
  const scale = (1 / unitsPerInch) * (Number.isFinite(userUnit) && userUnit > 0 ? userUnit : 1);

  const centerX = (box[2] + box[0]) / 2;
  const centerY = (box[3] + box[1]) / 2;

  let rot = Math.round(Number(rotation) || 0) % 360;
  if (rot < 0) rot += 360;
  if (rot % 90 !== 0) rot = 0; // non-conforming /Rotate: treat as upright

  let rotateA;
  let rotateB;
  let rotateC;
  let rotateD;
  switch (rot) {
    case 90:
      rotateA = 0; rotateB = 1; rotateC = 1; rotateD = 0;
      break;
    case 180:
      rotateA = -1; rotateB = 0; rotateC = 0; rotateD = 1;
      break;
    case 270:
      rotateA = 0; rotateB = -1; rotateC = -1; rotateD = 0;
      break;
    default:
      rotateA = 1; rotateB = 0; rotateC = 0; rotateD = -1;
      break;
  }

  let offsetX;
  let offsetY;
  if (rotateA === 0) {
    offsetX = Math.abs(centerY - box[1]) * scale;
    offsetY = Math.abs(centerX - box[0]) * scale;
  } else {
    offsetX = Math.abs(centerX - box[0]) * scale;
    offsetY = Math.abs(centerY - box[1]) * scale;
  }

  return [
    rotateA * scale,
    rotateB * scale,
    rotateC * scale,
    rotateD * scale,
    offsetX - rotateA * scale * centerX - rotateC * scale * centerY,
    offsetY - rotateB * scale * centerX - rotateD * scale * centerY,
  ];
}

/**
 * Size of the page as the Designer sees it, in inches — i.e. AFTER /Rotate,
 * so a rotated landscape page reports landscape dimensions.
 */
export function designerPageSize({ viewBox, rotation = 0, userUnit = 1, unitsPerInch = PDF_POINTS_PER_INCH }) {
  const box = normalizeViewBox(viewBox);
  const scale = (1 / unitsPerInch) * (Number.isFinite(userUnit) && userUnit > 0 ? userUnit : 1);
  let rot = Math.round(Number(rotation) || 0) % 360;
  if (rot < 0) rot += 360;
  const swapped = rot === 90 || rot === 270;
  const w = (box[2] - box[0]) * scale;
  const h = (box[3] - box[1]) * scale;
  return {
    widthIn: round6(swapped ? h : w),
    heightIn: round6(swapped ? w : h),
  };
}

/** Designer-space bounds of polylines ([{points:[{x,y}]}] or [[{x,y}]]). */
export function designerBounds(polylines) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entry of polylines || []) {
    const points = Array.isArray(entry) ? entry : entry && entry.points;
    for (const p of points || []) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Round a Designer-space point; keeps serialized geometry stable. */
export function roundDesignerPoint(p) {
  return { x: round6(p.x), y: round6(p.y) };
}

function normalizeViewBox(viewBox) {
  const raw = Array.from(viewBox || []);
  const nums = raw.map((v) => Number(v));
  if (nums.length !== 4 || !nums.every((v) => Number.isFinite(v))) {
    // A missing or damaged page box would otherwise poison every coordinate;
    // fall back to US Letter so the import degrades instead of failing.
    return [0, 0, 612, 792];
  }
  // PDF allows the box corners in either order.
  return [
    Math.min(nums[0], nums[2]),
    Math.min(nums[1], nums[3]),
    Math.max(nums[0], nums[2]),
    Math.max(nums[1], nums[3]),
  ];
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}
