/**
 * PDF import orchestrator: the staged pipeline the UI drives.
 *
 *   listPdfPages(bytes)                  → page survey for the picker
 *   preparePdfImport(bytes, options)     → previewable result (no mutation)
 *   applyVectorScale(prepared, options)  → re-scale a preview, pure, no re-parse
 *   commitPdfImport(design, prepared)    → new design with the import merged
 *
 * Stages (surfaced as progress phases, never fake percentages):
 *   opening → surveying → reading-geometry → converting → scaling →
 *   preparing   (vector)
 *   opening → surveying → rendering → preparing   (scanned)
 *
 * Atomicity, mirroring the VSDX importer: prepare builds the COMPLETE result
 * first and commit is one pure merge, so a failed prepare leaves the caller's
 * design untouched.
 *
 * pdf.js is imported dynamically and is the ONLY dependency here that needs a
 * browser: everything else in this folder is plain-number code that runs in
 * Node, which is what keeps the conversion unit-testable. All processing is
 * browser-local — no upload, no network, no service.
 */

import { applyImportResult } from "../vsdx/visioMapper";
import { setUnderlay } from "../../designerDocument";
import { checkPdfFileSupported, PdfImportError, pageProvenance } from "./pdfErrors";
import { designerBounds, designerPageSize, pageToDesignerMatrix } from "./pdfCoordinates";
import { flattenSubpath, matrixScale, simplifyPolyline } from "./pdfGeometry";
import { collectPageGeometry } from "./pdfPageOps";
import { classifyPageKind, classifyPath, CLASSIFIER_DEFAULTS } from "./pdfClassifier";
import { buildPdfRecords } from "./pdfMapper";
import {
  applyScaleToPolylines,
  assertUsableFactor,
  describeScale,
  longestStraightRun,
  UNCALIBRATED_FACTOR,
} from "./pdfScale";
import { DEFAULT_RENDER_DPI, rasterizePdfPage } from "./pdfRaster";

export const IMPORT_PHASES = Object.freeze([
  "opening",
  "surveying",
  "reading-geometry",
  "converting",
  "scaling",
  "rendering",
  "preparing",
]);

/** Pages surveyed for the picker before the survey gives up and reports counts only. */
export const MAX_SURVEYED_PAGES = 100;

/**
 * Simplification tolerance as a fraction of the length floor: collinear runs
 * inside a flattened curve collapse, real corners survive.
 */
const SIMPLIFY_FRACTION = 0.25;

let pdfjsPromise = null;

/**
 * Load pdf.js once per session and point it at its worker.
 *
 * The worker URL is resolved through `import.meta.url` so the bundler emits
 * the worker as an asset — no public/ copy to keep in sync, no CDN (which
 * would break the "nothing leaves the browser" guarantee).
 */
export async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
      }
      return pdfjs;
    })().catch((error) => {
      pdfjsPromise = null;
      throw error;
    });
  }
  return pdfjsPromise;
}

/** Test seam: inject a pdf.js stand-in (and reset with null). */
export function __setPdfjsForTests(stub) {
  pdfjsPromise = stub ? Promise.resolve(stub) : null;
}

async function toBytes(input) {
  if (!input) throw new PdfImportError("Import needs the PDF file bytes.", { code: "no-input" });
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    const check = checkPdfFileSupported({ name: input.name || "", type: input.type || "" });
    if (!check.ok) throw new PdfImportError(check.message, { code: check.code });
    return new Uint8Array(await input.arrayBuffer());
  }
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new PdfImportError("Import needs the PDF file bytes.", { code: "no-input" });
}

async function openDocument(bytes) {
  const pdfjs = await loadPdfjs();
  try {
    // pdf.js TRANSFERS the buffer it is given to its worker, which detaches
    // it: the caller's bytes would come back zero-length and every later
    // parse of the same array would fail with "Cannot transfer object of
    // unsupported type". Hand it a copy so surveying a PDF and then importing
    // a page from the same bytes works, whatever the caller passed.
    //
    // isEvalSupported:false keeps pdf.js from compiling font programs with
    // eval, which the app's CSP would refuse anyway.
    return await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
  } catch (error) {
    const message = String((error && error.message) || error);
    if (/password/i.test(message)) {
      throw new PdfImportError("This PDF is password-protected — open it and re-save it without a password first.", {
        code: "password-protected",
      });
    }
    throw new PdfImportError(`This file could not be read as a PDF: ${message}`, { code: "unreadable" });
  }
}

/** pdf.js page proxy → the page facts the rest of the pipeline needs. */
function pageFacts(page) {
  return { viewBox: page.view, rotation: page.rotate, userUnit: page.userUnit };
}

/**
 * Survey every page for the picker: size, and whether it is vector, scanned
 * (raster), both, or empty. The survey reads operator lists, which is the only
 * way to know — a "scanned" PDF and a vector PDF are indistinguishable from
 * metadata alone.
 */
