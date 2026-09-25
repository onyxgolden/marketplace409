// Call Shield Slice B — contact labels (pure domain helpers).
//
// A label marks a phone number as "personal" (Jason's own contacts, filtered
// out of the import review queue) or "offender" (a telemarketer that called
// without permission — the saved symbol marks the number at a glance).
// Labels are keyed on the normalized phone number so they apply to every
// import row for that number, regardless of formatting.

import { normalizePhoneNumber } from "./callShieldImport";

export const LABEL_PERSONAL = "personal";
export const LABEL_OFFENDER = "offender";
export const LABELS = new Set([LABEL_PERSONAL, LABEL_OFFENDER]);
export const OFFENDER_SYMBOL_DEFAULT = "⚠";
export const IMPORT_FILTERS = ["all", "personal", "offender", "unlabeled"];

/**
 * Label key for a phone number: digits only, with a leading North American
 * country code ("1") stripped so "+1 (713) 239-9946" and "(713) 239-9946"
 * share one label. This is label-only — the import dedupe hash keeps its
 * own normalization and is untouched.
 */
export function normalizeLabelKey(raw) {
  const digits = normalizePhoneNumber(raw);
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function isValidLabel(label) {
  return LABELS.has(label);
}

export function sanitizeSymbol(symbol) {
  if (typeof symbol !== "string") return OFFENDER_SYMBOL_DEFAULT;
  const trimmed = symbol.trim().slice(0, 8);
  return trimmed || OFFENDER_SYMBOL_DEFAULT;
}

/**
 * Find the label record for a phone number (any formatting). Returns the
 * label object or null.
 */
export function labelForNumber(labels, phoneNumber) {
  if (!Array.isArray(labels)) return null;
  const normalized = normalizeLabelKey(phoneNumber);
  if (!normalized) return null;
  return labels.find((entry) => normalizeLabelKey(entry?.normalized_phone ?? entry?.phoneNumber) === normalized) || null;
}

/**
 * Filter staged import rows by label filter:
 *  all       — every row
 *  personal  — rows whose number is labeled personal
 *  offender  — rows whose number is labeled offender
 *  unlabeled — rows with no label
 */
export function applyLabelFilter(rows, labels, filter) {
  if (!Array.isArray(rows)) return [];
  if (filter === "all" || !IMPORT_FILTERS.includes(filter)) return rows;
  return rows.filter((row) => {
    const label = labelForNumber(labels, row?.phone_number ?? row?.normalized_phone);
    const kind = label?.label || null;
    if (filter === "personal") return kind === LABEL_PERSONAL;
    if (filter === "offender") return kind === LABEL_OFFENDER;
    return kind === null; // unlabeled
  });
}

/**
 * Fetch the owner's complete label set across the paginated GET endpoint.
 * Import classification (labelForNumber / applyLabelFilter) treats the label
 * array as the complete set, so a single page is not enough once labels
 * exceed the page size — page through until the server's total is covered.
 *
 * @param {(path: string) => Promise<any>} apiFn fetch-like helper returning parsed JSON
 * @param {number} pageSize rows per page (server clamps to 1000)
 */
export async function fetchAllLabels(apiFn, pageSize = 500) {
  const items = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  for (;;) {
    const data = await apiFn(`/api/call-shield/labels?page=${page}&pageSize=${pageSize}`);
    const batch = Array.isArray(data?.items) ? data.items : [];
    items.push(...batch);
    if (typeof data?.total === "number") total = data.total;
    else if (batch.length < pageSize) total = items.length;
    if (items.length >= total || batch.length < pageSize) break;
    page += 1;
    if (page > 200) break; // safety cap
  }
  return items;
}
