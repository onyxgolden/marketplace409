// FORGE Capture editor — Canvas 2D renderer (framework-neutral).
// The host supplies the 2D context and a canvas factory; this module owns all
// drawing. All annotation geometry is interpreted in source-image pixel space.
//
// Rendering is two-pass: annotations composite onto a source-scale offscreen
// canvas first (so blur samples the true composited pixels beneath it in
// z-order), then the composition is drawn to the display context with the
// viewport transform applied.

import { normalizeRect, rectCenter } from "./geometry.js";

function applyStrokeStyle(ctx, style) {
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.strokeWidth;
  ctx.globalAlpha = style.opacity;
}

function strokeRectPath(ctx, rect) {
  const r = normalizeRect(rect);
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
}

function drawPolyline(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
}

function drawArrowHead(ctx, from, to, size) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const spread = Math.PI / 7;
  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - size * Math.cos(angle - spread), to[1] - size * Math.sin(angle - spread));
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - size * Math.cos(angle + spread), to[1] - size * Math.sin(angle + spread));
  ctx.stroke();
}

function drawMultilineText(ctx, text, x, y, lineHeight) {
  const lines = String(text).split("\n");
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
}

// Deterministic region blur without ctx.filter: downscale the composited
// region into a temp canvas, then draw it back up smoothed. The source pixels
// are destroyed in the output — the blur cannot be reversed.
function drawBlurredRegion(ctx, rect, radius, createCanvas) {
  const r = normalizeRect(rect);
  const scale = Math.max(2, Math.min(16, Math.round(radius / 2)));
  const tw = Math.max(1, Math.round(r.w / scale));
  const th = Math.max(1, Math.round(r.h / scale));
  const temp = createCanvas(tw, th);
  const tctx = temp.getContext("2d");
  tctx.drawImage(ctx.canvas, r.x, r.y, r.w, r.h, 0, 0, tw, th);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(temp, 0, 0, tw, th, r.x, r.y, r.w, r.h);
  ctx.restore();
}

export function drawAnnotation(ctx, annotation, { createCanvas } = {}) {
  const { type, geometry, style } = annotation;
  ctx.save();
  switch (type) {
    case "rectangle": {
      if (style.fill && style.fill !== "transparent") {
        ctx.globalAlpha = style.opacity;
        ctx.fillStyle = style.fill;
        strokeRectPath(ctx, geometry);
        ctx.fill();
      }
      applyStrokeStyle(ctx, style);
      strokeRectPath(ctx, geometry);
      ctx.stroke();
      break;
    }
    case "ellipse": {
      const r = normalizeRect(geometry);
      ctx.beginPath();
      ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      if (style.fill && style.fill !== "transparent") {
        ctx.globalAlpha = style.opacity;
        ctx.fillStyle = style.fill;
        ctx.fill();
      }
      applyStrokeStyle(ctx, style);
      ctx.stroke();
      break;
    }
    case "line": {
      applyStrokeStyle(ctx, style);
      ctx.lineCap = "round";
      drawPolyline(ctx, geometry.points);
      ctx.stroke();
      break;
    }
    case "arrow": {
      applyStrokeStyle(ctx, style);
      ctx.lineCap = "round";
      const [from, to] = geometry.points;
      drawPolyline(ctx, geometry.points);
      ctx.stroke();
      drawArrowHead(ctx, from, to, Math.max(10, style.strokeWidth * 4));
      break;
    }
    case "freehand": {
      applyStrokeStyle(ctx, style);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      drawPolyline(ctx, geometry.points);
      ctx.stroke();
      break;
    }
    case "highlight": {
      ctx.save();
      ctx.globalAlpha = 0.35 * style.opacity;
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = Math.max(8, style.strokeWidth * 5);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      drawPolyline(ctx, geometry.points);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case "text": {
      const r = normalizeRect(geometry);
      ctx.globalAlpha = style.opacity;
      ctx.fillStyle = style.stroke;
      ctx.font = `${style.fontSize}px ${style.fontFamily}`;
      ctx.textBaseline = "top";
      drawMultilineText(ctx, annotation.text ?? "", r.x + 4, r.y + 4, style.fontSize * 1.25);
      break;
    }
    case "callout": {
      const r = normalizeRect(geometry);
      if (style.fill && style.fill !== "transparent") {
        ctx.globalAlpha = style.opacity;
        ctx.fillStyle = style.fill;
        strokeRectPath(ctx, geometry);
        ctx.fill();
      }
      applyStrokeStyle(ctx, style);
      strokeRectPath(ctx, geometry);
      ctx.stroke();
      if (annotation.anchor) {
        const c = rectCenter(r);
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(annotation.anchor.x, annotation.anchor.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(annotation.anchor.x, annotation.anchor.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = style.stroke;
        ctx.fill();
      }
      ctx.globalAlpha = style.opacity;
      ctx.fillStyle = style.stroke;
      ctx.font = `${style.fontSize}px ${style.fontFamily}`;
      ctx.textBaseline = "top";
      drawMultilineText(ctx, annotation.text ?? "", r.x + 6, r.y + 6, style.fontSize * 1.25);
      break;
    }
    case "step-marker": {
      const r = normalizeRect(geometry);
      const c = rectCenter(r);
      const radius = Math.max(10, style.fontSize * 0.95);
      ctx.globalAlpha = style.opacity;
      ctx.beginPath();
      ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = style.stroke;
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${style.fontSize}px ${style.fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(annotation.stepNumber ?? ""), c.x, c.y + 1);
      break;
    }
    case "blur": {
      if (typeof createCanvas !== "function") throw new Error("drawAnnotation(blur) requires createCanvas");
      drawBlurredRegion(ctx, geometry, style.blurRadius ?? 12, createCanvas);
      break;
    }
    case "blackout": {
      const r = normalizeRect(geometry);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#000000";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

// Renders the full document. sourceImage is the decoded source bitmap (host
// provided). viewport is { zoom, panX, panY } in the geometry.js sense.
export function renderDocument(ctx, doc, { sourceImage, viewport, createCanvas }) {
  if (typeof createCanvas !== "function") throw new Error("renderDocument requires createCanvas");
  if (!sourceImage) throw new Error("renderDocument requires sourceImage");
  const { width, height } = doc.canvas;
  const comp = createCanvas(width, height);
  const cctx = comp.getContext("2d");
  if (!cctx) throw new Error("renderDocument: 2d context unavailable");
  cctx.drawImage(sourceImage, 0, 0, width, height);
  const ordered = [...doc.annotations].sort((a, b) => a.z - b.z);
  for (const annotation of ordered) drawAnnotation(cctx, annotation, { createCanvas });

  const vp = viewport ?? { zoom: 1, panX: 0, panY: 0 };
  ctx.save();
  ctx.setTransform(vp.zoom, 0, 0, vp.zoom, vp.panX, vp.panY);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(comp, 0, 0);
  ctx.restore();
  return comp;
}
