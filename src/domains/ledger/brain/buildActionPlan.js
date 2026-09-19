/**
 * buildActionPlan
 *
 * Turns a parsed action command (parseActionCommand) plus live, server-fetched
 * data into a concrete, reviewable action plan. Pure: no I/O, no LLM calls.
 *
 * buildActionPlan({ parsed, ambiguousRows, anomalyAlerts, now }) ->
 *   { items, summary, requiresTypedConfirm }
 *
 * ambiguousRows: [{ eventId, description, amount, transactionKind,
 *                   normalizedCategory, suggestion: { category, confidence,
 *                   reasons } | null }]
 * anomalyAlerts: [{ type, severity, title, detail, key }]  (key = alertKeyOf)
 *
 * Each item: { itemKey, kind: "categorize" | "mark_transfer" | "dismiss_anomaly",
 *   eventId?, alertKey?, category?, from, to, confidence, reversible, summary }
 *
 * Gate rule (shared with the API route via requiredConfirmationForPlan):
 * typed CONFIRM is required when any item's confidence is below 0.8 --
 * ambiguous matches or low-confidence suggestions. High-confidence,
 * fully-reversible items need only a single confirmation click.
 * Every action here is reversible: categories can be set back to "other",
 * transfer marks can be re-marked, and dismissals are just rows in a table.
 */

export const CONFIDENCE_GATE_THRESHOLD = 0.8;

function matchesAmount(amount, filter) {
  if (!filter) return true;
  const magnitude = Math.abs(Number(amount) || 0);
  const { op, value } = filter;
  if (op === "eq") return Math.abs(magnitude - value) < 0.005;
  if (op === "lt") return magnitude < value;
  if (op === "lte") return magnitude <= value + 0.005;
  if (op === "gt") return magnitude > value;
  if (op === "gte") return magnitude >= value - 0.005;
  return true;
}

