// Supplier cabinet price books and the kitchen cabinet estimate.
//
// A price book is one supplier's line (e.g. an unfinished-oak stock line):
//   { id, supplier, line, asOf: "YYYY-MM-DD", items: [
//       { code, name, sku, priceCents, kind: "cabinet"|"accessory", discontinued? } ] }
//
// Items are keyed by CODE (the cabinet naming convention, see
// cabinetCodes.js), not by the supplier's item number: the item number and
// price can be edited, and an item marked discontinued, without breaking
// how placed cabinets find their price. Money is integer cents, like
// homeEstimate.js. Every price traces to the user's own supplier sheet
// (pasted or typed) — nothing here invents a price.
//
// Pure and framework-free. Persistence is priceBookStorage.js.

import { cabinetCode } from "./cabinetCodes";

export const PRICE_BOOK_VERSION = 1;

// A sample list of standard stock-cabinet codes with GENERIC names and NO
// prices or item numbers: it shows the structure and gives every code a row
// to fill in, but every price has to come from the user's own supplier sheet
// (pasted as CSV, or typed) — nothing here invents a price. Real supplier
// lists are private per-user data (see /api/forge/designer/price-books),
// never committed to this repository.
const sample = (code, name, kind = "cabinet") => Object.freeze({ code, name, sku: "", priceCents: null, kind });

const wallSizes = [
  [9, 30], [12, 30], [15, 30], [18, 30], [21, 30], [24, 30], [27, 30], [30, 30], [33, 30], [36, 30], [48, 30],
  [30, 12], [36, 12], [30, 15], [36, 15], [30, 18], [36, 18], [30, 24], [36, 24],
  [12, 42], [15, 42], [18, 42], [21, 42], [24, 42], [27, 42], [30, 42], [33, 42], [36, 42],
];

export const SEED_PRICE_BOOKS = Object.freeze([
  Object.freeze({
    id: "sample-stock-cabinets",
    supplier: "Sample stock cabinet list",
    line: "enter your supplier's prices",
    asOf: "",
    items: Object.freeze([
      ...wallSizes.map(([w, h]) => sample(`W${w}${h}`, `Wall cabinet ${w}" x ${h}"`)),
      sample("WC2430", 'Corner wall cabinet 24" x 30"'),
      sample("WC2442", 'Corner wall cabinet 24" x 42"'),
      ...[9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 42, 48].map((w) => sample(`B${w}`, `Base cabinet ${w}"`)),
      ...[12, 15, 18, 21, 24].map((w) => sample(`DB${w}`, `Drawer base unit ${w}"`)),
      ...[24, 27, 30, 36].map((w) => sample(`3DB${w}`, `Three-drawer base ${w}"`)),
      sample("SB30", 'Sink base 30"'),
      sample("SB33", 'Sink base 33"'),
      sample("SB36", 'Sink base 36"'),
      sample("SB48", 'Sink base 48"'),
      sample("CSB60", 'Combination sink base 60"'),
      sample("FSB36", 'Farm sink base 36"'),
      sample("LS36", 'Lazy Susan corner base 36"'),
      sample("BBC36LH", 'Blind corner base 36" (left)'),
      sample("BBC36RH", 'Blind corner base 36" (right)'),
      sample("BBC39LH", 'Blind corner base 39" (left)'),
      sample("BBC39RH", 'Blind corner base 39" (right)'),
      sample("ER36", 'Easy reach corner base 36"'),
      sample("7UC1824", 'Pantry 18" x 24" x 84"'),
      sample("7UC2424", 'Pantry 24" x 24" x 84"'),
      sample("7UC3024", 'Pantry 30" x 24" x 84"'),
      sample("8UC2424", 'Pantry 24" x 24" x 96"'),
      sample("BASE-END-PANEL", "Base end panel", "accessory"),
      sample("WALL-END-PANEL", "Wall end panel", "accessory"),
      sample("WALL-FILLER-30", 'Wall filler strip 30"', "accessory"),
      sample("CROWN", "Crown moulding", "accessory"),
      sample("TOEKICK", "Toe kick", "accessory"),
      sample("OUTSIDE-CORNER", "Outside corner moulding", "accessory"),
    ]),
  }),
]);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const cleanStr = (v, max = 80) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** Cabinet codes start with a known prefix and a size (W2430, 3DB24, 7UC2424); anything else is an accessory. */
export function inferItemKind(code) {
  return /^(W|WC|B|DB|3DB|SB|CSB|FSB|LS|BBC|ER|\dUC|TB|OS|OC|VSB|VDB|LT|BW)\d/.test(normalizeCode(code)) ? "cabinet" : "accessory";
}