export async function listPdfPages(input, { onPhase } = {}) {
  const phase = (p) => { if (typeof onPhase === "function") onPhase(p); };
  phase("opening");
  const bytes = await toBytes(input);
  const doc = await openDocument(bytes);
  const pdfjs = await loadPdfjs();

  phase("surveying");
  const pageCount = doc.numPages;
  const surveyed = Math.min(pageCount, MAX_SURVEYED_PAGES);
  const pages = [];
  for (let n = 1; n <= surveyed; n += 1) {
    const page = await doc.getPage(n);
    const facts = pageFacts(page);
    const size = designerPageSize(facts);
    let census = { pathCount: 0, imageCount: 0, textRunCount: 0 };
    let surveyError = null;
    try {
      const operatorList = await page.getOperatorList();
      census = collectPageGeometry(operatorList, pdfjs.OPS).census;
    } catch (error) {
      surveyError = String((error && error.message) || error);
    }
    const kind = classifyPageKind(census);
    pages.push({
      pageNumber: n,
      index: n - 1,
      widthIn: size.widthIn,
      heightIn: size.heightIn,
      rotation: facts.rotation || 0,
      pathCount: census.pathCount,
      segmentCount: census.segmentCount,
      imageCount: census.imageCount,
      textRunCount: census.textRunCount,
      kind: surveyError ? "unknown" : kind.kind,
      kindReason: surveyError ? `This page could not be surveyed: ${surveyError}` : kind.reason,
    });
    page.cleanup();
  }
  return { pageCount, surveyedCount: surveyed, pages };
}

/**
 * Convert a page's vector geometry to paper-true Designer polylines.
 * Paper-true means one plan inch per paper inch; scaling happens afterwards
 * so the user can change the plot scale without re-parsing.
 */
async function readVectorGeometry(page, pdfjs, { onWarning }) {
  const facts = pageFacts(page);
  const matrix = pageToDesignerMatrix(facts);
  const operatorList = await page.getOperatorList();
  const { paths, census } = collectPageGeometry(operatorList, pdfjs.OPS, { onWarning });

  // Flatten in page space with the matrix applied, so the tolerance is
  // measured where the geometry actually lands (see pdfGeometry).
  const paperPaths = [];
  for (const path of paths) {
    const polylines = [];
    for (const subpath of path.subpaths) {
      const flat = flattenSubpath(subpath, matrix, { onWarning });
      if (flat) polylines.push(flat);
    }
    if (polylines.length === 0) continue;
    paperPaths.push({
      polylines,
      dashed: path.dashed,
      stroked: path.stroked,
      filled: path.filled,
      // Stroke width crosses into Designer inches through the same matrix
      // scale as the geometry, so it stays meaningful after rotation.
      lineWidthIn: path.lineWidthPt * matrixScale(matrix),
    });
  }
  return { paperPaths, census, pageSizeIn: designerPageSize(facts) };
}

/**
 * Derive records from paper-true paths at a given scale. PURE — this is what
 * the calibration UI re-runs as the user changes the scale, with no re-parse.
 */
export function applyVectorScale(prepared, options = {}) {
  if (!prepared || prepared.mode !== "vector") {
    throw new PdfImportError("Only a vector import can be re-scaled.", { code: "wrong-mode" });
  }
  const scaleFactor = assertUsableFactor(
    options.scaleFactor === undefined ? prepared.scale.factor : Number(options.scaleFactor),
  );
  const minSegmentIn = options.minSegmentIn === undefined
    ? prepared.options.minSegmentIn
    : Number(options.minSegmentIn);
  const includeDashed = options.includeDashed === undefined
    ? prepared.options.includeDashed
    : !!options.includeDashed;

  // Scale about the paper-true bounds' top-left so the drawing grows into the
  // canvas from its own corner rather than sliding away from the origin.
  const anchor = prepared.paperBounds
    ? { x: prepared.paperBounds.minX, y: prepared.paperBounds.minY }
    : { x: 0, y: 0 };
  const simplifyTolerance = Math.max(minSegmentIn, 0) * SIMPLIFY_FRACTION;

  const items = prepared.paperPaths.map((path, index) => {
    const scaled = applyScaleToPolylines(path.polylines, scaleFactor, anchor).map((line) => ({
      ...line,
      points: simplifyTolerance > 0 ? simplifyPolyline(line.points, simplifyTolerance) : line.points,
    }));
    const scaledPath = {
      ...path,
      polylines: scaled,
      lineWidthIn: path.lineWidthIn * scaleFactor,
    };
    return {
      index,
      path: scaledPath,
      classification: classifyPath(scaledPath, { minSegmentIn, includeDashed }),
    };
  });

  const { records, notes, counts } = buildPdfRecords(items, {
    importId: prepared.importId,
    pageNumber: prepared.pageNumber,
    scaleFactor,
  });

  const wallPolylines = records.walls.map((w) => [w.a, w.b]);
  return {
    ...prepared,
    scale: { factor: scaleFactor, label: describeScale(scaleFactor) },
    options: { ...prepared.options, minSegmentIn, includeDashed },
    records,
    counts,
    bounds: designerBounds(wallPolylines),
    issues: [...prepared.parseIssues, ...notes],
  };
}

