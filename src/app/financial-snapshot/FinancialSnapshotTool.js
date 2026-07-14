"use client";

import { useEffect, useMemo, useState } from "react";
import { createFinancialApplicationSuite } from "@/infrastructure/composition/createFinancialApplicationSuite.js";
import { Money } from "@/platform";

function formatCurrency(cents) {
  return new Money(cents).toString();
}

export default function FinancialSnapshotTool() {
  const [snapshotApplication, setSnapshotApplication] = useState(null);

  const [form, setForm] = useState({
    cash: "10000",
    receivables: "2500",
    debt: "4000",
    revenue: "12000",
    expenses: "8500",
  });

  useEffect(() => {
    let active = true;

    createFinancialApplicationSuite().then((suite) => {
      if (active) {
        setSnapshotApplication(suite.snapshotApplication);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  const snapshot = useMemo(
    () => snapshotApplication?.buildSnapshot(form) ?? null,
    [snapshotApplication, form],
  );

  if (!snapshot) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p>Loading financial tools...</p>
      </main>
    );
  }

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
            <p className="text-blue-100 text-lg">{snapshot.healthMessage}</p>

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
