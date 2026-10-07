// FORGE Capture — annotation renderer (ui/annotations-render.js).
//
// Framework-neutral: `resolveDrawOps` and `drawOpsToCanvas` are pure/DOM-free
// and run unmodified under vitest (node), same convention as ui/ai-edit.js.
// Only `flattenAnnotations` touches a real canvas, and even that takes its
// canvas/image via dependency injection so a test can supply a mock.
//
// Contract boundary (per the approved plan, forge-ai-drop's
// commands/chatgpt/forge-capture-annotation-plan-rereview.md): this module
// NEVER parses or validates a sidecar on its own. Every function here takes
// an already-validated sidecar object exactly as returned by the Tauri
// `load_annotations` command (which goes through
// forge_capture_core::annotations::parse_sidecar — the one authoritative
// contract). If a caller hands this module a sidecar it didn't get from that
// command, that caller has already broken the contract; this module does
// not re-check geometry/schema shape, the same way a renderer never
// re-validates a trusted DTO from its own backend.
//
// Geometry throughout is in source-image pixel coordinates (the sidecar's
// own `canvas` size) — the same space core/src/annotations.rs documents.
// Callers draw onto a canvas sized to that same `w`/`h`; any CSS/zoom
// scaling happens in the caller's own canvas transform, never here.

/** Minimum arrowhead length in px, so a very thin stroke still has a visible head. */
const MIN_ARROWHEAD_LEN = 10;
const ARROWHEAD_ANGLE_RAD = (25 * Math.PI) / 180;

function arrowheadPoints(from, to, strokeWidth) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const headLen = Math.max(MIN_ARROWHEAD_LEN, strokeWidth * 4);
  const back = (ux_, uy_, angle) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Rotate the reverse direction by +/-angle, then step back headLen from `to`.
    const rx = -ux_ * cos - -uy_ * sin;
    const ry = -ux_ * sin + -uy_ * cos;
    return { x: to.x + rx * headLen, y: to.y + ry * headLen };
  };
  return [back(ux, uy, ARROWHEAD_ANGLE_RAD), back(ux, uy, -ARROWHEAD_ANGLE_RAD)];
}

/**
 * Turns a validated annotation sidecar into an ordered list of draw
 * operations — plain data, no canvas calls. Pure: same sidecar in, same ops
 * out, every time.
 *
 * Callout numbering mirrors `AnnotationsSidecar::callout_numbers` in
 * core/src/annotations.rs: 1..N in array order among callout-kind items,
 * computed here (never read from a stored field — none exists).
 *
 * @param {object} sidecar - as returned by the `load_annotations` Tauri command
 * @returns {Array<object>} ordered draw ops
 */
export function resolveDrawOps(sidecar) {
  const ops = [];
  let calloutNumber = 0;
  for (const item of sidecar.items) {
    const body = item;
    switch (body.kind) {
      case "rect":
        ops.push({
          op: "rect",
          id: item.id,
          x: body.geometry.x,
          y: body.geometry.y,
          w: body.geometry.w,
          h: body.geometry.h,
          color: body.color,
          strokeWidth: body.strokeWidth,
        });
        break;
      case "highlight":
        ops.push({
          op: "fillRect",
          id: item.id,
          x: body.geometry.x,
          y: body.geometry.y,
          w: body.geometry.w,
          h: body.geometry.h,
          color: body.color,
        });
        break;
      case "line":
        ops.push({
          op: "line",
          id: item.id,
          x1: body.from.x,
          y1: body.from.y,
          x2: body.to.x,
          y2: body.to.y,
          color: body.color,
          strokeWidth: body.strokeWidth,
        });
        break;
      case "arrow": {
        const [h1, h2] = arrowheadPoints(body.from, body.to, body.strokeWidth);
        ops.push({
          op: "line",
          id: item.id,
          x1: body.from.x,
          y1: body.from.y,
          x2: body.to.x,
          y2: body.to.y,
          color: body.color,
          strokeWidth: body.strokeWidth,
        });
        ops.push({
          op: "filledTriangle",
          id: item.id,
          points: [body.to, h1, h2],
          color: body.color,
        });
        break;
      }
      case "text":
        ops.push({
          op: "text",
          id: item.id,
          x: body.anchor.x,
          y: body.anchor.y,
          maxWidth: body.maxWidth,
          color: body.color,
          text: body.text,
        });
        break;
      case "blur":
        ops.push({
          op: "blurRect",
          id: item.id,
          x: body.geometry.x,
          y: body.geometry.y,
          w: body.geometry.w,
          h: body.geometry.h,
        });
        break;
      case "callout":
        calloutNumber += 1;
        ops.push({
          op: "callout",
          id: item.id,
          x: body.anchor.x,
          y: body.anchor.y,
          color: body.color,
          number: calloutNumber,
        });
        break;
      default:
        // An item kind this version of the renderer does not know about.
        // Fails closed by skipping it rather than guessing how to draw it
        // (the sidecar's own schemaVersion gate in Rust is what actually
        // keeps an unknown shape out in the first place; this is defense
        // in depth, not the enforcement point).
        break;
    }
  }
  return ops;
}

