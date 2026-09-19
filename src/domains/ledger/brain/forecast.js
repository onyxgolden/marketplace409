// Cash-flow forecasting: project per-account cash balances forward and warn
// before a shortfall. Pure, deterministic, no LLM calls -- callers fetch
// account balances, recurring patterns, and historical burn, then pass plain
// objects in.
//
// Conventions (human sign throughout): startingBalance is dollars, positive =
// cash on hand. Recurring pattern amounts use the feed convention: an
// "outbound" occurrence reduces the balance, "inbound" increases it. Dates are
// YYYY-MM-DD strings; arithmetic is UTC so timezones can't shift a date.
import { upcomingRecurringOccurrences } from "../../financial-event/detectRecurringPayments.js";

export const DEFAULT_FORECAST_DAYS = 90;
export const MAX_FORECAST_DAYS = 180;
export const DEFAULT_SAFETY_BUFFER = 1000;

const DAY_MS = 86_400_000;

function parseDateOnly(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  const t = Date.UTC(year, month - 1, day);
  return Number.isNaN(t) ? null : t;
}

function toDateOnly(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function toCentsRounded(value) {
  // Normalize -0 to 0 so payloads serialize cleanly.
  return Math.round(Number(value) * 100) / 100 + 0;
}

function signedDelta(occurrence) {
  const magnitude = Math.abs(Number(occurrence?.amount) || 0);
  return occurrence?.direction === "inbound" ? magnitude : -magnitude;
}

function clampDays(days) {
  const n = Number(days);
  if (!Number.isFinite(n)) return DEFAULT_FORECAST_DAYS;
  return Math.min(MAX_FORECAST_DAYS, Math.max(1, Math.floor(n)));
}

function clampBuffer(buffer) {
  const n = Number(buffer);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_SAFETY_BUFFER;
  return n;
}

// Maximal runs of days where the projected balance sits under the safety
// buffer. Each episode yields exactly one warning -- at its worst day -- so a
// slow bleed doesn't spam. An episode is a "shortfall" if any day goes below
// zero, otherwise "tight".
function warningsForAccount(account, dailyBalances, safetyBuffer) {
  const warnings = [];
  let episodeStart = -1;
  let worstIndex = -1;

  const closeEpisode = () => {
    if (episodeStart < 0) return;
    const worst = dailyBalances[worstIndex];
    warnings.push(
      Object.freeze({
        accountId: account.accountId,
        accountName: account.name,
        type: worst.balance < 0 ? "shortfall" : "tight",
        date: worst.date,
        projectedBalance: worst.balance,
        daysFromStart: worstIndex,
      }),
    );
    episodeStart = -1;
    worstIndex = -1;
  };

  for (let i = 0; i < dailyBalances.length; i += 1) {
    const { balance } = dailyBalances[i];
    if (balance < safetyBuffer) {
      if (episodeStart < 0) {
        episodeStart = i;
        worstIndex = i;
      } else if (balance < dailyBalances[worstIndex].balance) {
        worstIndex = i;
      }
    } else {
      closeEpisode();
    }
  }
  closeEpisode();
  return warnings;
}

export function forecastCashFlow({
  accounts = [],
  recurringPatterns = [],
  dailyBurn = {},
  startDate,
  days = DEFAULT_FORECAST_DAYS,
  safetyBuffer = DEFAULT_SAFETY_BUFFER,
} = {}) {
  const horizon = clampDays(days);
  const buffer = clampBuffer(safetyBuffer);
  const parsedStart = parseDateOnly(startDate ?? toDateOnly(Date.now()));
  const startMs = parsedStart ?? Date.UTC(2026, 0, 1);
  const normalizedStart = toDateOnly(startMs);

  const activeAccounts = (accounts ?? []).filter(
    (account) => account && typeof account.accountId === "string" && account.accountId.length > 0,
  );
  const accountById = new Map(activeAccounts.map((account) => [account.accountId, account]));

  // One expansion for the whole horizon, attributed back to accounts by id.
  // The helper was extended to pass accountId through on each occurrence.
  const occurrences = upcomingRecurringOccurrences(recurringPatterns ?? [], {
    fromDate: normalizedStart,
    daysAhead: horizon,
  });
  const deltasByAccountAndDate = new Map();
  for (const occurrence of occurrences) {
    const accountId = occurrence?.accountId;
    if (!accountById.has(accountId)) continue;
    const delta = signedDelta(occurrence);
    if (delta === 0) continue;
    const key = `${accountId}|${occurrence.date}`;
    deltasByAccountAndDate.set(key, (deltasByAccountAndDate.get(key) ?? 0) + delta);
  }

  const accountResults = [];
  const allWarnings = [];

  for (const account of activeAccounts) {
    const startingBalance = toCentsRounded(Number(account.startingBalance) || 0);
    const burnPerDay = Math.max(0, Number(dailyBurn?.[account.accountId]) || 0);

    const dailyBalances = [];
    let balance = startingBalance;
    let minBalance = startingBalance;
    let minBalanceDate = normalizedStart;

    for (let i = 0; i < horizon; i += 1) {
      const date = toDateOnly(startMs + i * DAY_MS);
      const delta = deltasByAccountAndDate.get(`${account.accountId}|${date}`) ?? 0;
      balance = toCentsRounded(balance + delta - burnPerDay);
      dailyBalances.push({ date, balance });
      if (balance < minBalance) {
        minBalance = balance;
        minBalanceDate = date;
      }
    }

    // Weekly checkpoints plus the final day keep payloads small.
    const checkpoints = dailyBalances
      .filter((entry, index) => index === 0 || index % 7 === 6 || index === dailyBalances.length - 1)
      .map((entry) => Object.freeze({ date: entry.date, projectedBalance: entry.balance }));

    const accountWarnings = warningsForAccount(
      { accountId: account.accountId, name: account.name ?? account.accountId },
      dailyBalances,
      buffer,
    );

    accountResults.push(
      Object.freeze({
        accountId: account.accountId,
        name: account.name ?? account.accountId,
        startingBalance,
        dailyBurn: toCentsRounded(burnPerDay),
        minBalance,
        minBalanceDate,
        checkpoints: Object.freeze(checkpoints),
        warnings: Object.freeze(accountWarnings),
      }),
    );
    allWarnings.push(...accountWarnings);
  }

  allWarnings.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return Object.freeze({
    accounts: Object.freeze(accountResults),
    warnings: Object.freeze(allWarnings),
    meta: Object.freeze({
      startDate: normalizedStart,
      days: horizon,
      safetyBuffer: buffer,
    }),
  });
}
