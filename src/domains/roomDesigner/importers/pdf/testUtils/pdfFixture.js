/**
 * Test fixtures for the PDF importer.
 *
 * The importer's pure modules take pdf.js's operator-list shape as plain data,
 * so tests build operator lists by hand instead of shipping binary PDFs. The
 * OPS values below are copied verbatim from pdfjs-dist 5.7 — if a pdf.js
 * upgrade renumbers them, `opsMatchPdfjs` in the contract test is the canary.
 */

/** pdf.js OPS codes this importer reacts to (pdfjs-dist 5.7). */
export const OPS = Object.freeze({
  setLineWidth: 2,
  setDash: 6,
  save: 10,
  restore: 11,
  transform: 12,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  endPath: 28,
  clip: 29,
  eoClip: 30,
  beginText: 31,
  endText: 32,
  showText: 44,
  showSpacedText: 45,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  paintImageMaskXObject: 83,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintImageXObjectRepeat: 88,
  constructPath: 91,
});

/** DrawOPS opcodes inside a constructPath buffer. */
export const D = Object.freeze({ move: 0, line: 1, cubic: 2, quad: 3, close: 4 });

/** Build an operator list from [opCode, args] pairs. */
export function operatorList(entries) {
  return {
    fnArray: entries.map((e) => e[0]),
    argsArray: entries.map((e) => (e.length > 1 ? e[1] : null)),
  };
}

/**
 * A constructPath entry. `commands` is the flat DrawOPS buffer; it is wrapped
 * in a Float32Array inside an array, exactly as pdf.js delivers it.
 */
export function constructPath(commands, paintOp = OPS.stroke) {
  const buffer = new Float32Array(commands);
  return [OPS.constructPath, [paintOp, [buffer], new Float32Array([0, 0, 0, 0])]];
}

/** A stroked open polyline through the given [x, y] pairs. */
export function strokedPolyline(points, paintOp = OPS.stroke) {
  const commands = [];
  points.forEach(([x, y], i) => {
    commands.push(i === 0 ? D.move : D.line, x, y);
  });
  return constructPath(commands, paintOp);
}

/** A stroked closed rectangle, as pdf.js normalizes `re`. */
export function strokedRect(x, y, w, h, paintOp = OPS.stroke) {
  return constructPath(
    [D.move, x, y, D.line, x + w, y, D.line, x + w, y + h, D.line, x, y + h, D.close],
    paintOp,
  );
}

/** US Letter page facts, as pdf.js exposes them on a page proxy. */
export const LETTER_PAGE = Object.freeze({ viewBox: [0, 0, 612, 792], rotation: 0, userUnit: 1 });

/** 36×24 inch ARCH-D sheet, landscape. */
export const ARCH_D_PAGE = Object.freeze({ viewBox: [0, 0, 2592, 1728], rotation: 0, userUnit: 1 });

/**
 * Minimal pdf.js stand-in: a document of pages built from operator lists.
 * `pages` is [{ facts, entries, imageCount }].
 */
export function fakePdfjs(pages, { opsTable = OPS } = {}) {
  const makePage = (spec, n) => ({
    view: (spec.facts || LETTER_PAGE).viewBox,
    rotate: (spec.facts || LETTER_PAGE).rotation,
    userUnit: (spec.facts || LETTER_PAGE).userUnit,
    pageNumber: n,
    getOperatorList: async () => {
      if (spec.operatorListError) throw new Error(spec.operatorListError);
      return operatorList(spec.entries || []);
    },
    getViewport: ({ scale }) => {
      const box = (spec.facts || LETTER_PAGE).viewBox;
      return { scale, width: (box[2] - box[0]) * scale, height: (box[3] - box[1]) * scale };
    },
    render: () => ({ promise: Promise.resolve() }),
    cleanup: () => {},
  });

  return {
    OPS: opsTable,
    GlobalWorkerOptions: { workerSrc: "stub" },
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: pages.length,
        getPage: async (n) => makePage(pages[n - 1], n),
      }),
    }),
  };
}

/** A canvas stand-in for rasterization tests: records size, returns a PNG URL. */
export function fakeCanvasFactory(record = {}) {
  return (width, height) => {
    record.width = width;
    record.height = height;
    return {
      width,
      height,
      getContext: () => ({
        fillStyle: null,
        fillRect: (x, y, w, h) => {
          record.filled = { x, y, w, h };
        },
      }),
      toDataURL: () => "data:image/png;base64,iVBORw0KGgo=",
    };
  };
}