/** Normalize a code for matching: upper-case, no spaces. */
export function normalizeCode(code) {
  return cleanStr(code, 40).toUpperCase().replace(/\s+/g, "");
}

function cleanItem(raw) {
  const code = normalizeCode(raw?.code);
  if (!code) return null;
  // A missing price stays null ("no price entered"), never $0: Number(null)
  // is 0, so absent values must be screened out before converting.
  const priceCents = raw.priceCents === null || raw.priceCents === undefined || raw.priceCents === "" ? NaN : Number(raw.priceCents);
  const item = {
    code,
    name: cleanStr(raw.name) || code,
    sku: cleanStr(raw.sku, 40),
    priceCents: Number.isInteger(priceCents) && priceCents >= 0 ? priceCents : null,
    kind: raw.kind === "accessory" ? "accessory" : "cabinet",
  };
  if (raw.discontinued === true) item.discontinued = true;
  return item;
}

/** A usable book from stored/edited data (bad items dropped, never throws). */
export function normalizeBook(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id) return null;
  const seen = new Set();
  const items = [];
  for (const r of (Array.isArray(raw.items) ? raw.items : []).slice(0, MAX_BOOK_ITEMS)) {
    const item = cleanItem(r);
    if (!item || seen.has(item.code)) continue;
    seen.add(item.code);
    items.push(item);
  }
  return {
    id: raw.id,
    supplier: cleanStr(raw.supplier) || "Supplier",
    line: cleanStr(raw.line),
    asOf: /^\d{4}-\d{2}-\d{2}$/.test(raw.asOf || "") ? raw.asOf : "",
    items,
  };
}

/** Display name for a book, e.g. "Acme Supply — Unfinished Oak Cabinets". */
export function bookLabel(book) {
  return book.line ? `${book.supplier} — ${book.line}` : book.supplier;
}

/**
 * A new, empty supplier price list. The id is a slug of the names plus a
 * short random suffix so two lists from the same supplier never collide.
 */
