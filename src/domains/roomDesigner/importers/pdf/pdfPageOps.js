/**
 * pdf.js operator list → path geometry + page content census.
 *
 * This is the module that understands pdf.js's wire format, and it is
 * deliberately the ONLY one that does. It takes a plain
 * `{ fnArray, argsArray }` plus the `OPS` code table and returns plain data,
 * so every test in this slice runs on synthetic operator lists in Node
 * without loading pdf.js (whose browser build needs DOM globals).
 *
 * pdf.js path encoding (verified against pdfjs-dist 5.7, `DrawOPS`):
 *   OPS.constructPath args = [paintOp, buffers, minMax]
 *   each buffer is a flat Float32Array of commands:
 *     0 moveTo   x y          3 quadraticCurveTo x1 y1 x y
 *     1 lineTo   x y          4 closePath (no operands)
 *     2 curveTo  x1 y1 x2 y2 x y
 *   `re` (rectangle), `v` and `y` (shorthand curves) are already normalized
 *   by pdf.js into these five commands, so nothing else needs handling.
 *   Several subpaths share one buffer and are split at each moveTo.
 *
 * Coordinates arrive in the CURRENT user space, NOT page space: the caller's
 * matrix must be applied afterwards. This walker therefore tracks the
 * graphics state exactly as pdf.js's own canvas backend does —
 * save/restore/transform, plus paintFormXObjectBegin/End, which pdf.js
 * implements as an implicit save + transform / restore pair.
 *
 * Nothing here decides what geometry MEANS; that is pdfClassifier.js.
 */

import { IDENTITY_MATRIX, isFiniteMatrix, multiplyMatrix } from "./pdfGeometry";

/** DrawOPS opcodes inside a constructPath buffer. */
export const DRAW_OPS = Object.freeze({
  moveTo: 0,
  lineTo: 1,
  curveTo: 2,
  quadraticCurveTo: 3,
  closePath: 4,
});

/** Operand counts per opcode; the walker refuses a truncated buffer. */
const DRAW_OP_OPERANDS = Object.freeze({ 0: 2, 1: 2, 2: 6, 3: 4, 4: 0 });

/** Hard cap on paths collected from one page before refusing. */
export const MAX_PATHS_PER_PAGE = 60000;

/**
 * Split one constructPath buffer into subpaths.
 * Returns [{ ops: [...], closed }]; `ops` use the same shape the VSDX
 * importer's geometry stage produces, so flattening is shared in spirit.
 */
export function decodePathBuffer(buffer) {
  const data = buffer || [];
  const subpaths = [];
  let current = null;

  const startSubpath = () => {
    current = { ops: [], closed: false };
    subpaths.push(current);
    return current;
  };

  let i = 0;
  while (i < data.length) {
    const opcode = data[i];
    const operands = DRAW_OP_OPERANDS[opcode];
    if (operands === undefined) {
      // Unknown opcode: the rest of the buffer can no longer be aligned, so
      // stop rather than emit misaligned coordinates as geometry.
      return { subpaths, truncated: true, unknownOpcode: opcode };
    }
    // Operands sit at i+1 … i+operands, so the last one must be in range.
    if (i + operands > data.length - 1) {
      return { subpaths, truncated: true, unknownOpcode: null };
    }
    i += 1;
    if (opcode === DRAW_OPS.moveTo) {
      startSubpath().ops.push({ op: "move", x: data[i], y: data[i + 1] });
      i += 2;
    } else if (opcode === DRAW_OPS.lineTo) {
      if (!current) startSubpath();
      current.ops.push({ op: "line", x: data[i], y: data[i + 1] });
      i += 2;
    } else if (opcode === DRAW_OPS.curveTo) {
      if (!current) startSubpath();
      current.ops.push({
        op: "cubic",
        x1: data[i], y1: data[i + 1],
        x2: data[i + 2], y2: data[i + 3],
        x: data[i + 4], y: data[i + 5],
      });
      i += 6;
    } else if (opcode === DRAW_OPS.quadraticCurveTo) {
      if (!current) startSubpath();
      current.ops.push({
        op: "quadratic",
        x1: data[i], y1: data[i + 1],
        x: data[i + 2], y: data[i + 3],
      });
      i += 4;
    } else if (opcode === DRAW_OPS.closePath) {
      if (current) current.closed = true;
      // A closePath ends the subpath: anything after it starts a new one
      // (PDF's `h` leaves the cursor at the subpath start, but pdf.js always
      // emits an explicit moveTo before drawing again).
      current = null;
    }
  }
  return { subpaths: subpaths.filter((sp) => sp.ops.length > 0), truncated: false, unknownOpcode: null };
}

/** Does this paint operator stroke / fill? Mirrors the PDF painting ops. */
export function paintKind(paintOp, ops) {
  const strokes = new Set([ops.stroke, ops.closeStroke, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke]);
  const fills = new Set([ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke]);
  return { stroked: strokes.has(paintOp), filled: fills.has(paintOp) };
}

function cloneState(state) {
  return {
    matrix: state.matrix,
    lineWidth: state.lineWidth,
    dashed: state.dashed,
  };
}

