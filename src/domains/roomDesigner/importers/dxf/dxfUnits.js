/**
 * DXF drawing units → inches, from the header's $INSUNITS code.
 * Unitless drawings (code 0 / missing) are common; the importer defaults
 * them to inches and says so, and the user can pick the real unit.
 */

export const DXF_UNITS = Object.freeze({
  in: { label: "Inches", toInches: 1 },
  ft: { label: "Feet", toInches: 12 },
  mm: { label: "Millimeters", toInches: 1 / 25.4 },
  cm: { label: "Centimeters", toInches: 1 / 2.54 },
  m: { label: "Meters", toInches: 1 / 0.0254 },
  yd: { label: "Yards", toInches: 36 },
});

const INSUNITS = { 1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m", 10: "yd" };

/** { unit, known } for a header; unknown/unitless → inches, known: false. */
export function detectUnits(header) {
  const unit = INSUNITS[header?.insUnits];
  return unit ? { unit, known: true } : { unit: "in", known: false };
}
