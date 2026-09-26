// Cabinet codes: the industry naming convention (as used on common stock
// cabinet price lists) applied to a placed cabinet's ACTUAL size.
//
//   W2430     wall cabinet 24" wide x 30" high (depth appended when not 12": W362424)
//   WC2430    corner wall cabinet 24" x 30"
//   B24       base cabinet 24" wide (base codes omit height)
//   DB18      drawer base unit;   3DB24 three-drawer base
//   SB36      sink base;          CSB60 combination sink base (60" sinks)
//   FSB36     farm sink base;     LS36  lazy Susan corner base
//   BBC36LH   blind corner base, left / right hand;   ER36 easy reach corner
//   7UC2424   utility/pantry: height in feet, then width, depth (7' = 84")
//
// The code follows the piece: resize a W2430 to 36" wide and it becomes
// W3630. Price lists are matched on these codes, so a supplier's item
// number can change (or an item be discontinued) without breaking the match.
//
// Pure and framework-free.

import { pieceSize } from "./designerDocument";

/** 24 -> "24", 34.5 -> "34.5" (codes are normally whole inches). */
function n(v) {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}

const RULES = {
  "cabinet-base-24": ({ w }) => `B${n(w)}`,
  "cabinet-island-base": ({ w }) => `B${n(w)}`,
  "cabinet-base-db": ({ w }) => `DB${n(w)}`,
  "cabinet-base-drawer": ({ w }) => `3DB${n(w)}`,
  "cabinet-base-trash": ({ w }) => `TB${n(w)}`,
  "cabinet-sink-36": ({ w }) => (w >= 60 ? `CSB${n(w)}` : `SB${n(w)}`),
  "cabinet-sink-farm": ({ w }) => `FSB${n(w)}`,
  "cabinet-base-corner": ({ w }) => `LS${n(w)}`,
  "cabinet-base-blind": ({ w }) => `BBC${n(w)}LH`,
  "cabinet-base-blind-rh": ({ w }) => `BBC${n(w)}RH`,
  "cabinet-base-easy-reach": ({ w }) => `ER${n(w)}`,
  "cabinet-wall-24": ({ w, h, d }) => `W${n(w)}${n(h)}${d === 12 ? "" : n(d)}`,
  "cabinet-wall-microwave": ({ w, h, d }) => `W${n(w)}${n(h)}${d === 12 ? "" : n(d)}`,
  "cabinet-wall-bridge": ({ w, h, d }) => `W${n(w)}${n(h)}${d === 12 ? "" : n(d)}`,
  "cabinet-wall-corner": ({ w, h }) => `WC${n(w)}${n(h)}`,
  "cabinet-open-shelf": ({ w }) => `OS${n(w)}`,
  "cabinet-pantry-24": ({ w, h, d }) => `${n(Math.round(h / 12))}UC${n(w)}${n(d)}`,
  "cabinet-tall-utility": ({ w, h, d }) => `${n(Math.round(h / 12))}UC${n(w)}${n(d)}`,
  "cabinet-tall-oven": ({ w, h }) => `OC${n(w)}${n(h)}`,
  "cabinet-vanity-sink": ({ w }) => `VSB${n(w)}`,
  "cabinet-vanity-drawer": ({ w }) => `VDB${n(w)}`,
  "cabinet-linen-tower": ({ w, h }) => `LT${n(w)}${n(h)}`,
  "cabinet-bath-wall": ({ w, h }) => `BW${n(w)}${n(h)}`,
};

/** The code for a placed cabinet at its current size, or null for non-cabinets. */
export function cabinetCode(piece) {
  const rule = piece && RULES[piece.catalogId];
  if (!rule) return null;
  const { widthIn: w, depthIn: d, heightIn: h } = pieceSize(piece);
  return rule({ w, d, h });
}

/** Catalog ids that have a code (every cabinet type). */
export function codedCatalogIds() {
  return Object.keys(RULES);
}
