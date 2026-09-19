/**
 * parseLedgerQuery
 *
 * Deterministic natural-language parsing for FORGE Brain's "Ask the books".
 * No LLM calls: fixed pattern matching only, so answers cost zero tokens.
 *
 * parseLedgerQuery(text, { now }) -> { metric, categoryFamily, period }
 *   metric: "spend" | "revenue" | "net"
 *   categoryFamily: a family string (see resolveCategoryFamily), or null for "everything"
 *   period: { startDate, endDate, label } -- inclusive, day-granularity
 * On anything that is not a ledger question: { unparseable: true }. Never guesses.
 *
 * "now" is injectable for tests; otherwise the current date in America/Chicago.
 */

import { expandMonths } from "../reports/comparativePeriods.js";
import { categoryFamilyOf } from "../../budgeting/categoryFamily.js";

// Natural words -> category family. resolveCategoryFamily() applies these to both
// the user's phrasing AND ledger account names, so "restaurants" matches an account
// named "Dining & drinks" and "rent" matches "Rent revenue".
const CATEGORY_SYNONYMS = Object.freeze({
  dining: "dining_drinks",
  food: "dining_drinks",
  restaurant: "dining_drinks",
  restaurants: "dining_drinks",
  drinks: "dining_drinks",
  coffee: "dining_drinks",
  groceries: "groceries",
  grocery: "groceries",
  gas: "auto_transport",
  fuel: "auto_transport",
  car: "auto_transport",
  auto: "auto_transport",
  transport: "auto_transport",
  transportation: "auto_transport",
  uber: "auto_transport",
  lyft: "auto_transport",
  travel: "travel",
  flight: "travel",
  flights: "travel",
  hotel: "travel",
  hotels: "travel",
  vacation: "travel",
  home: "home",
  rent: "rent",
  rental: "rent",
  mortgage: "mortgage",
  utilities: "utilities",
  utility: "utilities",
  electric: "utilities",
  electricity: "utilities",
  water: "utilities",
  internet: "utilities",
  shopping: "shopping",
  clothes: "shopping",
  clothing: "shopping",
  entertainment: "entertainment",
  movie: "entertainment",
  movies: "entertainment",
  healthcare: "healthcare",
  health: "healthcare",
  medical: "healthcare",
  doctor: "healthcare",
  dentist: "healthcare",
  pharmacy: "healthcare",
  personal: "personal_care",
  education: "education",
  school: "education",
  tuition: "education",
  salary: "salary",
  paycheck: "salary",
  wages: "salary",
  insurance: "insurance",
});

const METRIC_WORDS = new Set([
  "spend", "spent", "spending",
  "cost", "costs",
  "expense", "expenses",
  "revenue", "revenues",
  "income", "earnings", "earn", "earned",
  "net", "profit", "profits",
]);

const FILLER_WORDS = new Set([
  "what", "whats", "did", "do", "does",
  "i", "me", "my", "we", "our",
  "on", "in", "for", "from", "of", "the", "a", "an", "to", "and", "or",
  "is", "was", "were", "are", "be", "by", "at",
  "show", "tell", "give", "s",
  "how", "much", "many", "about",
  "this", "last", "next",
  "month", "months", "year", "years", "quarter", "quarters",
  "1st", "2nd", "3rd", "4th",
  "today", "yesterday",
]);

const EVERYTHING_WORDS = new Set(["everything", "total", "totals", "all", "overall"]);

const MONTH_NUMBERS = Object.freeze({
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
});

const MONTH_NAMES_PATTERN =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