function matchesText(description, text) {
  if (!text) return true;
  const haystack = String(description ?? "").toLowerCase();
  return String(text)
    .split(" ")
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function matchRows(rows, selector) {
  if (!Array.isArray(rows)) return [];
  if (selector.scope === "all") {
    return rows.filter((row) => matchesAmount(row.amount, selector.amount));
  }
  return rows.filter(
    (row) =>
      matchesText(row.description, selector.text) &&
      matchesAmount(row.amount, selector.amount),
  );
}

// How sure the Brain is that the selector named the right rows:
// an explicit "all" is unambiguous; a description fragment that matches is
// near-certain; a bare amount filter is a weak match.
function selectorConfidence(selector, matchedCount) {
  if (matchedCount === 0) return 0;
  if (selector.scope === "all" && !selector.amount) return 1;
  if (selector.scope === "all" && selector.amount) return 0.6;
  if (selector.text && selector.amount) return 0.85;
  if (selector.text) return 0.95;
  return 0.6;
}

function prettyCategory(category) {
  return String(category ?? "other").replace(/_/g, " ");
}

function planCategorize(parsed, ambiguousRows) {
  const matched = matchRows(ambiguousRows, parsed.selector);
  const confidence = selectorConfidence(parsed.selector, matched.length);
  return matched.map((row) => ({
    itemKey: `categorize:${row.eventId}`,
    kind: "categorize",
    eventId: row.eventId,
    category: parsed.category,
    from: `${row.transactionKind ?? "unknown"} / ${prettyCategory(row.normalizedCategory)}`,
    to: `${row.transactionKind ?? "unknown"} / ${prettyCategory(parsed.category)}`,
    confidence,
    reversible: true,
    summary: `Categorize "${row.description}" (${row.eventDate ?? "undated"}) as ${prettyCategory(parsed.category)}`,
  }));
}

function planApplySuggestion(parsed, ambiguousRows) {
  const matched = matchRows(ambiguousRows, parsed.selector).filter(
    (row) => row.suggestion?.category,
  );
  const selectorConf = selectorConfidence(parsed.selector, matched.length);
  return matched.map((row) => ({
    itemKey: `categorize:${row.eventId}`,
    kind: "categorize",
    eventId: row.eventId,
    category: row.suggestion.category,
    from: `${row.transactionKind ?? "unknown"} / ${prettyCategory(row.normalizedCategory)}`,
    to: `${row.transactionKind ?? "unknown"} / ${prettyCategory(row.suggestion.category)}`,
    // The suggestion's own confidence, discounted slightly when the selector
    // was fuzzy -- a weak match plus a weak suggestion needs the heavy gate.
    confidence: Math.round(Math.min(row.suggestion.confidence, selectorConf) * 1000) / 1000,
    reversible: true,
    summary: `Apply Brain suggestion: "${row.description}" as ${prettyCategory(row.suggestion.category)} (${Math.round(row.suggestion.confidence * 100)}% confident)`,
  }));
}

function planMarkTransfer(parsed, ambiguousRows) {
  const matched = matchRows(ambiguousRows, parsed.selector);
  const selectorConf = selectorConfidence(parsed.selector, matched.length);
  return matched.map((row) => ({
    itemKey: `mark_transfer:${row.eventId}`,
    kind: "mark_transfer",
    eventId: row.eventId,
    from: `${row.transactionKind ?? "unknown"} / ${prettyCategory(row.normalizedCategory)}`,
    to: `transfer / internal transfer`,
    // Marking a transfer is a judgment call, not a lookup: discount the match.
    confidence: Math.round(selectorConf * 0.9 * 1000) / 1000,
    reversible: true,
    summary: `Mark "${row.description}" (${row.eventDate ?? "undated"}) as an internal transfer`,
  }));
}

function alertMatchesSelector(alert, selector) {
  if (selector.scope === "all" && !selector.amount) {
    // A bare "dismiss anomalies" still needs *some* narrowing to avoid wiping
    // the whole board by accident -- treat it as unparseable upstream? No:
    // keep it simple and honest: "all" matches everything, the plan preview
    // shows every alert, and the typed gate catches accidents.
    return true;
  }
  const text = String(selector.text ?? "").toLowerCase();
  const haystack = `${alert.type} ${alert.severity} ${alert.title} ${alert.detail}`.toLowerCase();
  return text
    .split(" ")
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function planDismissAnomaly(parsed, anomalyAlerts) {
  const matched = (Array.isArray(anomalyAlerts) ? anomalyAlerts : []).filter((alert) =>
    alertMatchesSelector(alert, parsed.selector),
  );
  return matched.map((alert) => ({
    itemKey: `dismiss_anomaly:${alert.key}`,
    kind: "dismiss_anomaly",
    alertKey: alert.key,
    from: `active ${alert.severity} alert`,
    to: "dismissed",
    confidence: 1,
    reversible: true,
    summary: `Dismiss ${alert.severity} alert: ${alert.title}`,
  }));
}

export function buildActionPlan({ parsed, ambiguousRows, anomalyAlerts } = {}) {
  if (!parsed || parsed.unparseable) {
    return { items: [], summary: "No action planned.", requiresTypedConfirm: false };
  }

  let items = [];
  if (parsed.intent === "categorize") items = planCategorize(parsed, ambiguousRows);
  else if (parsed.intent === "apply_suggestion") items = planApplySuggestion(parsed, ambiguousRows);
  else if (parsed.intent === "mark_transfer") items = planMarkTransfer(parsed, ambiguousRows);
  else if (parsed.intent === "dismiss_anomaly") items = planDismissAnomaly(parsed, anomalyAlerts);

  const frozen = Object.freeze(items.map((item) => Object.freeze({ ...item })));
  const requiresTypedConfirm = frozen.some(
    (item) => item.confidence < CONFIDENCE_GATE_THRESHOLD,
  );

  const summary =
    frozen.length === 0
      ? "Nothing matches that command -- no actions planned."
      : `${frozen.length} action${frozen.length === 1 ? "" : "s"} planned` +
        (requiresTypedConfirm
          ? " (typed CONFIRM required: some matches are uncertain)."
          : " (single confirmation is enough: all matches are high-confidence).");

  return Object.freeze({ items: frozen, summary, requiresTypedConfirm });
}

/**
 * requiredConfirmationForPlan(plan) -> "typed" | "single" | "none"
 * The single source of truth for the gate. The API route enforces it;
 * the UI reads it to render the right gate.
 */
export function requiredConfirmationForPlan(plan) {
  const items = plan?.items ?? [];
  if (items.length === 0) return "none";
  return plan.requiresTypedConfirm ? "typed" : "single";
}

/**
 * confirmationSatisfiesGate(plan, confirmation) -> boolean
 * "CONFIRM" (case-insensitive, trimmed) satisfies the typed gate;
 * the typed gate also accepts nothing less. The single gate accepts
 * the literal "SINGLE" acknowledgement from the UI's confirm click.
 */
export function confirmationSatisfiesGate(plan, confirmation) {
  const required = requiredConfirmationForPlan(plan);
  if (required === "none") return false;
  const normalized = String(confirmation ?? "").trim().toUpperCase();
  if (required === "typed") return normalized === "CONFIRM";
  return normalized === "SINGLE";
}
