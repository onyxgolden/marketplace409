// FORGE Capture — Process Training PT-6 Slice E guide export prototype
// (ui/process-guide-export.js).
//
// Pure, deterministic, fixture-only document serializer: turns a compiled
// PT-2 fixture guide (`source: "fixture"`, `status: "draft_unverified"`)
// into a self-contained, print-ready HTML document — in-memory bytes plus
// a manifest — handed to one explicit user download by the host UI. No
// DOM, no host clock, no filesystem, no network, no storage, no IPC, no
// model calls — see the structural test in
// `__tests__/process-guide-export.test.js` that scans this file's own
// source for exactly those things and fails if any appear.
//
// THIS MODULE NEVER CAPTURES OR PERSISTS ANYTHING. It accepts only an
// already-compiled fixture guide and returns fresh in-memory data —
// nothing is written to disk, nothing is sent anywhere, and the document
// itself is only ever downloaded through the host UI's explicit
// anchor-download handler (which lives in process-training.js and is
// never imported or called from here). A real/live guide input is
// refused before any serialization, with only safe metadata (code,
// supplied source value, requested format, guide id — never guide
// contents) in the thrown `GuideExportError`'s attempt record.
//
// V1 supports exactly one format (`html`, UTF-8, `.html`) and exactly one
// layout (`{ paper: "letter", orientation: "portrait" }`); anything else
// fails closed. Every explicit page (one cover, one per step, one per
// warning) carries its own visible `DEMO / DRAFT / NOT VERIFIED`
// watermark and page number — watermark suppression is a hard error, and
// every constructed page goes through the single `renderPage` renderer
// so an unwatermarked page is structurally impossible.
//
// Source-token rule: every source value is HTML-escaped and rendered
// byte-for-byte; no source value may create markup, scripts, styles,
// links, event handlers, or resource references. Withheld screenshots
// are never embedded — every step carries the same text placeholder,
// and no image/pixel/source-byte field is ever inspected or serialized.
// Slice W's additive `wording`/`wordingPass` fields are never consumed;
// Slice E remains independently reproducible from the PT-2 guide.
//
// Determinism rule: identical inputs produce byte-identical bytes and a
// deep-equal manifest. The serializer reads no clock and stamps no
// creation time. Overlong values are rejected, never truncated.

import { GUIDE_SCHEMA_VERSION } from "./process-guide-compiler.js";

export const GUIDE_EXPORT_SCHEMA_VERSION = 1;

export const GUIDE_EXPORT_FORMATS = Object.freeze({
  html: Object.freeze({ mime: "text/html;charset=utf-8", extension: "html" }),
});

export const GUIDE_EXPORT_LAYOUT = Object.freeze({
  paper: "letter",
  orientation: "portrait",
});

export const GUIDE_EXPORT_WATERMARK = Object.freeze({
  required: true,
  label: "DEMO / DRAFT / NOT VERIFIED",
});

export const GUIDE_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

// Fixed module-authored cover prose, exported so tests can pin the exact
// literals the verification-claim audit scans (E-002).

// Fixed bounded maximums. Overlong values are rejected with
// GuideExportError — source truth is never silently truncated.
//
// MAX_FIELD_LENGTH is a print-geometry bound, not an arbitrary cap:
// every variable rendered field (step action/targetLabel/processName/
// decision, loss-warning stage) shares it, and the worst accepted case —
// a step page with all four fields at this length in full-width CJK —
// was rendered to PDF in headless Chromium (Letter, @page 0.75in
// margins, border-box 9.5in page box) with the content bottom at 604pt
// against the 738pt printable bottom: 134pt (~9 lines) of margin, so no
// accepted content can spill onto an unwatermarked continuation page.
// See the E-001 rendered-PDF evidence in the Slice E report.
const MAX_STEPS = 500;
const MAX_WARNINGS = 100;
const MAX_FIELD_LENGTH = 120;
const MAX_ATTEMPT_DETAIL_LENGTH = 300;

// Words that would make generated wording assert an outcome the pass
// must never claim. The document prose is fixed (not input-derived) and
// is audited by test instead: the rendered cover must retain
// `draft_unverified` and must not contain a positive claim phrase.
const VERIFICATION_CLAIM_PHRASES = [
  "is verified",
  "are verified",
  "has been verified",
  "have been verified",
  "was verified",
  "were verified",
  "approved",
  "successful",
  "completed",
  "live status",
];

