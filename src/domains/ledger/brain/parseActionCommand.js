/**
 * parseActionCommand
 *
 * Deterministic natural-language parsing for FORGE Brain's conversational
 * actions. No LLM calls: fixed pattern matching only, so commands cost zero
 * tokens. Companion to parseLedgerQuery (which answers questions); this one
 * recognizes *action* intents that mutate the books, always behind the human
 * gate (see the actions API route).
 *
 * parseActionCommand(text) ->
 *   { intent: "categorize", category, selector } |
 *   { intent: "apply_suggestion", selector } |
 *   { intent: "mark_transfer", selector } |
 *   { intent: "dismiss_anomaly", selector } |
 *   { unparseable: true, hint }
 *
 * selector: { scope: "all" | "matched", text: string | null,
 *             amount: { op: "eq"|"lt"|"lte"|"gt"|"gte", value } | null }
 *   "all"   -- the user's words named every candidate ("all", "everything",
 *              "uncategorized", "ambiguous", "these", "those", "them").
 *   "matched" -- a description fragment and/or amount filter narrows the set.
 * Never guesses: anything outside the grammar returns { unparseable: true }.
 */

export const ACTION_HINT =
  "Try: 'categorize Shell transactions as fuel', 'apply suggestions for uncategorized', " +
  "'mark transfer for the Fidelity legs', or 'dismiss the high duplicate alert'.";

const CATEGORIZE_LEAD = /^(categorize|categorise|label|tag)\b/i;
const APPLY_LEAD = /^(apply|use)\b/i;
const MARK_TRANSFER_LEAD = /^mark\b/i;
const DISMISS_LEAD = /^(dismiss|ignore|clear|acknowledge)\b/i;

// Natural words -> normalized_category slug. Covers the ledger's common
// vocabulary; anything already slug-shaped passes through unchanged.
const CATEGORY_SYNONYMS = Object.freeze({
  dining: "dining_drinks",
  food: "dining_drinks",
  restaurant: "dining_drinks",
  restaurants: "dining_drinks",
  drinks: "dining_drinks",
  coffee: "dining_drinks",
  groceries: "groceries",
  grocery: "groceries",
  gas: "fuel",
  fuel: "fuel",
  car: "auto_transport",
  auto: "auto_transport",
  transport: "auto_transport",
  transportation: "auto_transport",
  travel: "travel",
  flight: "travel",
  flights: "travel",
  hotel: "travel",
  hotels: "travel",
  home: "home",
  rent: "rent",
  rental: "rent",
  mortgage: "mortgage_payment",
  utilities: "utilities",
  utility: "utilities",
  electric: "utilities",
  electricity: "utilities",
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
  pharmacy: "healthcare",
  insurance: "insurance",
  salary: "salary",
  paycheck: "salary",
  transfer: "internal_transfer",
  transfers: "internal_transfer",
  distribution: "owner_distribution",
  distributions: "owner_distribution",
  loan: "loan_payment",
  uncategorized: "other",
  other: "other",
});

const ALL_SCOPE_WORDS = new Set([
  "all",
  "everything",
  "uncategorized",
  "ambiguous",
  "these",
  "those",
  "them",
  "every",
]);

const FILLER_WORDS = new Set([
  "the",
  "a",
  "an",
  "my",
  "for",
  "of",
  "to",
  "and",
  "or",
  "in",
  "on",
  "from",
  "with",
  "please",
  "rows",
  "row",
  "transactions",
  "transaction",
  "charges",
  "charge",
  "items",
  "item",
  "entries",
  "entry",
  "alert",
  "alerts",
  "anomaly",
  "anomalies",
]);

