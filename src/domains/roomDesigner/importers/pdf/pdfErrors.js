/**
 * Error type and file-format gate for the PDF importer.
 *
 * Mirrors the VSDX importer's error contract (vsdxErrors.js): every failure
 * carries human-readable provenance (e.g. `Page 3`) instead of a bare
 * stack trace, and `code` is a stable machine-readable tag for tests and
 * the import report.
 *
 * Format scope is deliberately narrow and is enforced HERE, once, so the UI
 * and the importer can never disagree about what is supported:
 *   supported     → .pdf
 *   out of scope  → .ai / .eps (PostScript-family vector art)
 *
 * Adobe Illustrator (.ai) files are frequently PDF-compatible internally,
 * which makes "just try it" tempting. It is refused anyway: an .ai whose
 * PDF compatibility was switched off parses as garbage, and a silently
 * half-read design file is worse than a clear refusal.
 */

export class PdfImportError extends Error {
  constructor(message, { provenance = null, code = "import-error" } = {}) {
    super(provenance ? `${message} (${provenance})` : message);
    this.name = "PdfImportError";
    this.provenance = provenance;
    this.code = code;
  }
}

/** Provenance breadcrumb for a page-scoped failure. */
export function pageProvenance(pageNumber) {
  return `Page ${pageNumber}`;
}

/** Extensions this importer refuses by design, with the reason shown in the UI. */
export const UNSUPPORTED_VECTOR_FORMATS = Object.freeze([
  Object.freeze({
    extension: ".ai",
    label: "Adobe Illustrator",
    reason:
      "Illustrator (.ai) artwork is not supported. Re-save it as PDF from Illustrator (File → Save As → Adobe PDF) and import that.",
  }),
  Object.freeze({
    extension: ".eps",
    label: "Encapsulated PostScript",
    reason:
      "PostScript (.eps) artwork is not supported. Export or print it to PDF first, then import the PDF.",
  }),
]);

/**
 * Classify a dropped/chosen file by name and MIME type.
 * Returns { ok: true } or { ok: false, code, message } — never throws, so
 * the drop handler can render the reason without a try/catch.
 */
export function checkPdfFileSupported({ name = "", type = "" } = {}) {
  const lowerName = String(name || "").toLowerCase();
  const mime = String(type || "").toLowerCase();

  for (const format of UNSUPPORTED_VECTOR_FORMATS) {
    const byExtension = lowerName.endsWith(format.extension);
    const byMime =
      (format.extension === ".ai" && mime === "application/illustrator") ||
      (format.extension === ".eps" &&
        (mime === "application/postscript" || mime === "application/eps"));
    if (byExtension || byMime) {
      return { ok: false, code: "unsupported-format", message: format.reason };
    }
  }

  if (lowerName.endsWith(".pdf") || mime === "application/pdf") return { ok: true };

  return {
    ok: false,
    code: "not-a-pdf",
    message: "Only PDF files can be imported here. Choose a .pdf file.",
  };
}
