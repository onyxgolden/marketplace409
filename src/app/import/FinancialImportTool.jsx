"use client";

import { useEffect, useState } from "react";
import { Money } from "@/platform";
import TransactionReviewContainer from "@/components/forge/TransactionReviewContainer";

function formatCurrency(value) {
  return new Money(Math.round(Number(value || 0) * 100)).toString();
}

function formatReportCurrency(value) {
  return new Money(value).toString();
}

function propertyLabel(property) {
  return property.name || property.address || property.id;
}

function recordIncome(record) {
  if (record.type === "income") {
    return Math.abs(Number(record.amount || 0));
  }

  if (Number(record.income || 0) > 0) {
    return record.income;
  }

  return 0;
}

function recordExpense(record) {
  if (record.type === "expense" || record.type === "asset_purchase") {
    return Math.abs(Number(record.amount || 0));
  }

  if (Number(record.expense || 0) > 0) {
    return record.expense;
  }

  return 0;
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

export function financialImportSurfaceClassName(
  hasResult,
) {
  return [
    "px-4 py-6 lg:px-8",
    hasResult
      ? "mx-auto max-w-[1800px]"
      : "max-w-3xl",
  ].join(" ");
}

export default function FinancialImportTool() {
  const [source, setSource] = useState("rentec");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [ownerId, setOwnerId] = useState(null);
  const [properties, setProperties] = useState([]);
  const [
    selectedProperties,
    setSelectedProperties,
  ] = useState({});

  useEffect(() => {
    async function initializeImportTool() {
      const response = await fetch(
        "/api/financial/import/bootstrap",
      );

      const payload = await response.json();

      const initialized =
        payload.success
          ? payload.data
          : {
              ownerId: null,
              properties: [],
              error:
                payload.error ||
                "Unable to initialize financial import.",
            };

      setOwnerId(initialized.ownerId);
      setProperties(initialized.properties);
      setError(initialized.error);
    }

    initializeImportTool();
  }, []);

  async function handleFileChange(event) {
    const file = event.target.files?.[0];

    setError("");
    setResult(null);
    const csv = await file.text();

    const response = await fetch(
      "/api/financial/import",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source,
          csv,
          fileName: file.name,
        }),
      },
    );

    const payload = await response.json();

    const importResponse =
      payload.success
        ? payload.data
        : {
            fileName: file.name,
            result: null,
            error:
              payload.error ||
              "Unable to import financial CSV.",
            ownerId,
            hasFile: true,
          };

    const recommendedSelections = {};

    (importResponse.result?.transactionReview || []).forEach(
      (review, index) => {
        const recommendedPropertyId =
          review.recommendations?.[0]?.property?.id ??
          review.suggestedProperties?.[0]?.id;

        if (review.needsAssignment && recommendedPropertyId) {
          recommendedSelections[index] = recommendedPropertyId;
        }
      },
    );

    setFileName(importResponse.fileName);
    setResult(importResponse.result);
    setSelectedProperties(recommendedSelections);
    setError(importResponse.error);

    if (importResponse.ownerId !== ownerId) {
      setOwnerId(importResponse.ownerId);
    }
  }

 return (   
  <section
    data-financial-import-tool
    data-import-result={
      result
        ? "ready"
        : "empty"
    }
    className={
      financialImportSurfaceClassName(
        Boolean(result),
      )
    }
  >
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-black text-slate-950">
          Financial Import
        </h1>

        <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-slate-600">
          Choose a supported financial source, upload its CSV, and review the converted financial events, ledger postings, and accounting reports.
        </p>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <label className="block">
          <span className="text-sm font-black text-slate-700">Import Source</span>
          <select
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setFileName("");
              setResult(null);
              setSelectedProperties({});
              setError("");
            }}
            className="mt-3 block w-full rounded-xl border bg-gray-50 px-4 py-4"
          >
            <option value="rentec">
              Rental records (Rentec CSV)
            </option>
            <option value="quickbooks">
              Financial records (QuickBooks CSV)
            </option>
          </select>

          <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">
            {source === "rentec"
              ? "Imports a Rentec-formatted CSV containing rental income, expenses, properties, and transactions."
              : "Imports a QuickBooks-formatted CSV containing financial transactions and accounting activity."}
          </p>
        </label>

        <label className="block">
          <span className="text-sm font-black text-slate-700">Financial CSV File</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="mt-3 block w-full rounded-xl border bg-gray-50 px-4 py-4"
          />
        </label>
        </div>

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

          <TransactionReviewContainer
            key={fileName}
            reviews={result.transactionReview || []}
            properties={properties}
            ownerId={ownerId}
            initialSelectedProperties={
              selectedProperties
            }
          />

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
  const properties = summary.properties || [];

  return (
    <div className="bg-white rounded-3xl shadow-lg p-8">
      <h2 className="text-2xl font-bold mb-6">Import Summary</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Metric label="Total rows" value={summary.totalRows} />
        <Metric label="Imported rows" value={summary.importedRows} />
        <Metric label="Skipped rows" value={summary.skippedRows} />
        <Metric label="Properties" value={properties.length} />
        <Metric label="Total income" value={formatCurrency(summary.totalIncome)} />
        <Metric
          label="Total expenses"
          value={formatCurrency(summary.totalExpenses)}
        />
      </div>

      <div className="rounded-2xl border bg-gray-50 p-5">
        <p className="font-bold mb-2">Imported properties</p>
        <p className="text-gray-700">
          {properties.length > 0
            ? properties.join(", ")
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
                  {formatCurrency(recordIncome(record))}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatCurrency(recordExpense(record))}
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
