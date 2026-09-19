/**
 * anomalies.js
 *
 * FORGE Brain slice 3: anomaly detection over the books.
 *
 * Pure, deterministic, no LLM calls, read-only. Every alert carries its
 * evidence (numbers a human can check), so nothing here is a black box.
 *
 * detectAnomalies({ postings, recurringPatterns, now }) -> ranked alerts:
 *   [{ type, severity: "high"|"medium"|"low", title, detail, evidence }]
 *
 * postings: [{ id, description, amount, categoryFamily, date }]
 *   - amount: human convention -- outflow (spend) positive, inflow negative.
 *   - date: "YYYY-MM-DD".
 * recurringPatterns: [{ label, medianAmount, latestAmount, latestDate, cadence }]
 *   (the API layer maps detectRecurringPayments output to this shape).
 * now: Date | ISO string | ms timestamp; injectable for tests.
 *
 * Detection rules:
 *   - spend-spike: trailing-30-day spend per category family vs the mean/std of
 *     the 6 complete calendar months before the current month. Flags when the
 *     window exceeds mean + 2*std AND is at least $50 (kills tiny-category noise).
 *     Large spikes (2x+ the baseline mean) are high severity, the rest medium.
 *   - duplicate: same merchant (first significant description token), same amount
 *     within $0.01, < 7 days apart, both outflows. High severity.
 *   - recurring-drift: latest occurrence amount differs >10% from the pattern
 *     median. Medium severity.
 *   - new-payee: outflow >= $500 in the last 30 days to a merchant never seen in
 *     older history. Low severity.
 *
 * Ranked high -> low, capped at 25 alerts. Never throws on empty/short history:
 * families without enough baseline are skipped silently.
 */

import { normalizeDescriptionTokens } from "./categorize.js";

const DAY_MS = 86_400_000;
const MAX_ALERTS = 25;
const SPIKE_MINIMUM_USD = 50;
const SPIKE_STD_MULTIPLE = 2;
const SPIKE_HIGH_MULTIPLE = 2; // 2x+ the baseline mean -> high severity
const DUPLICATE_DAY_WINDOW = 7; // strictly less than 7 days apart
const DUPLICATE_AMOUNT_TOLERANCE = 0.01;
const DRIFT_THRESHOLD = 0.1; // 10% off the pattern median
const NEW_PAYEE_MINIMUM_USD = 500;
const BASELINE_MONTHS = 6;
const MIN_BASELINE_MONTHS_WITH_ACTIVITY = 3;

const SEVERITY_RANK = Object.freeze({ high: 0, medium: 1, low: 2 });

