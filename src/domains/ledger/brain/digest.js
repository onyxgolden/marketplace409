/**
 * digest.js
 *
 * FORGE Brain slice 5: the Brain digest for the morning briefing.
 *
 * Pure, deterministic, no LLM calls, read-only. Assembles the outputs of the
 * earlier Brain slices (anomalies, cash-flow forecast, auto-categorization
 * backlog, budget variance) into a compact, ranked digest: the top items
 * worth a human's attention this morning. The briefing reads these precomputed
 * facts instead of spending reasoning passes re-deriving them.
 *
 * buildBrainDigest({ anomalies, forecast, pendingSuggestions, budgetOverruns, now })
 *   anomalies: detectAnomalies() alerts [{ type, severity, title, detail }]
 *   forecast: forecastCashFlow() result (uses .warnings: [{ type: "shortfall"|"tight",
 *     accountName, date, projectedBalance, daysFromStart }])
 *   pendingSuggestions: number of transactions still waiting on a category
 *   budgetOverruns: [{ label, overAmountCents, month }] (month "YYYY-MM")
 *   now: Date | ISO string | ms timestamp; injectable for tests
 * -> { generatedAt, items: [{ severity, kind, summary, pointer }] } (max 5)
 *
 * Ranking: cash shortfalls > anomalies (their own high->low order) >
 * budget overruns > uncategorized backlog > tight-cash warnings.
 *
 * renderDigestText(digest) -> the plain-text lines the briefing carries.
 */

const MAX_ITEMS = 5;

const SEVERITY_TAG = Object.freeze({
  high: "HIGH",
  medium: "MED",
  low: "LOW",
});

function toDateOnly(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function formatShortDate(dateOnly) {
  if (!dateOnly) return "soon";
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const parts = dateOnly.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return dateOnly;
  return `${months[parts[1] - 1]} ${parts[2]}`;
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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function shortfallItems(warnings) {
  return asArray(warnings)
    .filter((w) => w && w.type === "shortfall")
    .map((w) => ({
      severity: "high",
      kind: "cash-shortfall",
      summary:
        `${w.accountName ?? "An account"} projected negative on ${formatShortDate(w.date)}` +
        ` (${w.daysFromStart ?? "?"}d out) at ${formatMoney(w.projectedBalance)}`,
      pointer: "/forge/financial",
    }));
}

function anomalyItems(alerts) {
  // detectAnomalies already ranks high -> low; keep that order.
  return asArray(alerts)
    .filter((a) => a && a.title)
    .map((a) => ({
      severity: ["high", "medium", "low"].includes(a.severity) ? a.severity : "low",
      kind: `anomaly-${a.type ?? "unknown"}`,
      summary: a.detail ? `${a.title} — ${a.detail}` : String(a.title),
      pointer: "/forge/financial",
    }));
}

function overrunItems(overruns) {
  return asArray(overruns)
    .filter((o) => o && Number.isFinite(Number(o.overAmountCents)) && Number(o.overAmountCents) > 0)
    .map((o) => ({
      severity: "medium",
      kind: "budget-overrun",
      summary: `${o.label ?? "A budget line"} ${formatMoney(Number(o.overAmountCents) / 100)} over plan${o.month ? ` for ${o.month}` : ""}`,
      pointer: "/forge/budget",
    }));
}

function backlogItem(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return null;
  return {
    severity: "low",
    kind: "uncategorized",
    summary: `${n} transaction${n === 1 ? "" : "s"} still need${n === 1 ? "s" : ""} a category`,
    pointer: "/forge/connections",
  };
}

function tightItems(warnings) {
  return asArray(warnings)
    .filter((w) => w && w.type === "tight")
    .map((w) => ({
      severity: "low",
      kind: "cash-tight",
      summary:
        `${w.accountName ?? "An account"} dips under the safety buffer on ${formatShortDate(w.date)}` +
        ` (${w.daysFromStart ?? "?"}d out)`,
      pointer: "/forge/financial",
    }));
}

export function buildBrainDigest({
  anomalies = [],
  forecast = null,
  pendingSuggestions = 0,
  budgetOverruns = [],
  now,
} = {}) {
  const warnings = asArray(forecast?.warnings);
  const items = [
    ...shortfallItems(warnings),
    ...anomalyItems(anomalies),
    ...overrunItems(budgetOverruns),
    ...(backlogItem(pendingSuggestions) ? [backlogItem(pendingSuggestions)] : []),
    ...tightItems(warnings),
  ].slice(0, MAX_ITEMS);

  return Object.freeze({
    generatedAt: toDateOnly(now ?? Date.now()) ?? toDateOnly(Date.now()),
    items: Object.freeze(items.map((item) => Object.freeze({ ...item }))),
  });
}

export function renderDigestText(digest) {
  const items = asArray(digest?.items);
  const header = "FORGE Brain digest";
  if (items.length === 0) {
    return `${header}: all quiet — no shortfalls, anomalies, or overruns.`;
  }
  const lines = items.map((item) => {
    const tag = SEVERITY_TAG[item.severity] ?? "LOW";
    return `[${tag}] ${item.summary} (${item.pointer})`;
  });
  return [header, ...lines].join("\n");
}
