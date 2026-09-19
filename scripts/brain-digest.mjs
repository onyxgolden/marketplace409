#!/usr/bin/env node
/**
 * scripts/brain-digest.mjs
 *
 * Builds the FORGE Brain digest for the morning briefing.
 *
 * Read-only: runs a handful of SELECTs against production Supabase through the
 * supabase skill's sb-sql (read-only by default — it refuses non-SELECT
 * statements), then feeds the deterministic Brain domain functions
 * (detectAnomalies, forecastCashFlow, budget variance) and prints the digest
 * text to stdout for the briefing to carry verbatim.
 *
 * Never throws for the briefing: any failure prints a one-line "unavailable"
 * note and exits 0, so a digest outage can never block the morning briefing.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SB_SQL = path.join(
  process.env.HOME ?? "~",
  "workspace/skills/supabase/bin/sb-sql",
);
const PROJECT_REF = "bzqvenxjlstinmgbuvvg";
const OWNER_ID = "e1b22131-9100-4a79-bbe2-b82d43af922e";

const { detectAnomalies } = await import(
  path.join(REPO_ROOT, "src/domains/ledger/brain/anomalies.js")
);
const { forecastCashFlow } = await import(
  path.join(REPO_ROOT, "src/domains/ledger/brain/forecast.js")
);
const { buildBrainDigest, renderDigestText } = await import(
  path.join(REPO_ROOT, "src/domains/ledger/brain/digest.js")
);
const { detectRecurringPayments } = await import(
  path.join(REPO_ROOT, "src/domains/financial-event/detectRecurringPayments.js")
);
const { categoryFamilyOf } = await import(
  path.join(REPO_ROOT, "src/domains/budgeting/categoryFamily.js")
);
const { lineVarianceCents } = await import(
  path.join(REPO_ROOT, "src/domains/budgeting/budgetVariance.js")
);

function sql(query) {
  const raw = execFileSync(SB_SQL, ["--project-ref", PROJECT_REF, "--query", query], {
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(raw);
}

function toDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function currentMonth() {
  return toDateOnly(new Date()).slice(0, 7);
}

function monthBounds(month) {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { start: `${month}-01`, nextStart: `${next}-01` };
}

// Mirrors src/app/api/financial/forecast/route.js: non-recurring expense
// rows from the last 90 days, magnitude only, divided by the window.
function computeDailyBurn(rows, recurringEventIds, windowDays = 90) {
  const cutoff = toDateOnly(new Date(Date.now() - windowDays * 86_400_000));
  const byAccount = new Map();
  for (const row of rows) {
    if (row.transaction_kind !== "expense") continue;
    if (recurringEventIds.has(row.id)) continue;
    if (!row.event_date || row.event_date < cutoff) continue;
    const magnitude = Math.abs(Number(row.amount) || 0);
    if (magnitude <= 0 || !row.financial_account_id) continue;
    byAccount.set(
      row.financial_account_id,
      (byAccount.get(row.financial_account_id) ?? 0) + magnitude,
    );
  }
  return Object.fromEntries(
    [...byAccount.entries()].map(([id, total]) => [
      id,
      Math.round((total / windowDays) * 100) / 100,
    ]),
  );
}

function buildDigest() {
  const transactions = sql(
    `SELECT id, event_date, amount, description, transaction_kind, normalized_category, financial_account_id ` +
      `FROM financial_events WHERE owner_id = '${OWNER_ID}' AND is_deleted = false ` +
      `AND source_system = 'transaction' AND transaction_kind IN ('income','expense') ORDER BY id`,
  );
  const accounts = sql(
    `SELECT id, name, type FROM financial_accounts WHERE owner_id = '${OWNER_ID}' AND COALESCE(active, true) = true`,
  );
  const balances = sql(
    `SELECT DISTINCT ON (financial_account_id) financial_account_id, current_balance_cents ` +
      `FROM account_balances WHERE owner_id = '${OWNER_ID}' ` +
      `ORDER BY financial_account_id, as_of DESC, id`,
  );
  const [{ n: uncategorizedCount }] = sql(
    `SELECT count(*)::int AS n FROM financial_events WHERE owner_id = '${OWNER_ID}' ` +
      `AND is_deleted = false AND source_system = 'transaction' ` +
      `AND transaction_kind IN ('income','expense') ` +
      `AND (normalized_category IS NULL OR normalized_category = 'other')`,
  );

  // --- Anomalies (same input mapping as the anomalies API route) ---
  const postings = transactions.map((row) => ({
    id: row.id,
    description: row.description ?? "",
    amount:
      row.transaction_kind === "income"
        ? -Math.abs(Number(row.amount) || 0)
        : Math.abs(Number(row.amount) || 0),
    categoryFamily: categoryFamilyOf(row.normalized_category),
    date: row.event_date,
  }));
  const recurringPatterns = detectRecurringPayments(
    transactions.map((row) => ({
      id: row.id,
      eventDate: row.event_date,
      amount: Number(row.amount),
      accountId: row.financial_account_id,
      accountName: null,
      businessScope: null,
      transactionKind: row.transaction_kind,
      normalizedCategory: row.normalized_category,
    })),
  );
  const anomalies = detectAnomalies({
    postings,
    recurringPatterns: recurringPatterns.map((pattern) => {
      const rows = transactions.filter((row) => (pattern.eventIds ?? []).includes(row.id));
      const latest = rows.length > 0 ? rows[rows.length - 1] : null;
      return {
        label: pattern.label,
        medianAmount: pattern.medianAmount,
        latestAmount: latest ? Math.abs(Number(latest.amount) || 0) : pattern.medianAmount,
        latestDate: pattern.nextExpectedDate,
        cadence: pattern.cadence,
      };
    }),
  });

  // --- Cash-flow forecast (same input mapping as the forecast API route) ---
  const balanceByAccountId = new Map(
    balances.map((b) => [b.financial_account_id, Number(b.current_balance_cents) / 100]),
  );
  const forecastAccounts = accounts
    .filter((a) => a.type === "depository" && balanceByAccountId.has(a.id))
    .map((a) => ({
      accountId: a.id,
      name: a.name ?? a.id,
      startingBalance: Math.round(balanceByAccountId.get(a.id) * 100) / 100,
    }));
  const recurringEventIds = new Set(
    recurringPatterns.flatMap((pattern) => pattern.eventIds ?? []),
  );
  const forecast = forecastCashFlow({
    accounts: forecastAccounts,
    recurringPatterns,
    dailyBurn: computeDailyBurn(transactions, recurringEventIds),
    days: 90,
    safetyBuffer: 1000,
  });

  // --- Budget overruns for the current month (mirrors the budget plan route) ---
  const month = currentMonth();
  const { start: monthStart, nextStart } = monthBounds(month);
  const categories = sql(
    `SELECT id, normalized_category, display_label, business_scope FROM budget_categories ` +
      `WHERE is_archived = false AND business_scope IN ('personal','business')`,
  );
  const categoryIds = categories.map((c) => `'${c.id}'`).join(",");
  const allocations = categoryIds
    ? sql(
        `SELECT category_id, planned_amount_cents FROM budget_monthly_allocations ` +
          `WHERE period_month = '${monthStart}' AND category_id IN (${categoryIds})`,
      )
    : [];
  const plannedByCategoryId = new Map(
    allocations.map((a) => [a.category_id, Number(a.planned_amount_cents)]),
  );
  const actualCentsByFamily = new Map();
  for (const row of transactions) {
    if (row.transaction_kind !== "expense") continue;
    if (!row.event_date || row.event_date < monthStart || row.event_date >= nextStart) continue;
    const family = categoryFamilyOf(row.normalized_category) ?? row.normalized_category;
    actualCentsByFamily.set(
      family,
      (actualCentsByFamily.get(family) ?? 0) + Math.round(Math.abs(Number(row.amount) || 0) * 100),
    );
  }
  const budgetOverruns = categories
    .map((category) => {
      const family = categoryFamilyOf(category.normalized_category) ?? category.normalized_category;
      const variance = lineVarianceCents({
        plannedAmountCents: plannedByCategoryId.get(category.id) ?? null,
        actualAmountCents: actualCentsByFamily.get(family) ?? 0,
      });
      return {
        label: category.display_label ?? category.normalized_category,
        overAmountCents: variance != null && variance < 0 ? -variance : 0,
        month,
      };
    })
    .filter((o) => o.overAmountCents > 0)
    .sort((a, b) => b.overAmountCents - a.overAmountCents);

  const digest = buildBrainDigest({
    anomalies,
    forecast,
    pendingSuggestions: Number(uncategorizedCount) || 0,
    budgetOverruns,
  });
  return renderDigestText(digest);
}

try {
  console.log(buildDigest());
} catch (error) {
  console.log("FORGE Brain digest unavailable this morning (data fetch failed).");
}