/** 0-255 channel Rgba -> a CSS rgba() string. */
function cssColor(color) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;
}

/**
 * Applies `ops` (from `resolveDrawOps`) to a 2D canvas context, in order.
 * `ctx` only needs to implement the small subset of CanvasRenderingContext2D
 * used below, so a test can pass a recording mock instead of a real canvas.
 * Blur is a declared region only here (`blurRect`); the actual pixel blur
 * is applied via `ctx.filter` by the caller's own compositing pass, since a
 * mock ctx cannot meaningfully verify a real blur result.
 */
export function drawOpsToCanvas(ctx, ops) {
  for (const op of ops) {
    switch (op.op) {
      case "rect":
        ctx.strokeStyle = cssColor(op.color);
        ctx.lineWidth = op.strokeWidth;
        ctx.strokeRect(op.x, op.y, op.w, op.h);
        break;
      case "fillRect":
        ctx.fillStyle = cssColor(op.color);
        ctx.fillRect(op.x, op.y, op.w, op.h);
        break;
      case "line":
        ctx.strokeStyle = cssColor(op.color);
        ctx.lineWidth = op.strokeWidth;
        ctx.beginPath();
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.stroke();
        break;
      case "filledTriangle":
        ctx.fillStyle = cssColor(op.color);
        ctx.beginPath();
        ctx.moveTo(op.points[0].x, op.points[0].y);
        ctx.lineTo(op.points[1].x, op.points[1].y);
        ctx.lineTo(op.points[2].x, op.points[2].y);
        ctx.closePath();
        ctx.fill();
        break;
      case "text":
        ctx.fillStyle = cssColor(op.color);
        if (typeof ctx.fillText === "function") {
          if (op.maxWidth && ctx.fillText.length >= 4) {
            ctx.fillText(op.text, op.x, op.y, op.maxWidth);
          } else {
            ctx.fillText(op.text, op.x, op.y);
          }
        }
        break;
      case "blurRect":
        if (typeof ctx.blurRegion === "function") {
          ctx.blurRegion(op.x, op.y, op.w, op.h);
        }
        break;
      case "callout":
        ctx.fillStyle = cssColor(op.color);
        ctx.beginPath();
        ctx.arc(op.x, op.y, Math.max(10, (op.number.toString().length + 1) * 6), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        if (typeof ctx.fillText === "function") {
          ctx.fillText(String(op.number), op.x, op.y);
        }
        break;
      default:
        break;
    }
  }
}

/**
 * The flatten/export primitive: composites `sourceImage` plus the sidecar's
 * annotations onto a freshly created canvas and returns it. Never mutates
 * `sourceImage`. `deps.createCanvas(w, h)` and `deps.getContext2d(canvas)`
 * are injected so this can be unit-tested with fakes; production code
 * passes real `document.createElement("canvas")` / `canvas.getContext("2d")`.
 *
 * @param {object} args
 * @param {object} args.sidecar - validated sidecar (see module doc)
 * @param {*} args.sourceImage - drawable image (ImageBitmap/HTMLImageElement/etc.)
 * @param {object} deps
 * @param {(w: number, h: number) => *} deps.createCanvas
 * @param {(canvas: *) => *} deps.getContext2d
 * @returns {*} the flattened canvas
 */
export function flattenAnnotations({ sidecar, sourceImage }, { createCanvas, getContext2d }) {
  const canvas = createCanvas(sidecar.canvas.w, sidecar.canvas.h);
  const ctx = getContext2d(canvas);
  ctx.drawImage(sourceImage, 0, 0, sidecar.canvas.w, sidecar.canvas.h);
  drawOpsToCanvas(ctx, resolveDrawOps(sidecar));
  return canvas;
}