/**
 * Walk a page's operator list.
 *
 * `ops` is pdf.js's OPS table (injected so tests need no pdf.js import).
 * `baseMatrix` maps PDF user space to the space the caller wants geometry in
 * — pass the identity to stay in PDF points.
 *
 * Returns:
 *   paths   [{ subpaths, matrix, lineWidthPt, dashed, stroked, filled }]
 *   census  { pathCount, strokedPathCount, imageCount, textRunCount,
 *             unknownDrawOpcodes, truncatedBuffers }
 * Never throws on malformed operands: bad operators are counted and skipped,
 * which keeps a partly-corrupt PDF importable.
 */
export function collectPageGeometry(operatorList, ops, { baseMatrix = IDENTITY_MATRIX, onWarning } = {}) {
  const fnArray = (operatorList && operatorList.fnArray) || [];
  const argsArray = (operatorList && operatorList.argsArray) || [];
  const warn = (message) => {
    if (typeof onWarning === "function") onWarning(message);
  };

  const paths = [];
  const census = {
    pathCount: 0,
    strokedPathCount: 0,
    segmentCount: 0,
    imageCount: 0,
    textRunCount: 0,
    unknownDrawOpcodes: 0,
    truncatedBuffers: 0,
    cappedPaths: false,
  };

  let state = { matrix: baseMatrix, lineWidth: 1, dashed: false };
  const stack = [];

  const imageOps = new Set(
    [ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintJpegXObject,
      ops.paintImageMaskXObject, ops.paintImageXObjectRepeat].filter((v) => v !== undefined),
  );

  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i];
    const args = argsArray[i];

    if (fn === ops.save) {
      stack.push(cloneState(state));
      continue;
    }
    if (fn === ops.restore) {
      const popped = stack.pop();
      if (popped) state = popped;
      continue;
    }
    if (fn === ops.transform) {
      const m = Array.from(args || []);
      if (isFiniteMatrix(m)) {
        state = { ...state, matrix: multiplyMatrix(m, state.matrix) };
      } else {
        warn("A coordinate transform had non-finite values and was ignored — some geometry may be misplaced.");
      }
      continue;
    }
    if (fn === ops.paintFormXObjectBegin) {
      // pdf.js implements this as save + transform(matrix).
      stack.push(cloneState(state));
      const m = args && args[0] ? Array.from(args[0]) : null;
      if (m && isFiniteMatrix(m)) state = { ...state, matrix: multiplyMatrix(m, state.matrix) };
      continue;
    }
    if (fn === ops.paintFormXObjectEnd) {
      const popped = stack.pop();
      if (popped) state = popped;
      continue;
    }
    if (fn === ops.setLineWidth) {
      const width = args && Number(args[0]);
      if (Number.isFinite(width) && width >= 0) state = { ...state, lineWidth: width };
      continue;
    }
    if (fn === ops.setDash) {
      const pattern = args && args[0];
      state = { ...state, dashed: Array.isArray(pattern) ? pattern.some((v) => Number(v) > 0) : false };
      continue;
    }
    if (imageOps.has(fn)) {
      census.imageCount += 1;
      continue;
    }
    if (fn === ops.showText || fn === ops.showSpacedText) {
      census.textRunCount += 1;
      continue;
    }
    if (fn !== ops.constructPath) continue;

    // ---- constructPath: [paintOp, buffers, minMax] ----
    const paintOp = args && args[0];
    const buffers = args && args[1];
    const { stroked, filled } = paintKind(paintOp, ops);
    // A clip-only path (endPath as the paint op) contributes no visible
    // geometry and must not become a wall.
    if (!stroked && !filled) continue;

    const bufferList = normalizeBuffers(buffers);
    const subpaths = [];
    for (const buffer of bufferList) {
      const decoded = decodePathBuffer(buffer);
      if (decoded.truncated) {
        census.truncatedBuffers += 1;
        if (decoded.unknownOpcode !== null) census.unknownDrawOpcodes += 1;
      }
      subpaths.push(...decoded.subpaths);
    }
    if (subpaths.length === 0) continue;

    if (paths.length >= MAX_PATHS_PER_PAGE) {
      census.cappedPaths = true;
      continue;
    }

    census.pathCount += 1;
    if (stroked) census.strokedPathCount += 1;
    // Segments, not paths, are the honest measure of how much drawing is on a
    // page: one polyline can carry a whole floor plan, and a scan's incidental
    // border is several paths but only a few segments.
    for (const subpath of subpaths) {
      const drawing = subpath.ops.filter((op) => op.op !== "move").length;
      census.segmentCount += drawing + (subpath.closed && drawing > 1 ? 1 : 0);
    }
    paths.push({
      subpaths,
      matrix: state.matrix,
      lineWidthPt: state.lineWidth,
      dashed: state.dashed,
      stroked,
      filled,
    });
  }

  if (census.truncatedBuffers > 0) {
    warn(
      `${census.truncatedBuffers} path buffer(s) were malformed and were read only up to the damaged command.`,
    );
  }
  if (census.cappedPaths) {
    warn(`This page has more than ${MAX_PATHS_PER_PAGE} paths — the remainder was ignored.`);
  }

  return { paths, census };
}

/**
 * pdf.js passes path commands as an array of typed arrays. Older/newer
 * builds have also passed a single flat buffer, so both are accepted.
 */
function normalizeBuffers(buffers) {
  if (!buffers) return [];
  if (ArrayBuffer.isView(buffers)) return [buffers];
  if (!Array.isArray(buffers)) return [];
  if (buffers.length === 0) return [];
  const first = buffers[0];
  if (typeof first === "number") return [buffers];
  return buffers.filter((b) => b && (ArrayBuffer.isView(b) || Array.isArray(b)));
}
