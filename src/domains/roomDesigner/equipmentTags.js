// Equipment tags and the equipment schedule for process equipment.
//
// Tags follow the common "<letter code>-<number>" convention with numbers
// starting at 101 (P-101, P-102, V-101, ...). A new piece takes one more
// than the highest number already used for its prefix in the design, so
// deleting P-102 never makes the next pump reuse "P-102" while P-103 exists,
// and a user's own renumbering (typed into the inspector) is respected.
//
// Pure and framework-free.

import { findSymbol } from "./symbolRegistry";
import { PROCESS_EQUIPMENT_CATEGORIES, PROCESS_EQUIPMENT_DOMAIN } from "./processEquipmentCatalog";

export const FIRST_TAG_NUMBER = 101;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Next free tag for a prefix in a design, e.g. "P-103". */
export function nextEquipmentTag(design, prefix) {
  if (typeof prefix !== "string" || !prefix) return null;
  const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`, "i");
  let max = FIRST_TAG_NUMBER - 1;
  for (const inst of design?.symbols || []) {
    const m = typeof inst.tag === "string" ? inst.tag.trim().match(pattern) : null;
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${max + 1}`;
}

/** The auto-tag for placing symbolId of domain into design, or null when that symbol isn't tagged. */
export function autoTagFor(design, domain, symbolId) {
  const symbol = findSymbol(domain, symbolId);
  return symbol?.tagPrefix ? nextEquipmentTag(design, symbol.tagPrefix) : null;
}

/** Compare tags so P-9 sorts before P-10 (prefix, then number, then text). */
function compareTags(a, b) {
  const pa = /^(.*?)-?(\d+)$/.exec(a || "");
  const pb = /^(.*?)-?(\d+)$/.exec(b || "");
  if (pa && pb && pa[1].toLowerCase() === pb[1].toLowerCase()) return Number(pa[2]) - Number(pb[2]);
  return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });
}

/**
 * Equipment schedule rows for every process-equipment piece in a design,
 * ordered by category (catalog order) then tag:
 *   [{ id, tag, description, category, sizeLabel }]
 * Untagged pieces sort last in their category with tag "".
 */
export function equipmentSchedule(design) {
  const rows = [];
  for (const inst of design?.symbols || []) {
    if (inst.domain !== PROCESS_EQUIPMENT_DOMAIN) continue;
    const symbol = findSymbol(inst.domain, inst.symbolId);
    if (!symbol) continue;
    const w = inst.widthIn ?? symbol.widthIn;
    const d = inst.depthIn ?? symbol.depthIn;
    rows.push({
      id: inst.id,
      tag: inst.tag || "",
      description: symbol.label,
      category: symbol.category,
      sizeLabel: `${w}″ × ${d}″ × ${symbol.heightIn}″ H`,
    });
  }
  const catIndex = (c) => {
    const i = PROCESS_EQUIPMENT_CATEGORIES.indexOf(c);
    return i === -1 ? PROCESS_EQUIPMENT_CATEGORIES.length : i;
  };
  return rows.sort((a, b) => {
    if (catIndex(a.category) !== catIndex(b.category)) return catIndex(a.category) - catIndex(b.category);
    if (!a.tag !== !b.tag) return a.tag ? -1 : 1;
    return compareTags(a.tag, b.tag);
  });
}

/** CSV text for the schedule (tag, description, category, nominal size). */
export function equipmentScheduleCsv(design) {
  const quote = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [["Tag", "Description", "Category", "Nominal size"].map(quote).join(",")];
  for (const row of equipmentSchedule(design)) {
    lines.push([row.tag, row.description, row.category, row.sizeLabel].map(quote).join(","));
  }
  return `${lines.join("\n")}\n`;
}
