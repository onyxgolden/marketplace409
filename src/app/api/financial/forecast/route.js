import { NextResponse } from "next/server";

import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { detectRecurringPayments } from "@/domains/financial-event/detectRecurringPayments";
import { forecastCashFlow } from "@/domains/ledger/brain/forecast.js";
import { assessBurnConfidence } from "@/domains/ledger/brain/forecastConfidence.js";
import { categoryFamilyOf } from "@/domains/budgeting/categoryFamily.js";

const PAGE_SIZE = 1000;
const TRANSACTION_SOURCE_SYSTEM = "transaction";
const BURN_WINDOW_DAYS = 90;
const DEFAULT_DAYS = 90;
const MAX_DAYS = 180;
const DEFAULT_SAFETY_BUFFER = 1000;

// Only cash-like accounts are forecast: a projected investment balance is
// noise, and liabilities are tracked elsewhere.
const FORECAST_ACCOUNT_TYPE = "depository";

// Same read path as the recurring endpoint: all income/expense feed rows.
async function fetchTransactionRows(supabaseClient, ownerId) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseClient
      .from("financial_events")
      .select("id, event_date, amount, transaction_kind, normalized_category, financial_account_id")
      .eq("owner_id", ownerId)
      .eq("is_deleted", false)
      .eq("source_system", TRANSACTION_SOURCE_SYSTEM)
      .in("transaction_kind", ["income", "expense"])
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function toDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

// Discretionary daily burn per account: non-recurring expense rows from the
// last 90 days, magnitude only, divided by the window. Recurring-pattern rows
// are excluded so the mortgage isn't counted twice.
//
// Also reports the history coverage behind the burn: the span of in-window
// transaction activity and the count of qualifying burn rows. A burn divided
// by 90 on 12 days of real history understates reality by ~7x, so the panel
// withholds the metric when coverage is too thin (see forecastConfidence.js).
function computeDailyBurn(rows, recurringEventIds) {
  const cutoff = toDateOnly(new Date(Date.now() - BURN_WINDOW_DAYS * 86_400_000));
  const byAccount = new Map();
  const byFamily = new Map();
  let earliestDay = null;
  let latestDay = null;
  let burnTransactionCount = 0;
  for (const row of rows) {
    if (row.transaction_kind !== "expense" && row.transaction_kind !== "income") continue;
    if (!row.event_date || row.event_date < cutoff) continue;
    if (earliestDay === null || row.event_date < earliestDay) earliestDay = row.event_date;
    if (latestDay === null || row.event_date > latestDay) latestDay = row.event_date;
    if (row.transaction_kind !== "expense") continue;
    if (recurringEventIds.has(row.id)) continue;
    const magnitude = Math.abs(Number(row.amount) || 0);
    if (magnitude <= 0) continue;
    burnTransactionCount += 1;
    const accountId = row.financial_account_id;
    if (accountId) byAccount.set(accountId, (byAccount.get(accountId) ?? 0) + magnitude);
    const family = categoryFamilyOf(row.normalized_category);
    byFamily.set(family, (byFamily.get(family) ?? 0) + magnitude);
  }
  const daysOfHistory =
    earliestDay && latestDay
      ? Math.round((parseUtcDay(latestDay) - parseUtcDay(earliestDay)) / 86_400_000) + 1
      : 0;
  const perDay = (total) => Math.round((total / BURN_WINDOW_DAYS) * 100) / 100;
  return {
    byAccount: Object.fromEntries([...byAccount.entries()].map(([id, total]) => [id, perDay(total)])),
    byFamily: Object.fromEntries([...byFamily.entries()].map(([family, total]) => [family, perDay(total)])),
    daysOfHistory,
    burnTransactionCount,
    windowDays: BURN_WINDOW_DAYS,
  };
}

// YYYY-MM-DD -> UTC midnight ms, so the history span can't shift a day by
// timezone.
function parseUtcDay(iso) {
  const [year, month, day] = String(iso).split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

// Read-only cash-flow forecast. Projects each depository account forward
// `days` days from today's balances, applying detected recurring patterns and
// the recent discretionary burn rate. No writes, nothing to confirm.
export async function GET(request) {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  const params = new URL(request.url).searchParams;
  const daysParam = params.get("days");
  const days = daysParam == null ? DEFAULT_DAYS : Number(daysParam);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return NextResponse.json(
      { error: `days must be an integer between 1 and ${MAX_DAYS}.` },
      { status: 400 },
    );
  }
  const bufferParam = params.get("safetyBuffer");
  const safetyBuffer = bufferParam == null ? DEFAULT_SAFETY_BUFFER : Number(bufferParam);
  if (!Number.isFinite(safetyBuffer) || safetyBuffer < 0) {
    return NextResponse.json({ error: "safetyBuffer must be a non-negative number." }, { status: 400 });
  }

  try {
    const suite = await authenticated.getFinancialApplicationSuite();
    const [accounts, balances, transactionRows] = await Promise.all([
      suite.financialAccountRepository.findByOwnerId(authenticated.user.id),
      suite.accountBalanceRepository.findLatestByOwnerId(authenticated.user.id),
      fetchTransactionRows(authenticated.supabaseClient, authenticated.effectiveOwnerId),
    ]);

    const balanceByAccountId = new Map(balances.map((balance) => [balance.financialAccountId, balance]));
    const forecastAccounts = [];
    let skippedWithoutBalance = 0;
    for (const account of accounts ?? []) {
      if (account?.active === false || account?.type !== FORECAST_ACCOUNT_TYPE) continue;
      const balance = balanceByAccountId.get(account.id);
      if (!balance || !Number.isFinite(Number(balance.currentBalanceCents))) {
        skippedWithoutBalance += 1;
        continue;
      }
      forecastAccounts.push({
        accountId: account.id,
        name: account.name ?? account.id,
        // currentBalanceCents is human-signed for depository accounts: positive = cash on hand.
        startingBalance: Math.round((Number(balance.currentBalanceCents) / 100) * 100) / 100,
      });
    }

    const patterns = detectRecurringPayments(
      transactionRows.map((row) => ({
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
    const recurringEventIds = new Set(patterns.flatMap((pattern) => pattern.eventIds ?? []));
    const burn = computeDailyBurn(transactionRows, recurringEventIds);

    const forecast = forecastCashFlow({
      accounts: forecastAccounts,
      recurringPatterns: patterns,
      dailyBurn: burn.byAccount,
      days,
      safetyBuffer,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...forecast,
        burnByFamily: burn.byFamily,
        // Low-confidence gate: the panel withholds the daily-burn metric (and
        // re-projects only from user-supplied assumptions) when the history
        // behind it is too thin. Patterns are included so the panel can
        // re-run the pure forecast client-side under a user assumption.
        burnConfidence: assessBurnConfidence({
          daysOfHistory: burn.daysOfHistory,
          transactionCount: burn.burnTransactionCount,
          windowDays: burn.windowDays,
        }),
        recurringPatterns: patterns,
        accountsSkippedWithoutBalance: skippedWithoutBalance,
        patternCount: patterns.length,
      },
    });
  } catch (error) {
    if (isMissingRemoteSchemaError(error)) {
      return NextResponse.json(
        { error: "Cash-flow forecasting isn't available yet.", code: "forecast_schema_unavailable" },
        { status: 503 },
      );
    }
    console.error("Cash-flow forecast error", error);
    return NextResponse.json({ error: "Unable to build the cash-flow forecast." }, { status: 500 });
  }
}
