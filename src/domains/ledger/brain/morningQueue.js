/**
 * morningQueue.js
 *
 * UX slice 1: the morning-queue inbox.
 *
 * Pure, deterministic, no LLM calls, read-only. Merges the Brain's existing
 * read outputs into one ranked work queue for the morning:
 *   1. uncategorized transactions (ambiguous rows, with the auto-categorizer's
 *      suggestion attached where one exists)
 *   2. anomaly alerts (the detector's own severity order)
 *   3. upcoming bills (outbound recurring patterns due soon)
 *   4. budget overruns (current month, worst first)
 *
 * buildMorningQueue({ ambiguousRows, alerts, bills, overruns, now })
 *   ambiguousRows: reconcile-transfers GET entries
 *     [{ eventId, eventDate, amount, description, side, reason, suggestion }]
 *     suggestion: { category, confidence, reasons } | null
 *   alerts: anomalies GET entries [{ type, severity, title, detail, key, evidence }]
 *   bills: upcoming outbound recurring patterns
 *     [{ accountName, category, cadence, medianAmount, nextExpectedDate }]
 *   overruns: [{ label, overAmountCents, month }]
 *   now: Date | ISO string | ms timestamp; injectable for tests
 * -> { generatedAt, items, counts: { total, uncategorized, anomaly, bill, overrun } }
 *
 * Every item: { id, kind, severity, title, detail, pointer, payload }.
 * - ids are stable within a kind ("uncategorized:<eventId>",
 *   "anomaly:<key>", "bill:<fingerprint>", "overrun:<month>:<label>").
 * - pointers are deep links to the screen that owns the detail.
 * - payload carries the kind-specific source record the UI needs to act.
 *
 * Dedup: an item appearing in two sources shows once. Within a kind, ids are
 * unique. Across kinds, an uncategorized row whose eventId appears in a
 * duplicate-charge alert's evidence.postingIds is dropped -- the anomaly is
 * the higher-signal representation of the same money.
 *
 * The result is frozen and JSON-serializable; it never throws on empty or
 * malformed inputs (garbage in is skipped, not fatal).
 */

const KIND_ORDER = Object.freeze({
  uncategorized: 0,
  anomaly: 1,
  bill: 2,
  overrun: 3,
});

const SEVERITY_RANK = Object.freeze({ high: 0, medium: 1, low: 2 });

function toMs(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const time = Date.parse(String(value));
  return Number.isNaN(time) ? null : time;
}

