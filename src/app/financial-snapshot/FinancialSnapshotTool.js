"use client";

import { useMemo, useState } from "react";
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

function formatCurrency(cents) {
  return new Money(cents).toString();
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

function createSnapshot({ cash, receivables, debt, revenue, expenses }) {
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

  return {
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

export default function FinancialSnapshotTool() {
  const [form, setForm] = useState({
    cash: "10000",
    receivables: "2500",
    debt: "4000",
    revenue: "12000",
    expenses: "8500",
  });

  const snapshot = useMemo(() => createSnapshot(form), [form]);

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  const fields = [
    ["cash", "Cash on hand"],
    ["receivables", "Money owed to you"],
    ["debt", "Money you owe"],
    ["revenue", "Monthly revenue"],
    ["expenses", "Monthly expenses"],
  ];

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <section className="bg-gradient-to-r from-blue-950 via-blue-900 to-red-700 text-white px-6 py-16">
        <div className="max-w-5xl mx-auto">
          <a href="/investors" className="text-blue-100 hover:text-white">
            ← Back to Investor Hub
          </a>

          <h1 className="text-5xl font-extrabold mt-8 mb-4">
            Business Financial Snapshot
          </h1>

          <p className="text-xl text-blue-100 max-w-3xl">
            Enter a few basic numbers and generate a simple business health
            snapshot using the Financial Forge ledger engine.
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-3xl shadow-lg p-8">
          <h2 className="text-2xl font-bold mb-6">Your numbers</h2>

          <div className="space-y-5">
            {fields.map(([field, label]) => (
              <label key={field} className="block">
                <span className="font-semibold">{label}</span>
                <div className="mt-2 flex items-center rounded-xl border bg-gray-50 px-4">
                  <span className="text-gray-500">$</span>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={form[field]}
                    onChange={(event) =>
                      updateField(field, event.target.value)
                    }
                    className="w-full bg-transparent px-3 py-3 outline-none"
                  />
                </div>
              </label>
            ))}
          </div>

          <p className="text-sm text-gray-500 mt-6">
            This is a simple planning snapshot, not tax, legal, or accounting
            advice.
          </p>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-3xl shadow-lg p-8">
            <h2 className="text-2xl font-bold mb-6">Snapshot results</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Metric label="Assets" value={formatCurrency(snapshot.assets)} />
              <Metric
                label="Liabilities"
                value={formatCurrency(snapshot.liabilities)}
              />
              <Metric label="Equity" value={formatCurrency(snapshot.equity)} />
              <Metric
                label="Monthly profit"
                value={formatCurrency(snapshot.profit)}
              />
              <Metric
                label="Monthly revenue"
                value={formatCurrency(snapshot.revenue)}
              />
              <Metric
                label="Monthly expenses"
                value={formatCurrency(snapshot.expenses)}
              />
            </div>
          </div>

          <div className="bg-blue-950 text-white rounded-3xl shadow-lg p-8">
            <h2 className="text-2xl font-bold mb-3">Business health note</h2>
            <p className="text-blue-100 text-lg">{healthMessage(snapshot)}</p>

            <div className="mt-6 rounded-2xl bg-white/10 p-4">
              <p className="text-sm text-blue-100">Estimated profit margin</p>
              <p className="text-3xl font-extrabold">
                {(snapshot.margin * 100).toFixed(1)}%
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-16 grid grid-cols-1 lg:grid-cols-2 gap-8">
        <ReportCard title="Balance Sheet" sections={snapshot.balanceSheet} />
        <ReportCard
          title="Income Statement"
          sections={snapshot.incomeStatement}
        />
      </section>
    </main>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-2xl border bg-gray-50 p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-extrabold mt-1">{value}</p>
    </div>
  );
}

function ReportCard({ title, sections }) {
  return (
    <div className="bg-white rounded-3xl shadow-lg p-8">
      <h2 className="text-2xl font-bold mb-6">{title}</h2>

      <div className="space-y-6">
        {sections.map((section) => (
          <div key={section.name}>
            <h3 className="font-bold text-gray-700 mb-3">{section.name}</h3>

            <div className="divide-y rounded-2xl border">
              {section.lines.map((line) => (
                <div
                  key={`${section.name}-${line.label}`}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <span className="font-medium">{line.label}</span>
                  <span className="font-bold">
                    {formatCurrency(line.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
