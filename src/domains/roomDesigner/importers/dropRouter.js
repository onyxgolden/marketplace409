// dropRouter.js — classify a file dropped on the Designer canvas by
// extension, routing it to the right existing staged import flow (pdf / dxf
// / vsdx) or refusing it by name with what to do instead, matching the
// pdfErrors.js UNSUPPORTED_VECTOR_FORMATS pattern (a frozen table + a pure,
// non-throwing checker). Never parses file content — extension only, exactly
// like each importer's own file-input accept gate.

/**
 * .dwg/.dwf are closed binary CAD formats; FORGE never attempts to parse
 * them. .dwfx is technically a readable zip/XML (OPC) package, but
 * extracting real CAD vector geometry from its XPS page markup is a project
 * comparable in size to the existing PDF importer, not a quick addition —
 * refused by name here, same as the others, pending a future dedicated
 * import pipeline if ever prioritized.
 */
export const DROP_REFUSED_FORMATS = Object.freeze([
  Object.freeze({
    extension: "dwg",
    label: "DWG",
    message:
      "DWG is a closed binary CAD format — FORGE can't read it directly. In your CAD program, use Save As / Export → DXF (the free ODA File Converter can batch-convert many files at once), then drop the .dxf here.",
  }),
  Object.freeze({
    extension: "dwf",
    label: "DWF",
    message:
      "DWF is a closed binary CAD format — FORGE can't read it directly. Plot or export the drawing to PDF or DXF from your CAD program instead, then drop that here.",
  }),
  Object.freeze({
    extension: "dwfx",
    label: "DWFx",
    message:
      "DWFx isn't supported yet — its container is a readable zip/XML package, but extracting real CAD geometry from it is a separate project of its own size, not a quick addition. Plot or export to PDF or DXF from your CAD program instead, then drop that here.",
  }),
]);

const SUPPORTED_KIND_BY_EXTENSION = Object.freeze({
  pdf: "pdf",
  dxf: "dxf",
  vsdx: "vsdx",
});

function extensionOf(fileName) {
  const name = typeof fileName === "string" ? fileName : "";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Classifies a dropped file by its name alone (never reads content). Returns
 * one of:
 *  - { kind: "pdf" | "dxf" | "vsdx" }
 *  - { kind: "refused", extension, label, message }
 *  - { kind: "unknown", extension }
 * Never throws.
 */
export function classifyDroppedFile(fileName) {
  const extension = extensionOf(fileName);
  const supportedKind = SUPPORTED_KIND_BY_EXTENSION[extension];
  if (supportedKind) return { kind: supportedKind };
  const refused = DROP_REFUSED_FORMATS.find((f) => f.extension === extension);
  if (refused) return { kind: "refused", extension, label: refused.label, message: refused.message };
  return { kind: "unknown", extension };
}