function normalizeSlug(phrase) {
  return String(phrase ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolveCategory(phrase) {
  const slug = normalizeSlug(phrase);
  if (!slug) return null;
  return CATEGORY_SYNONYMS[slug] ?? slug;
}

function parseAmountFilter(text) {
  // Matches "$500", "500", "under $100", "over $1000", "< 50", "> 2000".
  const match = /(under|below|less than|over|above|more than|greater than|<|>|<=|>=)?\s*\$?\s*(\d+(?:\.\d{1,2})?)/i.exec(
    text ?? "",
  );
  if (!match) return { rest: text, amount: null };
  const [, word, raw] = match;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return { rest: text, amount: null };
  const lowered = (word ?? "").toLowerCase();
  const op =
    lowered === "under" || lowered === "below" || lowered === "less than" || lowered === "<" || lowered === "<="
      ? lowered === "<=" ? "lte" : "lt"
      : lowered === "over" || lowered === "above" || lowered === "more than" || lowered === "greater than" || lowered === ">" || lowered === ">="
        ? lowered === ">=" ? "gte" : "gt"
        : "eq";
  const rest = text.replace(match[0], " ").replace(/\s+/g, " ").trim();
  return { rest, amount: { op, value } };
}

function parseSelector(raw) {
  const { rest, amount } = parseAmountFilter(raw ?? "");
  const words = String(rest ?? "")
    .toLowerCase()
    .split(/[^a-z0-9$]+/)
    .filter((word) => word && !FILLER_WORDS.has(word) && word !== "$");
  if (words.length === 0) {
    return { scope: "all", text: null, amount };
  }
  if (words.length === 1 && ALL_SCOPE_WORDS.has(words[0])) {
    return { scope: "all", text: null, amount };
  }
  return { scope: "matched", text: words.join(" "), amount };
}

function parseCategorize(text) {
  // "categorize <selector> as <category>" -- the "as <category>" tail is required.
  const asMatch = /\bas\s+([a-z0-9][a-z0-9 _-]*)\s*$/i.exec(text);
  if (!asMatch) return { unparseable: true, hint: ACTION_HINT };
  const category = resolveCategory(asMatch[1]);
  if (!category) return { unparseable: true, hint: ACTION_HINT };
  const head = text.slice(0, asMatch.index);
  const selectorText = head.replace(CATEGORIZE_LEAD, "").trim();
  return { intent: "categorize", category, selector: parseSelector(selectorText) };
}

function parseApplySuggestion(text) {
  // "apply suggestion(s)" / "use suggestion(s)" [+ optional selector].
  const rest = text.replace(APPLY_LEAD, "").replace(/\bsuggestions?\b/i, "").trim();
  return { intent: "apply_suggestion", selector: parseSelector(rest) };
}

function parseMarkTransfer(text) {
  // "mark <selector> as transfer(s)" / "mark transfer(s) <selector>".
  const withoutMark = text.replace(MARK_TRANSFER_LEAD, "").trim();
  const asTransfer = /\bas\s+transfers?\s*$/i.exec(withoutMark);
  const leadTransfer = /^transfers?\b/i.exec(withoutMark);
  let selectorText;
  if (asTransfer) {
    selectorText = withoutMark.slice(0, asTransfer.index).trim();
  } else if (leadTransfer) {
    selectorText = withoutMark.replace(/^transfers?\b/i, "").trim();
  } else {
    return { unparseable: true, hint: ACTION_HINT };
  }
  return { intent: "mark_transfer", selector: parseSelector(selectorText) };
}

function parseDismissAnomaly(text) {
  // "dismiss <selector>" where selector may name a severity ("high"),
  // a type ("duplicate", "spike", "drift", "new payee"), or be empty (all).
  const rest = text
    .replace(DISMISS_LEAD, "")
    .replace(/\b(anomal(y|ies)|alerts?)\b/gi, "")
    .trim();
  return { intent: "dismiss_anomaly", selector: parseSelector(rest) };
}

export function parseActionCommand(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { unparseable: true, hint: ACTION_HINT };

  if (CATEGORIZE_LEAD.test(trimmed)) return parseCategorize(trimmed);
  if (APPLY_LEAD.test(trimmed) && /\bsuggestions?\b/i.test(trimmed)) return parseApplySuggestion(trimmed);
  if (MARK_TRANSFER_LEAD.test(trimmed) && /\btransfers?\b/i.test(trimmed)) return parseMarkTransfer(trimmed);
  if (DISMISS_LEAD.test(trimmed)) return parseDismissAnomaly(trimmed);

  return { unparseable: true, hint: ACTION_HINT };
}
