/**
 * Error type for the VSDX importer.
 *
 * Every failure carries human-readable provenance (e.g.
 * `Page 'Floor 1' → Group 18 → Shape 23`) instead of a bare XML stack trace,
 * so import errors can name the exact drawing element that failed.
 * `code` is a stable machine-readable tag for tests and the import report.
 */
export class VsdxImportError extends Error {
  constructor(message, { provenance = null, code = "import-error" } = {}) {
    super(provenance ? `${message} (${provenance})` : message);
    this.name = "VsdxImportError";
    this.provenance = provenance;
    this.code = code;
  }
}

/** Format a shape-provenance breadcrumb: Page → Group → Shape. */
export function shapeProvenance({ pageName, parentNames = [], shapeId, shapeName }) {
  const parts = [];
  if (pageName) parts.push(`Page '${pageName}'`);
  for (const name of parentNames) parts.push(name);
  parts.push(`Shape ${shapeId}${shapeName ? ` '${shapeName}'` : ""}`);
  return parts.join(" → ");
}