export function createBook({ supplier, line = "", asOf = "" }, rand = Math.random) {
  const name = cleanStr(supplier);
  if (!name) throw new Error("Give the supplier a name.");
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("Use a date like 2025-01-31.");
  const slug = `${name} ${cleanStr(line)}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return { id: `${slug || "supplier"}-${rand().toString(36).slice(2, 7)}`, supplier: name, line: cleanStr(line), asOf: asOf || "", items: [] };
}

/** Largest price list accepted (rows). */
export const MAX_BOOK_ITEMS = 2000;

// ---------------------------------------------------------------------------
// Editing (every function returns a new book)
// ---------------------------------------------------------------------------

export function findItem(book, code) {
  const c = normalizeCode(code);
  return (book?.items || []).find((i) => i.code === c) || null;
}

/** Parse "$1,234.56" / "166.99" into cents; null when unreadable. */
export function parsePriceToCents(text) {
  const s = String(text ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/**
 * Update one item: { sku?, name?, priceCents?, discontinued? }.
 * Throws with a user-facing message on a bad price or unknown code.
 */
export function updateItem(book, code, patch) {
  const target = findItem(book, code);
  if (!target) throw new Error(`No item ${code} in this price list.`);
  const next = { ...target };
  if (patch.sku !== undefined) next.sku = cleanStr(patch.sku, 40);
  if (patch.name !== undefined) next.name = cleanStr(patch.name) || target.name;
  if (patch.priceCents !== undefined) {
    if (patch.priceCents !== null && !(Number.isInteger(patch.priceCents) && patch.priceCents >= 0)) {
      throw new Error("Price must be a dollar amount like 166.99.");
    }
    next.priceCents = patch.priceCents;
  }
  if (patch.discontinued !== undefined) {
    if (patch.discontinued) next.discontinued = true;
    else delete next.discontinued;
  }
  return { ...book, items: book.items.map((i) => (i.code === target.code ? next : i)) };
}

/** Add an item; throws when the code is empty or already in the book. */
export function addItem(book, raw) {
  const item = cleanItem(raw);
  if (!item) throw new Error("A new item needs a code (e.g. W3930).");
  if (findItem(book, item.code)) throw new Error(`${item.code} is already in this price list.`);
  return { ...book, items: [...book.items, item] };
}

export function removeItem(book, code) {
  const c = normalizeCode(code);
  return { ...book, items: book.items.filter((i) => i.code !== c) };
}

export function setAsOf(book, isoDate) {
  if (isoDate && !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error("Use a date like 2025-01-31.");
  return { ...book, asOf: isoDate || "" };
}

// ---------------------------------------------------------------------------
// CSV import / export — how a new price sheet gets applied in one go.
//   Columns (header row required, any order, case-insensitive):
//     code (required), name, item number | sku, price, discontinued (yes/no)
//   Rows update the item with that code, or add it when new. Blank cells
//   leave a field unchanged.
// ---------------------------------------------------------------------------

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === "\t") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export function importPriceCsv(book, text) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { book, updated: 0, added: 0, errors: ["Paste a header row and at least one item row."] };
  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (...names) => header.findIndex((h) => names.includes(h));
  const iCode = col("code");
  if (iCode === -1) return { book, updated: 0, added: 0, errors: ['The header needs a "code" column.'] };
  const iName = col("name", "description");
  const iSku = col("item number", "item #", "sku", "item");
  const iPrice = col("price", "cost");
  const iDisc = col("discontinued");
  let next = book;
  let updated = 0;
  let added = 0;
  const errors = [];
  for (let r = 1; r < lines.length; r += 1) {
    const cells = parseCsvLine(lines[r]);
    const code = normalizeCode(cells[iCode]);
    if (!code) { errors.push(`Row ${r + 1}: no code.`); continue; }
    const patch = {};
    if (iName !== -1 && cells[iName]) patch.name = cells[iName];
    if (iSku !== -1 && cells[iSku]) patch.sku = cells[iSku];
    if (iPrice !== -1 && cells[iPrice]) {
      const cents = parsePriceToCents(cells[iPrice]);
      if (cents === null) { errors.push(`Row ${r + 1} (${code}): can't read price "${cells[iPrice]}".`); continue; }
      patch.priceCents = cents;
    }
    if (iDisc !== -1 && cells[iDisc]) patch.discontinued = /^(y|yes|true|1|x)$/i.test(cells[iDisc]);
    if (findItem(next, code)) {
      next = updateItem(next, code, patch);
      updated += 1;
    } else {
      next = addItem(next, { code, kind: inferItemKind(code), name: patch.name, sku: patch.sku, priceCents: patch.priceCents, discontinued: patch.discontinued });
      added += 1;
    }
  }
  return { book: next, updated, added, errors };
}