export class GuideExportError extends Error {
  constructor(code, message, attemptRecord) {
    super(message);
    this.name = "GuideExportError";
    this.code = code;
    // Bounded plain data only. A non-fixture refusal record may contain
    // only code, the supplied source value, the requested format, and
    // the guide id — never guide contents.
    this.attemptRecord = Object.freeze({ ...(attemptRecord || {}) });
  }
}

function boundDetail(value) {
  const s = String(value ?? "");
  return s.length > MAX_ATTEMPT_DETAIL_LENGTH
    ? s.slice(0, MAX_ATTEMPT_DETAIL_LENGTH)
    : s;
}

function fail(code, message, attemptRecord) {
  throw new GuideExportError(code, message, attemptRecord);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function checkGeneratedProse(prose) {
  const lower = String(prose).toLowerCase();
  for (const phrase of VERIFICATION_CLAIM_PHRASES) {
    if (lower.includes(phrase)) {
      fail("invalid-prose", `generated prose must not claim: ${phrase}`, { code: "invalid-prose" });
    }
  }
}

function requireBoundedString(value, field, { allowEmpty = false } = {}) {
  if (typeof value !== "string") {
    fail("invalid-guide", `field ${field} must be a string`, {
      code: "invalid-guide",
      field,
    });
  }
  if (!allowEmpty && value.length === 0) {
    fail("invalid-guide", `field ${field} must not be empty`, {
      code: "invalid-guide",
      field,
    });
  }
  if (value.length > MAX_FIELD_LENGTH) {
    fail("overlong-field", `field ${field} exceeds the fixed maximum and is rejected, not truncated`, {
      code: "overlong-field",
      field,
    });
  }
  return value;
}

function validateStep(step, index, lastStepIndex) {
  if (!isPlainObject(step)) {
    fail("invalid-step", `step at position ${index} must be an object`, {
      code: "invalid-step",
      position: index,
    });
  }
  const { stepIndex } = step;
  if (!Number.isInteger(stepIndex) || stepIndex < 0) {
    fail("invalid-step", `step at position ${index} has an invalid stepIndex`, {
      code: "invalid-step",
      position: index,
    });
  }
  if (stepIndex <= lastStepIndex) {
    fail("invalid-step", `stepIndex values must be unique and strictly ascending in guide order`, {
      code: "invalid-step",
      position: index,
    });
  }
  if (!Number.isInteger(step.sequenceId) || step.sequenceId < 0) {
    fail("invalid-step", `step ${stepIndex} has an invalid sequenceId`, {
      code: "invalid-step",
      position: index,
    });
  }
  requireBoundedString(step.action, `steps[${index}].action`);
  requireBoundedString(step.targetLabel, `steps[${index}].targetLabel`);
  requireBoundedString(step.processName, `steps[${index}].processName`, { allowEmpty: true });
  requireBoundedString(step.trust, `steps[${index}].trust`, { allowEmpty: true });
  requireBoundedString(step.decision, `steps[${index}].decision`);
  for (const flag of ["withheld", "redacted", "hasScreenshot"]) {
    if (typeof step[flag] !== "boolean") {
      fail("invalid-step", `step ${stepIndex} field ${flag} must be a boolean`, {
        code: "invalid-step",
        position: index,
      });
    }
  }
  // Deliberately never reads step.wording or step.wordingPass (Slice W).
}

function validateWarning(warning, index) {
  if (!isPlainObject(warning)) {
    fail("invalid-warning", `warning at position ${index} must be an object`, {
      code: "invalid-warning",
      position: index,
    });
  }
  const type = warning.type;
  if (type === "gap") {
    for (const f of ["firstMissing", "lastMissing"]) {
      if (!Number.isInteger(warning[f]) || warning[f] < 0) {
        fail("invalid-warning", `gap warning field ${f} must be a non-negative integer`, {
          code: "invalid-warning",
          position: index,
        });
      }
    }
    if (warning.firstMissing > warning.lastMissing) {
      fail("invalid-warning", `gap warning firstMissing must not exceed lastMissing`, {
        code: "invalid-warning",
        position: index,
      });
    }
    const hint = warning.stepIndexHint;
    if (hint !== null && (!Number.isInteger(hint) || hint < 0)) {
      fail("invalid-warning", `gap warning stepIndexHint must be null or a non-negative integer`, {
        code: "invalid-warning",
        position: index,
      });
    }
  } else if (type === "loss") {
    requireBoundedString(warning.stage, `warnings[${index}].stage`);
    if (!Number.isInteger(warning.droppedCount) || warning.droppedCount < 0) {
      fail("invalid-warning", `loss warning droppedCount must be a non-negative integer`, {
        code: "invalid-warning",
        position: index,
      });
    }
  } else if (type === "uncertain") {
    const last = warning.lastProcessedSeq;
    if (last !== null && (!Number.isInteger(last) || last < 0)) {
      fail("invalid-warning", `uncertain warning lastProcessedSeq must be null or a non-negative integer`, {
        code: "invalid-warning",
        position: index,
      });
    }
  } else {
    // Unknown warning kinds fail closed rather than being dropped or
    // guessed.
    fail("unknown-warning-kind", `unrecognized warning kind: ${boundDetail(type)}`, {
      code: "unknown-warning-kind",
    });
  }
}

function validateCompleteness(completeness) {
  if (!isPlainObject(completeness)) {
    fail("invalid-completeness", `completeness must be an object`, {
      code: "invalid-completeness",
    });
  }
  if (typeof completeness.isComplete !== "boolean") {
    fail("invalid-completeness", `completeness.isComplete must be a boolean`, {
      code: "invalid-completeness",
    });
  }
  for (const f of ["totalEvents", "withheldCount", "redactedCount", "proceedCount", "gapCount"]) {
    const v = completeness[f];
    if (!Number.isInteger(v) || v < 0 || v > MAX_STEPS * 4) {
      fail("invalid-completeness", `completeness field ${f} must be a bounded non-negative integer`, {
        code: "invalid-completeness",
      });
    }
  }
  if (typeof completeness.reconciliationUncertain !== "boolean") {
    fail("invalid-completeness", `completeness.reconciliationUncertain must be a boolean`, {
      code: "invalid-completeness",
    });
  }
  const last = completeness.lastProcessedSeq;
  if (last !== null && (!Number.isInteger(last) || last < 0)) {
    fail("invalid-completeness", `completeness.lastProcessedSeq must be null or a non-negative integer`, {
      code: "invalid-completeness",
    });
  }
  const lossByStage = completeness.lossByStage;
  if (!isPlainObject(lossByStage)) {
    fail("invalid-completeness", `completeness.lossByStage must be an object`, {
      code: "invalid-completeness",
    });
  }
  for (const [stage, count] of Object.entries(lossByStage)) {
    requireBoundedString(stage, "completeness.lossByStage key", { allowEmpty: true });
    if (!Number.isInteger(count) || count < 0) {
      fail("invalid-completeness", `completeness.lossByStage values must be non-negative integers`, {
        code: "invalid-completeness",
      });
    }
  }
}

/**
 * The single page renderer. Every explicit page in the document is
 * constructed through this function, which inserts the fixed watermark
 * and the page number — an unwatermarked page is structurally
 * impossible from this module.
 */
function renderPage({ pageNum, pageCount, title, bodyHtml }) {
  return (
    `<section class="pt-export-page" aria-label="${escapeHtml(title)}">\n` +
    `<div class="pt-export-watermark" role="note">${escapeHtml(GUIDE_EXPORT_WATERMARK.label)}</div>\n` +
    `${bodyHtml}\n` +
    `<div class="pt-export-pagenum">Page ${pageNum} of ${pageCount}</div>\n` +
    `</section>`
  );
}

const IMAGE_PLACEHOLDER_TEXT = "No image exported — fixture guide placeholder.";

// Fixed module-authored cover prose. The verification-claim audit
// (checkGeneratedProse) runs ONLY over these literals — never over
// interpolated caller-owned source metadata such as the guide id, so a
// valid id like "approved" is kept verbatim instead of tripping the
// claim detector. Pinned by test: any literal gaining a claim phrase
// fails the audit at render time and in the suite.
export const FIXED_COVER_PROSE = Object.freeze([
  "Fixture Guide Document",
  "Guide ID",
  "Source",
  "fixture",
  "Status",
  "draft_unverified (draft — not verified)",
  "Steps",
  "Warnings",
  "Completeness",
  "no gaps, losses, or reconciliation uncertainty reported",
  "gaps, losses, or reconciliation uncertainty reported",
  "events",
  "withheld",
  "redacted",
  "proceeded",
  "gaps",
  "This is a demo fixture guide. It is a draft and has not been verified.",
  "It describes recorded fixture evidence only and asserts no outcome.",
]);

function renderCoverPage({ guideId, guide, pageNum, pageCount }) {
  const c = guide.completeness;
  // Audit fixed prose only. The guideId below is caller-owned source
  // metadata: it is HTML-escaped and rendered verbatim, never
  // claim-scanned.
  checkGeneratedProse(FIXED_COVER_PROSE.join(" "));
  const body =
    `<h1>Fixture Guide Document</h1>\n` +
    `<dl class="pt-export-meta">\n` +
    `<div><dt>Guide ID</dt><dd>${escapeHtml(guideId)}</dd></div>\n` +
    `<div><dt>Source</dt><dd>fixture</dd></div>\n` +
    `<div><dt>Status</dt><dd>draft_unverified (draft — not verified)</dd></div>\n` +
    `<div><dt>Steps</dt><dd>${guide.steps.length}</dd></div>\n` +
    `<div><dt>Warnings</dt><dd>${guide.warnings.length}</dd></div>\n` +
    `<div><dt>Completeness</dt><dd>${c.isComplete ? "no gaps, losses, or reconciliation uncertainty reported" : "gaps, losses, or reconciliation uncertainty reported"} — ` +
    `${c.totalEvents} events, ${c.withheldCount} withheld, ${c.redactedCount} redacted, ` +
    `${c.proceedCount} proceeded, ${c.gapCount} gaps</dd></div>\n` +
    `</dl>\n` +
    `<p class="pt-export-note">This is a demo fixture guide. It is a draft and has not been verified. ` +
    `It describes recorded fixture evidence only and asserts no outcome.</p>`;
  return renderPage({ pageNum, pageCount, title: "Cover", bodyHtml: body });
}

function renderStepPage({ step, stepNum, stepTotal, pageNum, pageCount }) {
  const body =
    `<h2>Step ${step.stepIndex + 1} of ${stepTotal}</h2>\n` +
    `<dl class="pt-export-meta">\n` +
    `<div><dt>Action</dt><dd>${escapeHtml(step.action)}</dd></div>\n` +
    `<div><dt>Target</dt><dd>${escapeHtml(step.targetLabel)}</dd></div>\n` +
    `<div><dt>Process</dt><dd>${escapeHtml(step.processName)}</dd></div>\n` +
    `<div><dt>Privacy decision</dt><dd>${escapeHtml(step.decision)}</dd></div>\n` +
    `<div><dt>Withheld</dt><dd>${step.withheld ? "yes" : "no"}</dd></div>\n` +
    `<div><dt>Redacted</dt><dd>${step.redacted ? "yes" : "no"}</dd></div>\n` +
    `<div><dt>Sequence ID</dt><dd>${step.sequenceId}</dd></div>\n` +
    `</dl>\n` +
    `<div class="pt-export-image-area" role="img" aria-label="No image exported">${escapeHtml(IMAGE_PLACEHOLDER_TEXT)}</div>`;
  return renderPage({ pageNum, pageCount, title: `Step ${step.stepIndex + 1}`, bodyHtml: body });
}

function warningDescription(w) {
  if (w.type === "gap") {
    return `Sequence gap (ids ${w.firstMissing}–${w.lastMissing}) — evidence missing, not invented.` +
      (w.stepIndexHint !== null ? ` Follows step ${w.stepIndexHint + 1}.` : "");
  }
  if (w.type === "loss") {
    return `${w.stage}: ${w.droppedCount} dropped.`;
  }
  return `Shutdown reconciliation uncertain (last processed sequence: ${w.lastProcessedSeq ?? "none"}).`;
}

function renderWarningPage({ warning, warningNum, warningTotal, pageNum, pageCount }) {
  const body =
    `<h2>Warning ${warningNum} of ${warningTotal}</h2>\n` +
    `<dl class="pt-export-meta">\n` +
    `<div><dt>Kind</dt><dd>${escapeHtml(warning.type)}</dd></div>\n` +
    `</dl>\n` +
    `<p class="pt-export-warning">${escapeHtml(warningDescription(warning))}</p>`;
  return renderPage({ pageNum, pageCount, title: `Warning ${warningNum}`, bodyHtml: body });
}

// Print geometry (E-001): Letter portrait with 0.75in @page margins
// gives a 7in x 9.5in printable area. Each section is border-box with
// height exactly 9.5in, so its outer box EQUALS the printable area —
// the previous content-box min-height:9.5in + 0.25in padding produced a
// 10in minimum outer box that spilled every section onto an
// unwatermarked continuation page. Content volume is bounded by
// MAX_FIELD_LENGTH (measured fit), never by clipping: overflow is not
// hidden and no break-inside avoidance is relied upon.
const DOCUMENT_CSS = [
  "@page { size: letter portrait; margin: 0.75in; }",
  "html, body { margin: 0; padding: 0; font-family: Georgia, 'Times New Roman', serif; color: #111; }",
  ".pt-export-page { width: 7in; height: 9.5in; box-sizing: border-box; margin: 0 auto; padding: 0.25in 0; page-break-after: always; position: relative; }",
  ".pt-export-page:last-child { page-break-after: auto; }",
  ".pt-export-watermark { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; font-weight: bold; letter-spacing: 0.12em; color: #8a1f1f; border: 2px solid #8a1f1f; padding: 6pt 10pt; margin-bottom: 18pt; text-align: center; }",
  ".pt-export-pagenum { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #444; margin-top: 18pt; text-align: center; }",
  ".pt-export-meta { display: grid; gap: 4pt; }",
  ".pt-export-meta > div { display: grid; grid-template-columns: 9em 1fr; gap: 8pt; }",
  ".pt-export-meta dt { font-weight: bold; }",
  ".pt-export-meta dd { margin: 0; overflow-wrap: anywhere; }",
  ".pt-export-image-area { margin-top: 14pt; padding: 24pt; border: 1px dashed #666; text-align: center; font-style: italic; color: #333; }",
  ".pt-export-note, .pt-export-warning { overflow-wrap: anywhere; }",
  "h1 { font-size: 20pt; margin: 0 0 14pt; }",
  "h2 { font-size: 15pt; margin: 0 0 10pt; }",
].join("\n");

/**
 * Serializes a compiled PT-2 fixture guide into a self-contained,
 * print-ready HTML document artifact. Pure: no DOM, no clock, no network, no
 * storage — returns fresh in-memory `{ bytes, mime, extension, filename,
 * pageCount, manifest }`. Identical inputs produce byte-identical bytes
 * and a deep-equal manifest.
 *
 * Throws `GuideExportError` (never a partial artifact) when any input
 * is unsupported.
 */
export function exportGuideDocument({ guide, guideId, format, layout, watermark }) {
  // Validate envelope options before touching the guide.
  if (format !== "html" || !Object.hasOwn(GUIDE_EXPORT_FORMATS, format)) {
    fail("unsupported-format", `unsupported export format: ${boundDetail(format)}`, {
      code: "unsupported-format",
      format: boundDetail(format),
    });
  }
  if (
    !isPlainObject(layout) ||
    layout.paper !== GUIDE_EXPORT_LAYOUT.paper ||
    layout.orientation !== GUIDE_EXPORT_LAYOUT.orientation ||
    Object.keys(layout).length !== 2
  ) {
    fail("unsupported-layout", `only { paper: "letter", orientation: "portrait" } is supported`, {
      code: "unsupported-layout",
    });
  }
  if (watermark !== true) {
    fail("watermark-required", `the watermark is required and cannot be suppressed or customized`, {
      code: "watermark-required",
    });
  }
  if (typeof guideId !== "string" || !GUIDE_ID_PATTERN.test(guideId)) {
    fail("invalid-guide-id", `guideId must match ${GUIDE_ID_PATTERN.source}`, {
      code: "invalid-guide-id",
    });
  }
  const safeRecord = (extra = {}) => ({ code: extra.code, guideId, ...(extra.rest || {}) });

  if (!isPlainObject(guide)) {
    fail("invalid-guide", `guide must be an object`, safeRecord({ code: "invalid-guide" }));
  }
  if (guide.schemaVersion !== GUIDE_SCHEMA_VERSION) {
    fail("unsupported-schema", `unsupported guide schema version: ${boundDetail(guide.schemaVersion)}`, safeRecord({ code: "unsupported-schema" }));
  }
  if (guide.source !== "fixture") {
    // Non-fixture refusal: the record carries only code, the supplied
    // source value, the requested format, and the guide id — never
    // guide contents.
    fail("non-fixture-source", `only fixture guides may be exported`, {
      code: "non-fixture-source",
      source: boundDetail(guide.source),
      format,
      guideId,
    });
  }
  if (guide.status !== "draft_unverified") {
    fail("unsupported-status", `unsupported guide status: ${boundDetail(guide.status)}`, safeRecord({ code: "unsupported-status" }));
  }
  if (!Array.isArray(guide.steps)) {
    fail("invalid-guide", `guide.steps must be an array`, safeRecord({ code: "invalid-guide" }));
  }
  if (guide.steps.length > MAX_STEPS) {
    fail("oversized-guide", `guide has ${guide.steps.length} steps; the fixed maximum is ${MAX_STEPS} — rejected, not truncated`, safeRecord({ code: "oversized-guide" }));
  }
  let lastStepIndex = -1;
  guide.steps.forEach((step, i) => {
    validateStep(step, i, lastStepIndex);
    lastStepIndex = step.stepIndex;
  });
  if (!Array.isArray(guide.warnings)) {
    fail("invalid-guide", `guide.warnings must be an array`, safeRecord({ code: "invalid-guide" }));
  }
  if (guide.warnings.length > MAX_WARNINGS) {
    fail("oversized-guide", `guide has ${guide.warnings.length} warnings; the fixed maximum is ${MAX_WARNINGS} — rejected, not truncated`, safeRecord({ code: "oversized-guide" }));
  }
  guide.warnings.forEach((w, i) => validateWarning(w, i));
  validateCompleteness(guide.completeness);

  // Page plan: one cover, one page per step (authoritative guide order),
  // one page per warning. Explicit pages only — no automatic pagination
  // for watermark coverage.
  const stepCount = guide.steps.length;
  const warningCount = guide.warnings.length;
  const pageCount = 1 + stepCount + warningCount;

  const pages = [];
  pages.push(renderCoverPage({ guideId, guide, pageNum: 1, pageCount }));
  guide.steps.forEach((step, i) =>
    pages.push(renderStepPage({ step, stepNum: i + 1, stepTotal: stepCount, pageNum: 2 + i, pageCount }))
  );
  guide.warnings.forEach((w, i) =>
    pages.push(renderWarningPage({ warning: w, warningNum: i + 1, warningTotal: warningCount, pageNum: 2 + stepCount + i, pageCount }))
  );

  const html =
    `<!DOCTYPE html>\n` +
    `<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<title>${escapeHtml(`Fixture guide document — ${guideId}`)}</title>\n` +
    `<style>\n${DOCUMENT_CSS}\n</style>\n</head>\n<body>\n` +
    pages.join("\n") +
    `\n</body>\n</html>\n`;

  const bytes = new TextEncoder().encode(html);
  const filename = `${guideId}.html`;

  const manifest = Object.freeze({
    schemaVersion: GUIDE_EXPORT_SCHEMA_VERSION,
    guideId,
    source: "fixture",
    status: "draft_unverified",
    format: "html",
    layout: Object.freeze({ paper: "letter", orientation: "portrait" }),
    watermark: Object.freeze({
      required: true,
      label: GUIDE_EXPORT_WATERMARK.label,
      pageCount,
    }),
    stepCount,
    warningCount,
  });

  return {
    bytes,
    mime: GUIDE_EXPORT_FORMATS.html.mime,
    extension: GUIDE_EXPORT_FORMATS.html.extension,
    filename,
    pageCount,
    manifest,
  };
}