/**
 * Full prepare pipeline. Returns a staged import the UI previews and the user
 * explicitly commits. Never mutates any design.
 *
 * mode: "vector" | "raster" | "auto" (auto follows the page survey).
 */
export async function preparePdfImport(input, {
  pageNumber = 1,
  mode = "auto",
  scaleFactor = UNCALIBRATED_FACTOR,
  minSegmentIn = CLASSIFIER_DEFAULTS.minSegmentIn,
  includeDashed = CLASSIFIER_DEFAULTS.includeDashed,
  dpi = DEFAULT_RENDER_DPI,
  fileName = "pdf page",
  onPhase,
  // Test seam: rasterization normally allocates a DOM canvas.
  createCanvas,
} = {}) {
  const phase = (p) => { if (typeof onPhase === "function") onPhase(p); };
  const parseIssues = [];
  const warn = (message) => parseIssues.push({ provenance: pageProvenance(pageNumber), message });

  phase("opening");
  const bytes = await toBytes(input);
  const doc = await openDocument(bytes);
  const pdfjs = await loadPdfjs();

  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) {
    throw new PdfImportError(
      `Page ${pageNumber} is out of range (this PDF has ${doc.numPages} page${doc.numPages === 1 ? "" : "s"}).`,
      { code: "page-out-of-range" },
    );
  }

  phase("surveying");
  const page = await doc.getPage(pageNumber);
  const facts = pageFacts(page);
  const pageSizeIn = designerPageSize(facts);

  let census = { pathCount: 0, imageCount: 0, textRunCount: 0 };
  try {
    census = collectPageGeometry(await page.getOperatorList(), pdfjs.OPS).census;
  } catch (error) {
    warn(`This page's content stream could not be fully read: ${String((error && error.message) || error)}`);
  }
  const pageKind = classifyPageKind(census);

  const resolvedMode = mode === "auto"
    ? (pageKind.kind === "raster" ? "raster" : "vector")
    : mode;

  const common = {
    importId: `p${pageNumber}-${Date.now().toString(36)}`,
    pageNumber,
    pageCount: doc.numPages,
    pageSizeIn,
    rotation: facts.rotation || 0,
    pageKind,
    census,
    fileName,
    parseIssues,
  };

  if (resolvedMode === "raster") {
    phase("rendering");
    const { image, plan } = await rasterizePdfPage(page, {
      dpi,
      scaleFactor,
      name: `${fileName} — page ${pageNumber}`,
      createCanvas,
    });
    if (plan.downgraded) {
      warn(
        `Rendered at ${plan.dpi} DPI instead of ${plan.requestedDpi} — a ${plan.pageWidthIn}×${plan.pageHeightIn}″ page at the requested resolution exceeds the image budget.`,
      );
    }
    phase("preparing");
    return {
      ...common,
      mode: "raster",
      image,
      plan,
      scale: { factor: scaleFactor, label: describeScale(scaleFactor) },
      options: { dpi, minSegmentIn, includeDashed },
      issues: parseIssues,
    };
  }

  phase("reading-geometry");
  const { paperPaths } = await readVectorGeometry(page, pdfjs, { onWarning: warn });

  phase("converting");
  const paperBounds = designerBounds(paperPaths.flatMap((p) => p.polylines));
  if (paperPaths.length === 0) {
    warn("No vector paths were found on this page — if it is a scan, import it as an image underlay instead.");
  }

  phase("scaling");
  const prepared = applyVectorScale(
    {
      ...common,
      mode: "vector",
      paperPaths,
      paperBounds,
      longestRun: longestStraightRun(paperPaths.flatMap((p) => p.polylines)),
      scale: { factor: scaleFactor, label: describeScale(scaleFactor) },
      options: { minSegmentIn, includeDashed, dpi },
    },
    { scaleFactor, minSegmentIn, includeDashed },
  );

  phase("preparing");
  page.cleanup();
  return prepared;
}

/**
 * Pure single-step merge of a prepared import into a design.
 * Vector → walls appended atomically. Scanned → underlay replaced.
 */
export function commitPdfImport(design, prepared) {
  if (!prepared) throw new PdfImportError("Nothing prepared to commit.", { code: "nothing-prepared" });
  if (prepared.mode === "raster") {
    return setUnderlay(design, prepared.image);
  }
  if (prepared.mode === "vector") {
    if (!prepared.records) throw new PdfImportError("Nothing prepared to commit.", { code: "nothing-prepared" });
    return applyImportResult(design, prepared.records);
  }
  throw new PdfImportError(`Unknown import mode '${prepared.mode}'.`, { code: "wrong-mode" });
}
