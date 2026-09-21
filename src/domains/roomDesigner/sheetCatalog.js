/**
 * Printable paper sheet catalog (FORGE Designer).
 *
 * Immutable, pure data. Catalog entries are stored PORTRAIT ONLY — landscape
 * is always a pure width/height swap via sheetDimensions(), never a separate
 * catalog entry. Sheets persist as { id, sizeId, orientation, x, y } (plus the
 * placement-time plan bounds and fit scale, which are fixed at placement and
 * never recomputed from later content); derived physical dimensions are never
 * persisted.
 */

export const SHEET_CATALOG = Object.freeze([
  Object.freeze({ id: "letter", label: "Letter", widthIn: 8.5, heightIn: 11 }),
  Object.freeze({ id: "tabloid", label: "Tabloid", widthIn: 11, heightIn: 17 }),
  Object.freeze({ id: "arch-a", label: "ARCH A", widthIn: 9, heightIn: 12 }),
  Object.freeze({ id: "arch-b", label: "ARCH B", widthIn: 12, heightIn: 18 }),
  Object.freeze({ id: "arch-c", label: "ARCH C", widthIn: 18, heightIn: 24 }),
  Object.freeze({ id: "arch-d", label: "ARCH D", widthIn: 24, heightIn: 36 }),
  Object.freeze({ id: "arch-e", label: "ARCH E", widthIn: 36, heightIn: 48 }),
]);

export const SHEET_ORIENTATIONS = Object.freeze(["portrait", "landscape"]);

/**
 * Reserved margin (inches) on every side of a sheet. Print geometry is
 * computed against the printable area (paper minus this margin); the margin
 * itself is a convention only — the OS/browser print dialog may override it.
 */
export const PRINT_MARGIN_IN = 0.5;

export function getSheetSize(sizeId) {
  const entry = SHEET_CATALOG.find((s) => s.id === sizeId);
  if (!entry) {
    throw new Error(`Unknown sheet size: ${sizeId}`);
  }
  return entry;
}

/**
 * Physical paper dimensions for a size + orientation. Landscape is a pure
 * width/height swap of the portrait catalog dimensions.
 */
export function sheetDimensions(sizeId, orientation = "portrait") {
  if (orientation !== "portrait" && orientation !== "landscape") {
    throw new Error(`Unknown sheet orientation: ${orientation}`);
  }
  const { widthIn, heightIn } = getSheetSize(sizeId);
  return orientation === "landscape"
    ? { widthIn: heightIn, heightIn: widthIn }
    : { widthIn, heightIn };
}

/** Human label, e.g. "ARCH D · 24″ × 36″ · portrait". */
export function sheetSizeLabel(sizeId, orientation = "portrait") {
  const entry = getSheetSize(sizeId);
  const { widthIn, heightIn } = sheetDimensions(sizeId, orientation);
  return `${entry.label} · ${widthIn}″ × ${heightIn}″ · ${orientation}`;
}
