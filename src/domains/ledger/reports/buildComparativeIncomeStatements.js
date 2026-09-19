/**
 * buildComparativeIncomeStatements
 *
 * Builds a JSON-serializable, column-aligned comparative P&L: one entry per
 * accounting period, each with per-account lines and revenue/expense/net totals.
 *
 * Amounts are in human sign (revenue positive, expenses positive,
 * netIncome = revenue - expenses) -- the ledger's credit-normal revenue balances
 * are flipped on the way out. An account gets a row when it has nonzero activity
 * in ANY of the periods, so columns stay aligned; all-zero accounts are dropped.
 */

import { AccountType } from "../accounts/AccountType.js";

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

export function buildComparativeIncomeStatements({ engine, periods }) {
  if (!engine) {
    throw new Error("buildComparativeIncomeStatements requires an engine");
  }

  if (!Array.isArray(periods) || periods.length === 0) {
    throw new Error("buildComparativeIncomeStatements requires a non-empty periods array");
  }

  const chartOfAccounts = engine.chartOfAccounts;

  if (!chartOfAccounts) {
    throw new Error("buildComparativeIncomeStatements requires an engine with a chart of accounts");
  }

  // One period income statement per period, reduced to accountId -> ledger balance.
  const periodBalances = periods.map((period) => {
    const statement = engine.buildIncomeStatementForPeriod({
      startDate: period.startDate,
      endDate: period.endDate,
    });

    const balances = new Map();
    for (const line of statement.lines()) {
      balances.set(line.label, line.amount);
    }
    return balances;
  });

  // Accounts worth a row: revenue/expense accounts with nonzero activity anywhere.
  const accountOrder = new Map(
    chartOfAccounts.accounts.map((account, index) => [account.id, index]),
  );
  const includedAccountIds = new Set();

  for (const balances of periodBalances) {
    for (const [accountId, amount] of balances) {
      if (amount === 0 || !chartOfAccounts.hasAccount(accountId)) continue;
      const account = chartOfAccounts.getById(accountId);
      if (COMPARABLE_TYPES.includes(account.type)) {
        includedAccountIds.add(accountId);
      }
    }
  }

  const orderedAccountIds = [...includedAccountIds].sort(
    (a, b) => accountOrder.get(a) - accountOrder.get(b),
  );

  const accountMeta = new Map(
    orderedAccountIds.map((accountId) => {
      const account = chartOfAccounts.getById(accountId);
      return [accountId, { name: account.name, type: account.type }];
    }),
  );

  const results = periods.map((period, periodIndex) => {
    const balances = periodBalances[periodIndex];

    const lines = orderedAccountIds.map((accountId) => {
      const { name, type } = accountMeta.get(accountId);
      return Object.freeze({
        accountId,
        name,
        type,
        amount: toHumanSigned(balances.get(accountId) ?? 0, type),
      });
    });

    let revenue = 0;
    let expenses = 0;
    for (const line of lines) {
      if (line.type === AccountType.REVENUE) revenue += line.amount;
      if (line.type === AccountType.EXPENSE) expenses += line.amount;
    }
    revenue = toCentsRounded(revenue);
    expenses = toCentsRounded(expenses);

    return Object.freeze({
      period: Object.freeze({ ...period }),
      lines: Object.freeze(lines),
      totals: Object.freeze({
        revenue,
        expenses,
        netIncome: toCentsRounded(revenue - expenses),
      }),
    });
  });

  return Object.freeze(results);
}
