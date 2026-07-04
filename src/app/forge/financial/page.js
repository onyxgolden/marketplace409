"use client";

import { useEffect, useState } from "react";

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

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents(value) / 100);
}

function lineAmount(report, accountId) {
  return cents(report?._lines?.find((line) => line.label === accountId)?.amount);
}

export default function FinancialPage() {
  const [reports, setReports] = useState(null);
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    async function load() {
      const r1 = await fetch("/api/financial/reports").then((res) => res.json());
      const r2 = await fetch("/api/financial/snapshot").then((res) => res.json());

      setReports(r1?.data || null);
      setSnapshot(r2?.data || null);
    }

    load();
  }, []);

  const income = reports?.incomeStatement;
  const balance = reports?.balanceSheet;

  const cash = lineAmount(balance, "1000");
  const receivables = lineAmount(balance, "1100");
  const debt = Math.abs(lineAmount(balance, "2000"));
  const revenue = Math.abs(lineAmount(income, "4000"));
  const expenses = lineAmount(income, "5000");

  const assets = cash + receivables;
  const liabilities = debt;
  const equity = assets - liabilities;
  const profit = revenue - expenses;
  const margin = revenue ? profit / revenue : 0;

  const reportLines = balance?._lines || [];

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>Financial KPI Dashboard</h1>

      <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
        <Kpi title="Profit" value={money(profit)} />
        <Kpi title="Margin" value={`${(margin * 100).toFixed(2)}%`} />
        <Kpi title="Equity" value={money(equity)} />
        <Kpi title="Cash Position" value={money(cash)} />
      </div>

      <h2>Financial Statement</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
        <thead>
          <tr>
            <th style={cell}>Account</th>
            <th style={cell}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {reportLines.map((line) => (
            <tr key={line.label}>
              <td style={cell}>{ACCOUNT_NAMES[line.label] || line.label}</td>
              <td style={cell}>{money(line.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Debug</h2>
      <pre>{JSON.stringify({ reports, snapshot }, null, 2)}</pre>
    </div>
  );
}

function Kpi({ title, value }) {
  return (
    <div style={{ flex: 1, padding: 16, border: "1px solid #ccc", borderRadius: 8 }}>
      <h3>{title}</h3>
      <p style={{ fontSize: 24, fontWeight: "bold" }}>{value}</p>
    </div>
  );
}

const cell = {
  border: "1px solid #ddd",
  padding: 10,
  textAlign: "left",
};