function normalizePhrase(phrase) {
  return String(phrase ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Resolves a natural phrase (or a ledger account name) to a category family,
 * reusing the budgeting domain's categoryFamilyOf for the longest-root grouping.
 */
export function resolveCategoryFamily(phrase) {
  const normalized = normalizePhrase(phrase);
  if (!normalized) return null;

  if (Object.hasOwn(CATEGORY_SYNONYMS, normalized)) {
    return CATEGORY_SYNONYMS[normalized];
  }

  for (const word of normalized.split("_")) {
    if (Object.hasOwn(CATEGORY_SYNONYMS, word)) {
      return CATEGORY_SYNONYMS[word];
    }
  }

  return categoryFamilyOf(normalized);
}

function chicagoToday(now = new Date()) {
  // "09/19/2026" in America/Chicago regardless of the machine's timezone.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [month, day, year] = parts.split("/").map(Number);
  return { year, month, day };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function monthPeriod(year, month) {
  return expandMonths([`${year}-${pad2(month)}`])[0];
}

function quarterPeriod(year, quarter) {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = quarter * 3;
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  return Object.freeze({
    startDate: `${year}-${pad2(startMonth)}-01`,
    endDate: `${year}-${pad2(endMonth)}-${pad2(lastDay)}`,
    label: `Q${quarter} ${year}`,
  });
}

function yearPeriod(year) {
  return Object.freeze({
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
    label: `${year}`,
  });
}

function detectMetric(lower) {
  if (/\b(net|profits?)\b/.test(lower)) return { metric: "net", explicit: true };
  if (/\b(revenues?|income|earnings?|earned|earn)\b/.test(lower)) {
    return { metric: "revenue", explicit: true };
  }
  if (/\b(spends?|spent|spending|costs?|expenses?)\b/.test(lower)) {
    return { metric: "spend", explicit: true };
  }
  return { metric: "spend", explicit: false };
}

function detectPeriod(lower, today) {
  // Explicit range: "2026-06-01 to 2026-08-31".
  const range = /(\d{4}-\d{2}-\d{2})\s*(?:to|through|until|-)\s*(\d{4}-\d{2}-\d{2})/.exec(lower);
  if (range) {
    const [, startDate, endDate] = range;
    if (startDate <= endDate) {
      return Object.freeze({
        startDate,
        endDate,
        label: `${rangeLabel(startDate)} – ${rangeLabel(endDate)}`,
        _tokens: [range[0]],
      });
    }
  }

  // Quarters: "q2", "q2 2026", "2nd quarter", "2nd quarter 2026".
  const quarter =
    /\bq([1-4])\b(?:\s*,?\s*(\d{4}))?/.exec(lower) ||
    /\b([1-4])(?:st|nd|rd|th)\s+quarter\b(?:\s*,?\s*(\d{4}))?/.exec(lower);
  if (quarter) {
    const q = Number(quarter[1]);
    const currentQuarter = Math.ceil(today.month / 3);
    const year = quarter[2]
      ? Number(quarter[2])
      : q <= currentQuarter
        ? today.year
        : today.year - 1;
    return Object.freeze({ ...quarterPeriod(year, q), _tokens: [quarter[0]] });
  }

  // Month names: "august", "august 2026". Bare names resolve to the most recent occurrence.
  const month = new RegExp(`\\b(${MONTH_NAMES_PATTERN})\\b(?:\\s*,?\\s*(\\d{4}))?`).exec(lower);
  if (month) {
    const monthNum = MONTH_NUMBERS[month[1]];
    const year = month[2]
      ? Number(month[2])
      : monthNum <= today.month
        ? today.year
        : today.year - 1;
    return Object.freeze({ ...monthPeriod(year, monthNum), _tokens: [month[0]] });
  }

  if (/\bthis\s+month\b/.test(lower)) {
    return Object.freeze({ ...monthPeriod(today.year, today.month), _tokens: ["this month"] });
  }

  if (/\blast\s+month\b/.test(lower)) {
    const first = new Date(Date.UTC(today.year, today.month - 2, 1));
    return Object.freeze({
      ...monthPeriod(first.getUTCFullYear(), first.getUTCMonth() + 1),
      _tokens: ["last month"],
    });
  }

  if (/\bthis\s+year\b/.test(lower)) {
    return Object.freeze({ ...yearPeriod(today.year), _tokens: ["this year"] });
  }

  if (/\blast\s+year\b/.test(lower)) {
    return Object.freeze({ ...yearPeriod(today.year - 1), _tokens: ["last year"] });
  }

  return null;
}

function rangeLabel(dateOnly) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateOnly}T00:00:00Z`));
}

function tokenize(lower) {
  return lower
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Parses a natural-language ledger question. Returns
 * { metric, categoryFamily, period } or { unparseable: true }.
 */
export function parseLedgerQuery(text, { now } = {}) {
  if (typeof text !== "string" || text.trim() === "") {
    return { unparseable: true };
  }

  const lower = text.toLowerCase();
  const today = chicagoToday(now);
  const { metric, explicit: metricExplicit } = detectMetric(lower);
  const period = detectPeriod(lower, today);

  // Strip everything the parser understands; what remains is the category phrase.
  const periodTokens = new Set(
    (period?._tokens ?? []).flatMap((chunk) => tokenize(chunk)),
  );
  const tokens = tokenize(lower).filter(
    (token) =>
      !FILLER_WORDS.has(token) &&
      !METRIC_WORDS.has(token) &&
      !periodTokens.has(token) &&
      !MONTH_NUMBERS[token] &&
      !/^\d+$/.test(token) &&
      !/^q[1-4]$/.test(token),
  );

  const hasLedgerSignal =
    metricExplicit ||
    period !== null ||
    tokens.some(
      (token) =>
        Object.hasOwn(CATEGORY_SYNONYMS, token) || EVERYTHING_WORDS.has(token),
    );

  if (!hasLedgerSignal) {
    return { unparseable: true };
  }

  const categoryTokens = tokens.filter((token) => !EVERYTHING_WORDS.has(token));
  const categoryFamily =
    categoryTokens.length === 0 ? null : resolveCategoryFamily(categoryTokens.join("_"));

  const resolvedPeriod = period
    ? { startDate: period.startDate, endDate: period.endDate, label: period.label }
    : (() => {
        const current = monthPeriod(today.year, today.month);
        return { startDate: current.startDate, endDate: current.endDate, label: current.label };
      })();

  return Object.freeze({
    metric,
    categoryFamily,
    period: Object.freeze(resolvedPeriod),
  });
}
