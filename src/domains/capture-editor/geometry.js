// FORGE Capture editor — pure 2D geometry.
// The authoritative document coordinate system is source-image pixel space.
// Zoom/pan/display scaling live only in the viewport transform and must never
// leak into stored annotation geometry.

// ---------- rectangles ----------

export function normalizeRect({ x, y, w, h }) {
  const nx = w < 0 ? x + w : x;
  const ny = h < 0 ? y + h : y;
  return { x: nx, y: ny, w: Math.abs(w), h: Math.abs(h) };
}

export function rectCenter(rect) {
  const r = normalizeRect(rect);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

// Bounding rect for any annotation geometry shape.
export function geometryBounds(geometry) {
  if (geometry.points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of geometry.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return normalizeRect(geometry);
}

export function pointInRect(point, rect, tolerance = 0) {
  const r = normalizeRect(rect);
  return (
    point.x >= r.x - tolerance &&
    point.x <= r.x + r.w + tolerance &&
    point.y >= r.y - tolerance &&
    point.y <= r.y + r.h + tolerance
  );
}

export function pointInEllipse(point, rect) {
  const r = normalizeRect(rect);
  if (r.w === 0 || r.h === 0) return false;
  const c = rectCenter(r);
  const dx = (point.x - c.x) / (r.w / 2);
  const dy = (point.y - c.y) / (r.h / 2);
  return dx * dx + dy * dy <= 1;
}

// ---------- segments / polylines ----------

export function distToSegment(point, a, b) {
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(point.x - ax, point.y - ay);
  let t = ((point.x - ax) * dx + (point.y - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (ax + t * dx), point.y - (ay + t * dy));
}

export function distToPolyline(point, points) {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const d = distToSegment(point, points[i], points[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

// ---------- hit testing (image space) ----------

export function hitTest(annotation, point, { tolerance = 4 } = {}) {
  const { type, geometry, style } = annotation;
  const halfStroke = (style?.strokeWidth ?? 2) / 2;
  switch (type) {
    case "rectangle":
    case "text":
    case "callout":
    case "step-marker":
    case "blur":
    case "blackout":
      return pointInRect(point, geometry, tolerance);
    case "ellipse":
      return pointInEllipse(point, geometry);
    case "line":
    case "arrow":
      return distToSegment(point, geometry.points[0], geometry.points[1]) <= tolerance + halfStroke;
    case "freehand":
    case "highlight":
      return distToPolyline(point, geometry.points) <= tolerance + halfStroke;
    default:
      return false;
  }
}

// ---------- immutable geometry edits (image space) ----------

export function moveGeometry(geometry, dx, dy) {
  if (geometry.points) {
    return {
      ...geometry,
      points: geometry.points.map(([x, y]) => [x + dx, y + dy]),
    };
  }
  return { ...geometry, x: geometry.x + dx, y: geometry.y + dy };
}

// Resize a normalized rect by dragging one corner handle (image-space deltas).
export function resizeRect(rect, corner, dx, dy) {
  const r = normalizeRect(rect);
  const next = { ...r };
  if (corner.includes("e")) next.w = Math.max(1, r.w + dx);
  if (corner.includes("s")) next.h = Math.max(1, r.h + dy);
  if (corner.includes("w")) {
    const nx = Math.min(r.x + r.w - 1, r.x + dx);
    next.w = r.w + (r.x - nx);
    next.x = nx;
  }
  if (corner.includes("n")) {
    const ny = Math.min(r.y + r.h - 1, r.y + dy);
    next.h = r.h + (r.y - ny);
    next.y = ny;
  }
  return next;
}

// ---------- viewport: the ONLY place zoom/pan/display scaling may live ----------

export function createViewport({ zoom = 1, panX = 0, panY = 0 } = {}) {
  if (!(zoom > 0) || !Number.isFinite(zoom)) throw new Error("viewport zoom must be a positive finite number");
  if (!Number.isFinite(panX) || !Number.isFinite(panY)) {
    throw new Error("viewport panX/panY must be finite numbers");
  }
  return Object.freeze({ zoom, panX, panY });
}

export function imageToScreen(viewport, point) {
  return {
    x: point.x * viewport.zoom + viewport.panX,
    y: point.y * viewport.zoom + viewport.panY,
  };
}

export function screenToImage(viewport, point) {
  return {
    x: (point.x - viewport.panX) / viewport.zoom,
    y: (point.y - viewport.panY) / viewport.zoom,
  };
}

// Zoom keeping the image point under the given screen point stable.
export function zoomAt(viewport, screenPoint, newZoom) {
  const imagePoint = screenToImage(viewport, screenPoint);
  const zoom = Math.max(0.05, Math.min(32, newZoom));
  return createViewport({
    zoom,
    panX: screenPoint.x - imagePoint.x * zoom,
    panY: screenPoint.y - imagePoint.y * zoom,
  });
}

export function fitViewport(imageWidth, imageHeight, viewWidth, viewHeight, padding = 24) {
  const zoom = Math.max(
    0.05,
    Math.min((viewWidth - padding * 2) / imageWidth, (viewHeight - padding * 2) / imageHeight),
  );
  return createViewport({
    zoom,
    panX: (viewWidth - imageWidth * zoom) / 2,
    panY: (viewHeight - imageHeight * zoom) / 2,
  });
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