// Deterministic, stable identity for an alert across recomputations, so a
// human can dismiss an alert and have it stay dismissed. Pure: the same alert
// content always yields the same key, independent of ranking or detection
// order. Uses an fnv1a hash of the canonically-serialized evidence so keys
// stay short in the dismissals table.
function fnv1aHex(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * alertKeyOf(alert) -> string
 * Stable dismissal key: "<type>:<fnv1a of canonical evidence JSON>".
 */
export function alertKeyOf(alert) {
  const type = alert?.type ?? "unknown";
  const evidence = alert?.evidence != null && typeof alert.evidence === "object" ? alert.evidence : {};
  return `${type}:${fnv1aHex(JSON.stringify(canonicalize(evidence)))}`;
}

function parseDayMs(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(time) ? null : time;
}

function resolveNow(now) {
  if (now instanceof Date && !Number.isNaN(now.getTime())) return now.getTime();
  if (typeof now === "number" && Number.isFinite(now)) return now;
  if (typeof now === "string") {
    const parsed = Date.parse(now);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function monthKeyOf(utcMs) {
  const date = new Date(utcMs);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
}

function monthStartMs(year, monthIndex) {
  return Date.UTC(year, monthIndex, 1);
}

function monthEndExclusiveMs(year, monthIndex) {
  return Date.UTC(year, monthIndex + 1, 1);
}

// The N complete calendar months strictly before the month containing nowMs,
// oldest first: [{ key, startMs, endMs }].
function baselineMonths(nowMs, count) {
  const now = new Date(nowMs);
  const months = [];
  for (let back = count; back >= 1; back -= 1) {
    const total = now.getUTCFullYear() * 12 + now.getUTCMonth() - back;
    const year = Math.floor(total / 12);
    const monthIndex = ((total % 12) + 12) % 12;
    months.push({
      key: monthKeyOf(monthStartMs(year, monthIndex)),
      startMs: monthStartMs(year, monthIndex),
      endMs: monthEndExclusiveMs(year, monthIndex),
    });
  }
  return months;
}

function mean(numbers) {
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

function populationStd(numbers, avg) {
  const variance =
    numbers.reduce((sum, n) => sum + (n - avg) * (n - avg), 0) / numbers.length;
  return Math.sqrt(variance);
}

function roundCents(value) {
  return Math.round(Number(value) * 100) / 100;
}

// Merchant key: the first significant description token ("SHELL OIL 57444123"
// -> "shell"). Empty when the description carries no merchant signal.
function merchantKey(description) {
  const { tokens } = normalizeDescriptionTokens(description);
  return tokens.length > 0 ? tokens[0] : "";
}

function coercePostings(postings) {
  if (!Array.isArray(postings)) return [];
  return postings
    .map((posting) => {
      if (posting == null || typeof posting !== "object") return null;
      const dayMs = parseDayMs(posting.date);
      const amount = Number(posting.amount);
      if (dayMs == null || !Number.isFinite(amount)) return null;
      return {
        id: posting.id ?? null,
        description: posting.description ?? "",
        amount,
        categoryFamily: posting.categoryFamily ?? null,
        dayMs,
        date: new Date(dayMs).toISOString().slice(0, 10),
      };
    })
    .filter(Boolean);
}

function detectSpendSpikes(postings, nowMs) {
  const windowStartMs = nowMs - 30 * DAY_MS;
  const months = baselineMonths(nowMs, BASELINE_MONTHS);
  const families = new Map();

  for (const posting of postings) {
    if (posting.amount <= 0 || !posting.categoryFamily) continue;
    if (posting.dayMs > nowMs) continue;
    let family = families.get(posting.categoryFamily);
    if (!family) {
      family = {
        name: posting.categoryFamily,
        windowTotal: 0,
        monthlyTotals: months.map(() => 0),
      };
      families.set(posting.categoryFamily, family);
    }
    if (posting.dayMs > windowStartMs) {
      family.windowTotal += posting.amount;
    }
    const monthIndex = months.findIndex(
      (month) => posting.dayMs >= month.startMs && posting.dayMs < month.endMs,
    );
    if (monthIndex >= 0) {
      family.monthlyTotals[monthIndex] += posting.amount;
    }
  }

  const alerts = [];
  for (const family of families.values()) {
    const activeMonths = family.monthlyTotals.filter((total) => total > 0);
    if (activeMonths.length < MIN_BASELINE_MONTHS_WITH_ACTIVITY) continue;

    const avg = mean(family.monthlyTotals);
    const std = populationStd(family.monthlyTotals, avg);
    const windowTotal = roundCents(family.windowTotal);
    if (windowTotal < SPIKE_MINIMUM_USD) continue;
    if (!(windowTotal > avg + SPIKE_STD_MULTIPLE * std)) continue;

    const multiple = avg > 0 ? windowTotal / avg : Number.POSITIVE_INFINITY;
    alerts.push({
      type: "spend-spike",
      severity: multiple >= SPIKE_HIGH_MULTIPLE ? "high" : "medium",
      title: `${family.name} spend is up ${multiple === Number.POSITIVE_INFINITY ? "sharply" : `${multiple.toFixed(1)}x`} vs usual`,
      detail: `$${windowTotal.toFixed(2)} in the last 30 days vs a $${avg.toFixed(2)}/mo baseline.`,
      evidence: {
        categoryFamily: family.name,
        baselineMean: roundCents(avg),
        baselineStd: roundCents(std),
        trailing30Days: windowTotal,
        multiple: multiple === Number.POSITIVE_INFINITY ? null : roundCents(multiple),
      },
      rankMagnitude: multiple === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : multiple,
    });
  }
  return alerts;
}

function detectDuplicates(postings) {
  const groups = new Map();
  for (const posting of postings) {
    if (posting.amount <= 0) continue;
    const key = merchantKey(posting.description);
    if (!key) continue;
    const amountKey = (Math.round(posting.amount * 100) / 100).toFixed(2);
    const groupKey = `${key}|${amountKey}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(posting);
  }

  const alerts = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.dayMs - b.dayMs);
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const dayDiff = (sorted[j].dayMs - sorted[i].dayMs) / DAY_MS;
        if (dayDiff >= DUPLICATE_DAY_WINDOW) break;
        if (sorted[i].id != null && sorted[i].id === sorted[j].id) continue;
        if (
          Math.abs(sorted[i].amount - sorted[j].amount) > DUPLICATE_AMOUNT_TOLERANCE
        ) {
          continue;
        }
        const merchant = merchantKey(sorted[i].description);
        alerts.push({
          type: "duplicate",
          severity: "high",
          title: `Possible duplicate charge: ${merchant}`,
          detail: `$${sorted[i].amount.toFixed(2)} charged twice, ${dayDiff === 1 ? "1 day" : `${dayDiff} days`} apart.`,
          evidence: {
            merchant,
            amount: roundCents(sorted[i].amount),
            postingIds: [sorted[i].id, sorted[j].id],
            dates: [sorted[i].date, sorted[j].date],
          },
          rankMagnitude: sorted[i].amount,
        });
      }
    }
  }
  return alerts;
}

function detectRecurringDrift(recurringPatterns) {
  if (!Array.isArray(recurringPatterns)) return [];
  const alerts = [];
  for (const pattern of recurringPatterns) {
    if (pattern == null || typeof pattern !== "object") continue;
    const median = Number(pattern.medianAmount);
    const latest = Number(pattern.latestAmount);
    if (!Number.isFinite(median) || median <= 0) continue;
    if (!Number.isFinite(latest)) continue;
    const drift = Math.abs(latest - median) / median;
    if (!(drift > DRIFT_THRESHOLD)) continue;

    const pct = Math.round(drift * 1000) / 10;
    const direction = latest > median ? "up" : "down";
    alerts.push({
      type: "recurring-drift",
      severity: "medium",
      title: `${pattern.label ?? "Recurring payment"} changed ${pct}% ${direction}`,
      detail: `Latest $${latest.toFixed(2)} vs a $${median.toFixed(2)} median (${pattern.cadence ?? "recurring"}).`,
      evidence: {
        label: pattern.label ?? null,
        medianAmount: roundCents(median),
        latestAmount: roundCents(latest),
        pctChange: pct,
        latestDate: pattern.latestDate ?? null,
        cadence: pattern.cadence ?? null,
      },
      rankMagnitude: drift,
    });
  }
  return alerts;
}

function detectNewPayees(postings, nowMs) {
  const windowStartMs = nowMs - 30 * DAY_MS;
  const seenBefore = new Set();
  const candidates = [];

  for (const posting of postings) {
    if (posting.amount <= 0 || posting.dayMs > nowMs) continue;
    const key = merchantKey(posting.description);
    if (!key) continue;
    if (posting.dayMs <= windowStartMs) {
      seenBefore.add(key);
    } else if (posting.amount >= NEW_PAYEE_MINIMUM_USD) {
      candidates.push({ posting, key });
    }
  }

  return candidates
    .filter(({ key }) => !seenBefore.has(key))
    .map(({ posting, key }) => ({
      type: "new-payee",
      severity: "low",
      title: `New payee: ${key}`,
      detail: `First $${posting.amount.toFixed(2)} to ${key} on ${posting.date} -- no prior history.`,
      evidence: {
        merchant: key,
        amount: roundCents(posting.amount),
        date: posting.date,
        postingId: posting.id,
      },
      rankMagnitude: posting.amount,
    }));
}

export function detectAnomalies({ postings, recurringPatterns, now } = {}) {
  const nowMs = resolveNow(now);
  const clean = coercePostings(postings);

  const alerts = [
    ...detectSpendSpikes(clean, nowMs),
    ...detectDuplicates(clean),
    ...detectRecurringDrift(recurringPatterns),
    ...detectNewPayees(clean, nowMs),
  ];

  alerts.sort((a, b) => {
    const severityDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severityDiff !== 0) return severityDiff;
    if (b.rankMagnitude !== a.rankMagnitude) {
      return b.rankMagnitude - a.rankMagnitude;
    }
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
  });

  return Object.freeze(
    alerts.slice(0, MAX_ALERTS).map((alert) => {
      const { rankMagnitude: _rank, ...publicAlert } = alert;
      return Object.freeze({ ...publicAlert, evidence: Object.freeze(publicAlert.evidence) });
    }),
  );
}
