import { AccountType } from "../accounts/AccountType.js";

const ACCOUNT_NAMES = {
  "1000": "Cash",
  "1100": "Accounts Receivable",
  "2000": "Debt Owed",
  "4000": "Monthly Revenue",
  "5000": "Monthly Expenses",
};

function cents(value) {
  return Number(value || 0);
}

function lineAmount(report, accountId) {
  return cents(report?._lines?.find((line) => line.label === accountId)?.amount);
}

// Revenue/expense totals for the income statement. With the chart of accounts available,
// every revenue and expense account totals by type -- the demo chart's "4000"/"5000" and
// real per-category accounts ("revenue:rent", "expense:dining_drinks", ...) alike. The
// income statement's _lines also carry balance-sheet accounts (the demo "1000"/"1100"/
// "2000"), so raw sign alone cannot distinguish revenue from liabilities -- the chart's
// account types are the source of truth. Without a chart, falls back to the legacy
// demo-chart account ids.
function incomeStatementTotals(income, chartOfAccounts) {
  const lines = income?._lines || [];

  if (
    chartOfAccounts &&
    typeof chartOfAccounts.getById === "function"
  ) {
    let revenue = 0;
    let expenses = 0;

    for (const line of lines) {
      const account = chartOfAccounts.getById(line?.label);

      if (!account) continue;

      const amount = Math.abs(cents(line?.amount));

      if (account.type === AccountType.REVENUE) {
        revenue += amount;
      } else if (account.type === AccountType.EXPENSE) {
        expenses += amount;
      }
    }

    return { revenue, expenses };
  }

  return {
    revenue: Math.abs(lineAmount({ _lines: lines }, "4000")),
    expenses: lineAmount({ _lines: lines }, "5000"),
  };
}

function buildHealthStatus({ equity, profit, margin, cash }) {
  if (equity < 0 || profit < 0) {
    return {
      label: "Critical",
      detail: "Negative equity or profit requires immediate review.",
    };
  }

  if (margin < 0.15 || cash <= 0) {
    return {
      label: "Warning",
      detail: "Profitability or cash position needs closer monitoring.",
    };
  }

  return {
    label: "Healthy",
    detail: "Profit, margin, cash, and equity are currently positive.",
  };
}

export class FinancialDashboardService {
  // provider names the data source behind the dashboard ("demo" for
  // DemoFinancialDataProvider, "production" for ProductionFinancialDataProvider). It is
  // metadata only -- the KPI math never depends on it.
  constructor({ provider = "demo" } = {}) {
    this.provider = provider;
  }

  buildFromReports(reports, { chartOfAccounts } = {}) {
    const income = reports?.incomeStatement;
    const balance = reports?.balanceSheet;

    const cash = lineAmount(balance, "1000");
    const receivables = lineAmount(balance, "1100");
    const debt = Math.abs(lineAmount(balance, "2000"));
    const { revenue, expenses } = incomeStatementTotals(
      income,
      chartOfAccounts,
    );

    const assets = cash + receivables;
    const liabilities = debt;
    const equity = assets - liabilities;
    const profit = revenue - expenses;
    const margin = revenue ? profit / revenue : 0;

    return Object.freeze({
      kpis: Object.freeze({
        cash,
        receivables,
        debt,
        revenue,
        expenses,
        assets,
        liabilities,
        equity,
        profit,
        margin,
      }),
      health: Object.freeze(buildHealthStatus({ equity, profit, margin, cash })),
      balanceSheetLines: Object.freeze(
        (balance?._lines || []).map((line) =>
          Object.freeze({
            accountId: line.label,
            accountName: ACCOUNT_NAMES[line.label] || line.label,
            amount: cents(line.amount),
          }),
        ),
      ),
      metadata: Object.freeze({
        provider: this.provider,
        snapshotStatus: "current",
        phase: "7.3",
      }),
    });
  }
}

Object.freeze(FinancialDashboardService);
