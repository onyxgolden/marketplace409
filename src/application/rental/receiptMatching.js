// Deterministic receipt → vendor-bill auto-matching. NO AI, NO network:
// a pure function of (receipt, bills, vendor names). Rentec parity R26.
//
// Scoring (0–100), weights chosen so no single signal dominates:
//   - amount equality: 45 — the receipt total must match the bill balance.
//     A difference of more than 1% (or more than $1 on tiny bills) is a
//     hard penalty: the match is flagged "amount differs" and can never
//     clear the suggestion threshold.
//   - vendor-name similarity: 35 — exact normalized match scores 1.0,
//     one-side containment 0.9, otherwise token Jaccard.
//   - date proximity: 20 — bill_date within ±30 days of the receipt date,
//     decaying linearly; outside the window scores 0.
// A bill suggests only at confidence >= 60 with amount within tolerance.
export const MATCH_AMOUNT_TOLERANCE_RATIO = 0.01;
export const MATCH_AMOUNT_TOLERANCE_MIN_CENTS = 100;
export const MATCH_DATE_WINDOW_DAYS = 30;
export const MATCH_SUGGEST_THRESHOLD = 60;
export const MATCH_AMOUNT_WEIGHT = 45;
export const MATCH_VENDOR_WEIGHT = 35;
export const MATCH_DATE_WEIGHT = 20;

const STOP_WORDS = new Set([
  "the", "and", "co", "company", "inc", "incorporated", "llc", "ltd", "limited",
  "corp", "corporation", "services", "service", "group", "enterprises", "enterprise",
  "of", "a", "an", "dba",
]);

export function normalizeVendorName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function vendorNameTokens(value) {
  return normalizeVendorName(value)
    .split(" ")
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));
}

// 0–1 similarity between two vendor name strings. Deterministic; no model.
export function vendorNameSimilarity(a, b) {
  const na = normalizeVendorName(a);
  const nb = normalizeVendorName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const ta = vendorNameTokens(a);
  const tb = vendorNameTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setB = new Set(tb);
  let intersection = 0;
  for (const token of new Set(ta)) {
    if (setB.has(token)) intersection += 1;
  }
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : intersection / union;
}

const MS_PER_DAY = 86_400_000;

export function dateProximityDays(a, b) {
  if (!a || !b) return null;
  const da = Date.parse(`${a}T00:00:00.000Z`);
  const db = Date.parse(`${b}T00:00:00.000Z`);
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round(Math.abs(da - db) / MS_PER_DAY);
}

// Score one receipt against one open/partial bill. Returns the confidence
// (0–100), the component scores, and human-readable reasons.
export function scoreReceiptBillMatch(receipt, bill, billVendorName) {
  const reasons = [];
  const receiptName = receipt?.vendor_id ? billVendorName : receipt?.vendor_name_hint;

  // Vendor-name similarity (35).
  const similarity = vendorNameSimilarity(receiptName, billVendorName);
  const vendorScore = similarity * MATCH_VENDOR_WEIGHT;
  if (similarity >= 1) reasons.push("Vendor name matches exactly.");
  else if (similarity >= 0.9) reasons.push("Vendor name matches closely.");
  else if (similarity >= 0.5) reasons.push("Vendor name partially matches.");
  else reasons.push("Vendor name does not match well.");

  // Amount equality (45). The balance owed is what the receipt would pay.
  const receiptCents = Number(receipt?.amount_cents);
  const billBalance = Number(bill?.amount_cents) - Number(bill?.paid_amount_cents || 0);
  const tolerance = Math.max(MATCH_AMOUNT_TOLERANCE_MIN_CENTS, Math.round(receiptCents * MATCH_AMOUNT_TOLERANCE_RATIO));
  const amountDiff = Math.abs(receiptCents - billBalance);
  const amountMatches = Number.isSafeInteger(receiptCents) && Number.isSafeInteger(billBalance)
    && receiptCents > 0 && billBalance > 0 && amountDiff <= tolerance;
  let amountScore = 0;
  if (amountMatches) {
    amountScore = MATCH_AMOUNT_WEIGHT;
    reasons.push(amountDiff === 0 ? "Amount matches the bill balance exactly." : "Amount is within rounding tolerance of the bill balance.");
  } else {
    reasons.push(
      `Amount differs from the bill balance by ${formatCentsShort(amountDiff)} — match is not suggested.`
    );
  }

  // Date proximity (20).
  const daysApart = dateProximityDays(receipt?.receipt_date, bill?.bill_date);
  let dateScore = 0;
  if (daysApart === null) {
    reasons.push("A missing date could not be compared.");
  } else if (daysApart <= MATCH_DATE_WINDOW_DAYS) {
    dateScore = Math.round(MATCH_DATE_WEIGHT * (1 - daysApart / (MATCH_DATE_WINDOW_DAYS + 1)));
    reasons.push(daysApart === 0 ? "Receipt date matches the bill date." : `Receipt is ${daysApart} day${daysApart === 1 ? "" : "s"} from the bill date.`);
  } else {
    reasons.push(`Receipt is ${daysApart} days from the bill date — outside the ${MATCH_DATE_WINDOW_DAYS}-day window.`);
  }

  const confidence = Math.round(vendorScore + amountScore + dateScore);
  const suggested = amountMatches && confidence >= MATCH_SUGGEST_THRESHOLD;
  if (!suggested && amountMatches) reasons.push("Below the suggestion threshold — review before applying.");
  return {
    billId: bill?.id,
    confidence,
    suggested,
    components: {
      vendorScore: Math.round(vendorScore),
      amountScore: Math.round(amountScore),
      dateScore: Math.round(dateScore),
    },
    reasons,
  };
}

function formatCentsShort(cents) {
  if (!Number.isSafeInteger(cents)) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

// Rank a receipt's open/partial bills by confidence. `bills` are bill rows,
// `vendorNames` maps vendor_id → vendor name. Only bills with
// status 'open'/'partial' are considered (paid/voided never suggest).
// Returns at most `limit` results, best first.
export function rankBillMatches(receipt, bills, vendorNames, { limit = 5 } = {}) {
  const names = vendorNames instanceof Map ? vendorNames : new Map(Object.entries(vendorNames || {}));
  return (bills || [])
    .filter((bill) => bill && (bill.status === "open" || bill.status === "partial"))
    .map((bill) => scoreReceiptBillMatch(receipt, bill, names.get(bill.vendor_id) || ""))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, Math.max(1, limit));
}