function toDateOnly(value) {
  if (value == null) return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function formatMoney(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "$?";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatShortDate(dateOnly) {
  const text = toDateOnly(dateOnly);
  if (!text) return "soon";
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const [y, m, d] = text.split("-").map(Number);
  if (!y || !m || !d) return text;
  return `${months[m - 1]} ${d}`;
}

function freezeItem(item) {
  return Object.freeze({
    ...item,
    payload: item.payload != null && typeof item.payload === "object"
      ? Object.freeze(item.payload)
      : item.payload,
  });
}

function uncategorizedItem(row) {
  const eventId = String(row?.eventId ?? "").trim();
  if (!eventId) return null;
  const suggestion = row?.suggestion ?? null;
  const category = typeof suggestion?.category === "string" ? suggestion.category : null;
  return freezeItem({
    id: `uncategorized:${eventId}`,
    kind: "uncategorized",
    severity: "medium",
    title: `Uncategorized: ${row?.description ?? "transaction"}`,
    detail: category
      ? `${formatMoney(row?.amount)} on ${formatShortDate(row?.eventDate)} · suggested: ${category.replace(/_/g, " ")}`
      : `${formatMoney(row?.amount)} on ${formatShortDate(row?.eventDate)} · no suggestion yet`,
    pointer: "/forge/connections",
    payload: {
      eventId,
      eventDate: toDateOnly(row?.eventDate),
      amount: Number(row?.amount) || 0,
      description: row?.description ?? "",
      suggestionCategory: category,
      suggestionConfidence: typeof suggestion?.confidence === "number" ? suggestion.confidence : null,
    },
    rankAmount: Math.abs(Number(row?.amount) || 0),
  });
}

function anomalyItem(alert) {
  const key = typeof alert?.key === "string" && alert.key ? alert.key : null;
  if (!key || typeof alert?.title !== "string") return null;
  return freezeItem({
    id: `anomaly:${key}`,
    kind: "anomaly",
    severity: alert?.severity === "high" || alert?.severity === "medium" ? alert.severity : "low",
    title: alert.title,
    detail: typeof alert?.detail === "string" ? alert.detail : "",
    pointer: "/forge/financial",
    payload: {
      alertKey: key,
      type: alert?.type ?? "unknown",
    },
    rankSeverity: SEVERITY_RANK[alert?.severity] ?? SEVERITY_RANK.low,
    rankMagnitude: Number(alert?.rankMagnitude) || 0,
  });
}

function billItem(bill) {
  const date = toDateOnly(bill?.nextExpectedDate);
  if (!date) return null;
  const amount = Number(bill?.medianAmount) || 0;
  const label = bill?.accountName || bill?.category?.replace(/_/g, " ") || "Recurring bill";
  return freezeItem({
    id: `bill:${label}:${date}:${Math.round(amount * 100)}`,
    kind: "bill",
    severity: "low",
    title: `${label} due ${formatShortDate(date)}`,
    detail: `${formatMoney(amount)}${bill?.cadence ? ` · ${bill.cadence}` : ""}`,
    pointer: "/forge/connections",
    payload: {
      label,
      amount,
      nextExpectedDate: date,
      cadence: bill?.cadence ?? null,
    },
    rankDate: date,
  });
}

function overrunItem(overrun) {
  const overCents = Math.round(Number(overrun?.overAmountCents) || 0);
  if (overCents <= 0) return null;
  const label = String(overrun?.label ?? "Budget line");
  const month = String(overrun?.month ?? "");
  const scope = typeof overrun?.scope === "string" && overrun.scope ? overrun.scope : null;
  return freezeItem({
    id: scope ? `overrun:${month}:${scope}:${label}` : `overrun:${month}:${label}`,
    kind: "overrun",
    severity: "medium",
    title: `Over budget: ${label}`,
    detail: `${formatMoney(overCents / 100)} over plan${month ? ` · ${month}` : ""}${scope ? ` · ${scope}` : ""}`,
    pointer: "/forge/budget",
    payload: { label, overAmountCents: overCents, month, scope },
    rankOver: overCents,
  });
}

/**
 * Event ids already represented by a duplicate-charge alert. The anomaly is
 * the higher-signal item, so the matching uncategorized rows are dropped.
 */
function duplicatePostingIds(alerts) {
  const ids = new Set();
  for (const alert of alerts ?? []) {
    if (alert?.type !== "duplicate") continue;
    const postingIds = alert?.evidence?.postingIds;
    if (Array.isArray(postingIds)) {
      for (const id of postingIds) {
        if (id != null && String(id).trim() !== "") ids.add(String(id));
      }
    }
  }
  return ids;
}

function compareItems(a, b) {
  const kindDiff = (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99);
  if (kindDiff !== 0) return kindDiff;
  switch (a.kind) {
    case "uncategorized":
      return (b.rankAmount ?? 0) - (a.rankAmount ?? 0);
    case "anomaly":
      if ((a.rankSeverity ?? 2) !== (b.rankSeverity ?? 2)) return (a.rankSeverity ?? 2) - (b.rankSeverity ?? 2);
      return (b.rankMagnitude ?? 0) - (a.rankMagnitude ?? 0);
    case "bill":
      return String(a.rankDate ?? "").localeCompare(String(b.rankDate ?? ""));
    case "overrun":
      return (b.rankOver ?? 0) - (a.rankOver ?? 0);
    default:
      return 0;
  }
}

function stripRankFields(item) {
  const { rankAmount, rankSeverity, rankMagnitude, rankDate, rankOver, ...rest } = item;
  return Object.freeze(rest);
}

export function buildMorningQueue(input = {}) {
  const alerts = Array.isArray(input.alerts) ? input.alerts : [];
  const rows = Array.isArray(input.ambiguousRows) ? input.ambiguousRows : [];
  const bills = Array.isArray(input.bills) ? input.bills : [];
  const overruns = Array.isArray(input.overruns) ? input.overruns : [];

  const coveredByDuplicate = duplicatePostingIds(alerts);

  const seen = new Set();
  const items = [];

  const pushUnique = (item) => {
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    items.push(item);
  };

  for (const row of rows) {
    const eventId = String(row?.eventId ?? "");
    if (eventId && coveredByDuplicate.has(eventId)) continue;
    pushUnique(uncategorizedItem(row));
  }
  for (const alert of alerts) pushUnique(anomalyItem(alert));
  for (const bill of bills) pushUnique(billItem(bill));
  for (const overrun of overruns) pushUnique(overrunItem(overrun));

  items.sort(compareItems);
  const clean = items.map(stripRankFields);

  const counts = {
    total: clean.length,
    uncategorized: 0,
    anomaly: 0,
    bill: 0,
    overrun: 0,
  };
  for (const item of clean) {
    if (counts[item.kind] !== undefined) counts[item.kind] += 1;
  }

  return Object.freeze({
    generatedAt: new Date(toMs(input.now) ?? Date.now()).toISOString(),
    items: Object.freeze(clean),
    counts: Object.freeze(counts),
  });
}
