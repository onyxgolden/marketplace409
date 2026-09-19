/**
 * answerLedgerQuery
 *
 * Deterministic executor for FORGE Brain's "Ask the books". Takes a parsed
 * query (see parseLedgerQuery) and answers it from the ledger -- no LLM calls.
 *
 * answerLedgerQuery({ engine, parsed, question }) ->
 *   { question, metric, categoryFamily, period: { label, startDate, endDate },
 *     amount, lines: [{ accountId, name, type, amount }] }
 *
 * Amounts are human-signed (revenue positive, expenses positive -- the ledger's
 * credit-normal revenue balances are flipped, mirroring
 * buildComparativeIncomeStatements). `amount` is the total for the requested
 * metric; `net` = revenue - expenses.
 */

import { AccountType } from "../accounts/AccountType.js";
import { resolveCategoryFamily } from "./parseLedgerQuery.js";

const COMPARABLE_TYPES = Object.freeze([AccountType.REVENUE, AccountType.EXPENSE]);

function toCentsRounded(value) {
  // The trailing + 0 normalizes -0 (from flipping a zero revenue balance) to 0.
  return Math.round(Number(value) * 100) / 100 + 0;
}

// Ledger convention: debits add, credits subtract -- so revenue (credit-normal)
// balances come out negative and are flipped here for human display.
function toHumanSigned(ledgerAmount, accountType) {
  const signed = accountType === AccountType.REVENUE ? -ledgerAmount : ledgerAmount;
  return toCentsRounded(signed);
}

function accountFamily(account) {
  // Match on name or id -- charts key accounts either way in the wild.
  const fromName = resolveCategoryFamily(account.name);
  if (fromName) return fromName;
  return resolveCategoryFamily(account.id);
}

export function answerLedgerQuery({ engine, parsed, question }) {
  if (!engine) {
    throw new Error("answerLedgerQuery requires an engine");
  }

  if (!parsed || parsed.unparseable) {
    throw new Error("answerLedgerQuery requires a parsed query (not unparseable)");
  }

  const chartOfAccounts = engine.chartOfAccounts;

  if (!chartOfAccounts) {
    throw new Error("answerLedgerQuery requires an engine with a chart of accounts");
  }

  const statement = engine.buildIncomeStatementForPeriod({
    startDate: parsed.period.startDate,
    endDate: parsed.period.endDate,
  });

  const lines = [];

  for (const line of statement.lines()) {
    if (!chartOfAccounts.hasAccount(line.label)) continue;

    const account = chartOfAccounts.getById(line.label);

    if (!COMPARABLE_TYPES.includes(account.type)) continue;
    if (line.amount === 0) continue;
    if (parsed.categoryFamily && accountFamily(account) !== parsed.categoryFamily) continue;

    lines.push(
      Object.freeze({
        accountId: account.id,
        name: account.name,
        type: account.type,
        amount: toHumanSigned(line.amount, account.type),
      }),
    );
  }

  let revenue = 0;
  let expenses = 0;

  for (const line of lines) {
    if (line.type === AccountType.REVENUE) revenue += line.amount;
    else expenses += line.amount;
  }

  revenue = toCentsRounded(revenue);
  expenses = toCentsRounded(expenses);

  // The breakdown mirrors the question: a spend question shows expense lines,
  // a revenue question shows revenue lines, net shows both sides.
  const visibleLines =
    parsed.metric === "spend"
      ? lines.filter((line) => line.type === AccountType.EXPENSE)
      : parsed.metric === "revenue"
        ? lines.filter((line) => line.type === AccountType.REVENUE)
        : lines;

  const amount =
    parsed.metric === "revenue"
      ? revenue
      : parsed.metric === "net"
        ? toCentsRounded(revenue - expenses)
        : expenses;

  return Object.freeze({
    question: question ?? null,
    metric: parsed.metric,
    categoryFamily: parsed.categoryFamily,
    period: Object.freeze({ ...parsed.period }),
    amount,
    lines: Object.freeze(visibleLines),
  });
}
