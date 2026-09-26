// Payee-keyed recurring detection for the budget bootstrap flow. Pure: no DB
// access -- callers fetch rows and pass them in.
//
// Same recurrence matcher as detectRecurringPayments (see recurringPatternCore),
// but groups rows by normalized payee/description + money direction instead of
// account + category. That split matters for onboarding: two subscriptions that
// share one account and one category (e.g. two video services both categorized
// "subscriptions") must surface as two separate confirmable candidates, not one
// merged pattern.
import {
  filterRecurrenceRows,
  matchRecurringGroup,
  recurrenceDirectionOf,
} from "./recurringPatternCore.js";

// Bank-feed leading markers that say how the money moved, not who got it --
// stripped so "ACH DEBIT NETFLIX.COM" and "NETFLIX.COM" normalize to one payee.
const LEADING_MARKERS = [
  "debit purchase",
  "pos purchase",
  "ach debit",
  "ach credit",
  "electronic withdrawal",
  "electronic deposit",
  "online payment",
  "bill pay",
  "check",
];

// Normalizes a bank description into a stable grouping key: lowercased,
// de-accented, punctuation collapsed, leading transfer-type markers and trailing
// reference/store numbers removed. Deliberately conservative -- distinct payees
// stay distinct; the confirmation screen exists so the user can deselect any
// false merge.
export function normalizePayeeKey(description) {
  if (description === null || description === undefined) return "";
  let text = String(description).toLowerCase().trim();
  if (!text) return "";
  text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  text = text.replace(/[^a-z0-9\s]/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  for (const marker of LEADING_MARKERS) {
    if (text === marker) {
      text = "";
      break;
    }
    if (text.startsWith(`${marker} `)) {
      text = text.slice(marker.length + 1);
      break;
    }
  }
  // Trailing all-digit tokens (store numbers, reference numbers, phone
  // fragments) identify one charge, not one payee.
  let previous = null;
  while (previous !== text) {
    previous = text;
    text = text.replace(/\s\d{3,}$/, "").trim();
  }
  return text;
}

// Human-readable label for a payee group: the most common raw description seen
// (ties go to the first seen), whitespace-collapsed.
export function payeeLabelFor(descriptions) {
  const counts = new Map();
  let best = "";
  let bestCount = 0;
  for (const raw of descriptions ?? []) {
    const cleaned = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    const count = (counts.get(cleaned) ?? 0) + 1;
    counts.set(cleaned, count);
    if (count > bestCount) {
      best = cleaned;
      bestCount = count;
    }
  }
  return best;
}

// Most frequent non-empty value in a group (ties go to the first seen).
function modalValue(values) {
  const counts = new Map();
  let best = null;
  let bestCount = 0;
  for (const value of values ?? []) {
    if (!value) continue;
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

// Detects recurring bills (outbound) and recurring income (inbound) keyed on
// payee. Each candidate carries its modal category so the bootstrap flow can map
// it onto a budget category; candidates without a decided category are returned
// with category null and are the caller's to filter (the budget flow skips them
// until they're classified).
export function detectRecurringByPayee(inputRows, options = {}) {
  const rows = filterRecurrenceRows(inputRows);

  const groups = new Map();
  for (const row of rows) {
    const payeeKey = normalizePayeeKey(row.description ?? row.payee);
    if (!payeeKey) continue;
    const key = `${payeeKey}|${row.amount < 0 ? "in" : "out"}`;
    if (!groups.has(key)) groups.set(key, { payeeKey, rows: [] });
    groups.get(key).rows.push(row);
  }

  const candidates = [];
  for (const { payeeKey, rows: groupRows } of groups.values()) {
    const match = matchRecurringGroup(groupRows, options);
    if (!match) continue;
    const representative = match.representative;
    candidates.push(
      Object.freeze({
        payeeKey,
        payeeLabel: payeeLabelFor(groupRows.map((r) => r.description ?? r.payee)),
        direction: recurrenceDirectionOf(representative.amount),
        category: modalValue(groupRows.map((r) => r.normalizedCategory)),
        cadence: match.cadence,
        medianIntervalDays: match.medianIntervalDays,
        occurrences: match.occurrences,
        medianAmount: match.medianAmount,
        monthlyAmount: match.monthlyAmount,
        firstDate: match.firstDate,
        lastDate: match.lastDate,
        nextExpectedDate: match.nextExpectedDate,
        irregularIntervals: match.irregularIntervals,
        eventIds: match.eventIds,
      }),
    );
  }

  // Most frequent first -- the candidates the user will care about.
  return candidates.sort((a, b) => b.occurrences - a.occurrences);
}
