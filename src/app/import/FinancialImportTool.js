"use client";

import { useState } from "react";
import { FinancialImportService } from "@/domains/financial-import/financial-import.service";
import { buildProductionChartOfAccounts } from "@/domains/production";
import { Money } from "@/platform";

function formatCurrency(value) {
  return new Money(Math.round(Number(value || 0) * 100)).toString();
}

function formatReportCurrency(value) {
  return new Money(value).toString();
}

function reportSections(report) {
  if (!report || typeof report.sections !== "function") {
    return [];
  }

  return report.sections().map((section) => ({
    name: section.name,
    lines: section.lines().map((line) => ({
      label: line.label,
      amount: line.amount,
    })),
  }));
}

export default function FinancialImportTool() {
  const [source, setSource] = useState("rentec");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function handleFileChange(event) {
    const file = event.target.files?.[0];

    setError("");
    setResult(null);

    if (!file) {
      setFileName("");
      return;
    }

    setFileName(file.name);

    try {
      const csv = await file.text();

      const importResult = FinancialImportService.importCsv({
        source,
        csv,
        chartOfAccounts: buildProductionChartOfAccounts(),
      });

      setResult(importResult);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to import financial CSV."
      );
    }
  }

  return (
    <section className="max-w-6xl mx-auto px-6 py-12">
      <div className="bg-white rounded-3xl shadow-xl p-8 mb-8">
        <h1 className="text-5xl font-extrabold mb-4">
          Financial Import
        </h1>

        <p className="text-xl text-gray-600 mb-8">
          Upload a Rentec or QuickBooks CSV and let Forge convert it into financial events,
          ledger postings, and accounting reports.
        </p>

        <label className="block mb-6">
          <span className="font-bold text-lg">Import Source</span>
          <select
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setFileName("");
              setResult(null);
              setError("");
            }}
            className="mt-3 block w-full rounded-xl border bg-gray-50 px-4 py-4"
          >
            <option value="rentec">Rentec</option>
            <option value="quickbooks">QuickBooks</option>
          </select>
        </label>

        <label className="block">
          <span className="font-bold text-lg">Financial CSV File</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="mt-3 block w-full rounded-xl border bg-gray-50 px-4 py-4"
          />
        </label>

        {fileName && (
          <p className="text-sm text-gray-500 mt-4">
            Selected file: <span className="font-semibold">{fileName}</span>
          </p>
        )}

        {error && (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800 font-semibold">
            {error}
          </div>
        )}
      </div>

      {result && (
        <div className="space-y-8">
          <ImportSummary summary={result.summary} />

          <ParsedRecords records={result.records} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <ReportCard
              title="Balance Sheet"
              sections={reportSections(result.reports.balanceSheet)}
            />

            <ReportCard
              title="Income Statement"
              sections={reportSections(result.reports.incomeStatement)}
            />
          </div>

          <ReportCard
            title="Trial Balance"
            sections={reportSections(result.reports.trialBalance)}
          />
        </div>
      )}
    </section>
  );
}

function ImportSummary({ summary }) {
  return (
    <div className="bg-white rounded-3xl shadow-lg p-8">
      <h2 className="text-2xl font-bold mb-6">Import Summary</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Metric label="Total rows" value={summary.totalRows} />
        <Metric label="Imported rows" value={summary.importedRows} />
        <Metric label="Skipped rows" value={summary.skippedRows} />
        <Metric label="Properties" value={summary.properties.length} />
        <Metric label="Total income" value={formatCurrency(summary.totalIncome)} />
        <Metric
          label="Total expenses"
          value={formatCurrency(summary.totalExpenses)}
        />
      </div>

      <div className="rounded-2xl border bg-gray-50 p-5">
        <p className="font-bold mb-2">Imported properties</p>
        <p className="text-gray-700">
          {summary.properties.length > 0
            ? summary.properties.join(", ")
            : "No properties detected."}
        </p>
      </div>
    </div>
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

function ParsedRecords({ records }) {
  return (
    <div className="bg-white rounded-3xl shadow-lg p-8">
      <h2 className="text-2xl font-bold mb-6">Parsed Records</h2>

      <div className="overflow-x-auto rounded-2xl border">
        <table className="w-full text-left">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Property</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3 text-right">Income</th>
              <th className="px-4 py-3 text-right">Expense</th>
            </tr>
          </thead>

          <tbody className="divide-y">
            {records.map((record, index) => (
              <tr key={`${record.date}-${record.property}-${index}`}>
                <td className="px-4 py-3">{record.date}</td>
                <td className="px-4 py-3">{record.property}</td>
                <td className="px-4 py-3">{record.description}</td>
                <td className="px-4 py-3 text-right">
                  {formatCurrency(record.income)}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatCurrency(record.expense)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
                    {formatReportCurrency(line.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {sections.length === 0 && (
          <p className="text-gray-500">No report lines available.</p>
        )}
      </div>
    </div>
  );
}