export function exportPriceCsv(book) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["code", "name", "item number", "price", "discontinued"].map(q).join(",")];
  for (const i of book.items) {
    rows.push([i.code, i.name, i.sku, i.priceCents == null ? "" : (i.priceCents / 100).toFixed(2), i.discontinued ? "yes" : ""].map(q).join(","));
  }
  return `${rows.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Pricing placed cabinets and the kitchen cabinet estimate
// ---------------------------------------------------------------------------

/**
 * How a placed piece prices against a book:
 *   { code, status: "priced" | "discontinued" | "no-price" | "not-in-list" | "not-a-cabinet", item }
 */
export function priceCabinet(book, piece) {
  const code = cabinetCode(piece);
  if (!code) return { code: null, status: "not-a-cabinet", item: null };
  const item = book ? findItem(book, code) : null;
  if (!item) return { code, status: "not-in-list", item: null };
  if (item.discontinued) return { code, status: "discontinued", item };
  if (item.priceCents == null) return { code, status: "no-price", item };
  return { code, status: "priced", item };
}

/**
 * Kitchen cabinet estimate for every cabinet in a design against a book.
 * Priced cabinets are grouped by code (qty x unit). Cabinets that can't be
 * priced are listed as issues (never silently $0). Accessories use the
 * quantities entered on the estimate ({ [code]: qty }).
 */
export function cabinetEstimate(design, book, accessoryQty = {}) {
  const groups = new Map();
  const issues = new Map();
  for (const piece of design?.furniture || []) {
    const priced = priceCabinet(book, piece);
    if (priced.status === "not-a-cabinet") continue;
    if (priced.status === "priced") {
      const g = groups.get(priced.code) || { code: priced.code, name: priced.item.name, sku: priced.item.sku, unitCents: priced.item.priceCents, qty: 0 };
      g.qty += 1;
      groups.set(priced.code, g);
    } else {
      const k = `${priced.code}|${priced.status}`;
      const g = issues.get(k) || { code: priced.code, status: priced.status, name: priced.item?.name || "", qty: 0 };
      g.qty += 1;
      issues.set(k, g);
    }
  }
  const lines = [...groups.values()]
    .map((g) => ({ ...g, extCents: g.qty * g.unitCents }))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const accessories = (book?.items || [])
    .filter((i) => i.kind === "accessory")
    .map((i) => {
      const qty = Math.max(0, Math.floor(Number(accessoryQty?.[i.code]) || 0));
      const usable = !i.discontinued && i.priceCents != null;
      return { code: i.code, name: i.name, sku: i.sku, unitCents: i.priceCents, qty, discontinued: !!i.discontinued, extCents: usable ? qty * i.priceCents : 0 };
    });
  const cabinetsCents = lines.reduce((s, l) => s + l.extCents, 0);
  const accessoriesCents = accessories.reduce((s, a) => s + a.extCents, 0);
  return {
    bookId: book?.id || null,
    asOf: book?.asOf || "",
    lines,
    issues: [...issues.values()],
    accessories,
    cabinetsCents,
    accessoriesCents,
    totalCents: cabinetsCents + accessoriesCents,
  };
}

/** CSV of the estimate (cabinets, accessories with qty > 0, issues, total). */
export function cabinetEstimateCsv(estimate, book) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const $ = (c) => (c == null ? "" : (c / 100).toFixed(2));
  const rows = [[`Cabinet estimate — ${book ? bookLabel(book) : ""}`, `prices as of ${estimate.asOf || "?"}`].map(q).join(",")];
  rows.push(["Code", "Description", "Item number", "Qty", "Unit", "Extended"].map(q).join(","));
  for (const l of estimate.lines) rows.push([l.code, l.name, l.sku, l.qty, $(l.unitCents), $(l.extCents)].map(q).join(","));
  for (const a of estimate.accessories.filter((x) => x.qty > 0)) rows.push([a.code, a.name, a.sku, a.qty, $(a.unitCents), $(a.extCents)].map(q).join(","));
  for (const i of estimate.issues) rows.push([i.code, `NOT PRICED (${i.status})`, "", i.qty, "", ""].map(q).join(","));
  rows.push(["", "Total", "", "", "", $(estimate.totalCents)].map(q).join(","));
  return `${rows.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Saved estimates — immutable snapshots stored on the design
//
// A live estimate follows the current price list. A SAVED estimate must not:
// it records the supplier, the list's "as of" date, and every code, item
// number, quantity and unit price it used, so editing the price list later
// never silently changes an estimate already given to someone.
// ---------------------------------------------------------------------------

export const MAX_SAVED_ESTIMATES = 50;

/** Freeze an estimate (from cabinetEstimate) into a snapshot record. */
export function snapshotEstimate(estimate, book, { now = new Date(), id } = {}) {
  const savedAt = now.toISOString();
  return {
    id: id || `est-${now.getTime().toString(36)}`,
    savedAt,
    bookId: book?.id || null,
    supplier: book?.supplier || "",
    line: book?.line || "",
    asOf: estimate.asOf || "",
    lines: estimate.lines.map((l) => ({ ...l })),
    accessories: estimate.accessories.filter((a) => a.qty > 0).map((a) => ({ ...a })),
    issues: estimate.issues.map((i) => ({ ...i })),
    cabinetsCents: estimate.cabinetsCents,
    accessoriesCents: estimate.accessoriesCents,
    totalCents: estimate.totalCents,
  };
}

/** Add a snapshot to a design (newest last), keeping at most MAX_SAVED_ESTIMATES. */
export function addSavedEstimate(design, snapshot) {
  const list = [...(design.cabinetEstimates || []), snapshot].slice(-MAX_SAVED_ESTIMATES);
  return { ...design, cabinetEstimates: list };
}

export function removeSavedEstimate(design, snapshotId) {
  return { ...design, cabinetEstimates: (design.cabinetEstimates || []).filter((s) => s.id !== snapshotId) };
}
