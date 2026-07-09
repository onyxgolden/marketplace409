import { FinancialEngine, GeneralLedger } from "@/domains/ledger";
import { Account } from "@/domains/ledger/accounts/Account.js";
import { AccountType } from "@/domains/ledger/accounts/AccountType.js";
import { ChartOfAccounts } from "@/domains/ledger/accounts/ChartOfAccounts.js";
import { LedgerDirection } from "@/domains/ledger/value-objects/LedgerDirection.js";
import { Money } from "@/platform";

function dollarsToCents(value) {
  const number = Number(value || 0);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.round(number * 100);
}

function ledgerEntry({ accountId, direction, dollars }) {
  return {
    accountId,
    direction,
    amount: new Money(dollarsToCents(dollars)),
  };
}

function reportSections(report) {
  return report.sections().map((section) => ({
    name: section.name,
    lines: section.lines().map((line) => ({
      label: line.label,
      amount: line.amount,
    })),
  }));
}

function healthMessage(snapshot) {
  if (snapshot.revenue === 0 && snapshot.assets === 0) {
    return "Enter your numbers to generate a simple business health snapshot.";
  }

  if (snapshot.profit < 0) {
    return "Your expenses are higher than revenue. First priority: reduce costs, increase revenue, or both.";
  }

  if (snapshot.equity < 0) {
    return "Your liabilities are higher than assets. First priority: improve cash position and reduce debt.";
  }

  if (snapshot.margin >= 0.2) {
    return "Strong early signal. Your business is profitable with a healthy margin.";
  }

  return "Positive snapshot. Keep watching expenses, cash, and debt before scaling.";
}

export class FinancialSnapshotViewApplication {
  buildSnapshot({ cash, receivables, debt, revenue, expenses }) {
    const chartOfAccounts = new ChartOfAccounts([
      new Account({
        id: "1000",
        name: "Cash",
        type: AccountType.ASSET,
      }),
      new Account({
        id: "1100",
        name: "Accounts Receivable",
        type: AccountType.ASSET,
      }),
      new Account({
        id: "2000",
        name: "Debt Owed",
        type: AccountType.LIABILITY,
      }),
      new Account({
        id: "4000",
        name: "Monthly Revenue",
        type: AccountType.REVENUE,
      }),
      new Account({
        id: "5000",
        name: "Monthly Expenses",
        type: AccountType.EXPENSE,
      }),
    ]);

    const generalLedger = GeneralLedger.fromEntries([
      ledgerEntry({
        accountId: "1000",
        direction: LedgerDirection.DEBIT,
        dollars: cash,
      }),
      ledgerEntry({
        accountId: "1100",
        direction: LedgerDirection.DEBIT,
        dollars: receivables,
      }),
      ledgerEntry({
        accountId: "2000",
        direction: LedgerDirection.CREDIT,
        dollars: debt,
      }),
      ledgerEntry({
        accountId: "4000",
        direction: LedgerDirection.CREDIT,
        dollars: revenue,
      }),
      ledgerEntry({
        accountId: "5000",
        direction: LedgerDirection.DEBIT,
        dollars: expenses,
      }),
    ]);

    const engine = new FinancialEngine({
      generalLedger,
      chartOfAccounts,
    });

    const reports = engine.buildReports();

    const cashCents = dollarsToCents(cash);
    const receivablesCents = dollarsToCents(receivables);
    const debtCents = dollarsToCents(debt);
    const revenueCents = dollarsToCents(revenue);
    const expensesCents = dollarsToCents(expenses);

    const assets = cashCents + receivablesCents;
    const liabilities = debtCents;
    const equity = assets - liabilities;
    const profit = revenueCents - expensesCents;
    const margin = revenueCents > 0 ? profit / revenueCents : 0;

    const snapshot = {
      assets,
      liabilities,
      equity,
      revenue: revenueCents,
      expenses: expensesCents,
      profit,
      margin,
      balanceSheet: reportSections(reports.balanceSheet),
      incomeStatement: reportSections(reports.incomeStatement),
    };

    return {
      ...snapshot,
      healthMessage: healthMessage(snapshot),
    };
  }
}

Object.freeze(FinancialSnapshotViewApplication);
