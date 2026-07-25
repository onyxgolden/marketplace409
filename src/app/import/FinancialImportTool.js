"use client";

import { useEffect, useState } from "react";
import { Money } from "@/platform";

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

export default function FinancialImportTool({
  financialImportApplication,
  transactionReviewApplication,
}) {
  const [source, setSource] = useState("rentec");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [ownerId, setOwnerId] = useState(null);
  const [properties, setProperties] = useState([]);
  const [selectedProperties, setSelectedProperties] = useState({});
  const [selectedReviewItems, setSelectedReviewItems] = useState({});
  const [assignmentStatus, setAssignmentStatus] = useState({});

  useEffect(() => {
    async function initializeImportTool() {
      const initialized =
        await financialImportApplication.initialize();

      setOwnerId(initialized.ownerId);
      setProperties(initialized.properties);
      setError(initialized.error);
    }

    initializeImportTool();
  }, [financialImportApplication]);

  async function handleFileChange(event) {
    const file = event.target.files?.[0];

    setError("");
    setResult(null);
    setSelectedProperties({});
    setSelectedReviewItems({});
    setAssignmentStatus({});


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

  function applyAssignmentResult(assignmentResult) {

    const reviewApplication =
      transactionReviewApplication;

    const nextState = reviewApplication.applyAssignmentResult({
      currentResult: result,
      selectedReviewItems,
      assignmentStatus,
      assignmentResult,
    });

    setResult(nextState.result);
    setSelectedReviewItems(nextState.selectedReviewItems);
    setAssignmentStatus(nextState.assignmentStatus);
  }

  async function assignProperty(reviewItem, index) {

    const reviewApplication =
      transactionReviewApplication;

    const assignmentResult = await reviewApplication.assignProperty({
      reviewItem,
      index,
      properties,
      selectedProperties,
      ownerId,
    });

    applyAssignmentResult(assignmentResult);
  }

  async function assignSelectedProperties() {

    const reviewApplication =
      transactionReviewApplication;

    const assignmentResult = await reviewApplication.assignSelectedProperties({
      reviews: result?.transactionReview || [],
      properties,
      selectedProperties,
      selectedReviewItems,
      ownerId,
    });

    applyAssignmentResult(assignmentResult);
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
              setSelectedProperties({});
              setSelectedReviewItems({});
              setAssignmentStatus({});
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

          <TransactionReview
            reviews={result.transactionReview || []}
            properties={properties}
            selectedProperties={selectedProperties}
            setSelectedProperties={setSelectedProperties}
            selectedReviewItems={selectedReviewItems}
            setSelectedReviewItems={setSelectedReviewItems}
            assignmentStatus={assignmentStatus}
            assignProperty={assignProperty}
            assignSelectedProperties={assignSelectedProperties}
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

function TransactionReview({
  reviews,
  properties,
  selectedProperties,
  setSelectedProperties,
  selectedReviewItems,
  setSelectedReviewItems,
  assignmentStatus,
  assignProperty,
  assignSelectedProperties,
}) {
  const needsReview = reviews.filter((review) => review.needsAssignment);

  const selectedCount = Object.values(selectedReviewItems).filter(Boolean).length;

  const allSelectableIndexes = reviews
    .map((review, index) => (review.needsAssignment ? index : null))
    .filter((index) => index !== null);

  const allSelected =
    allSelectableIndexes.length > 0 &&
    allSelectableIndexes.every((index) => selectedReviewItems[index]);

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedReviewItems({});
      return;
    }

    const nextSelection = {};

    allSelectableIndexes.forEach((index) => {
      nextSelection[index] = true;
    });

    setSelectedReviewItems(nextSelection);
  }

  return (
    <div className="bg-white rounded-3xl shadow-lg p-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold">Transaction Review</h2>
          <p className="text-gray-600 mt-1">
            Assign unknown transactions to a property so Forge can learn future rules.
          </p>
        </div>

        <div className="rounded-2xl border bg-gray-50 px-5 py-3 font-bold">
          {needsReview.length} need assignment
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 rounded-2xl border bg-gray-50 px-5 py-4">
        <div className="font-semibold">
          {selectedCount} transaction{selectedCount === 1 ? "" : "s"} selected
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={toggleSelectAll}
            className="rounded-xl border px-4 py-2 font-semibold hover:bg-white"
          >
            {allSelected ? "Clear All" : "Select All"}
          </button>

          <button
            type="button"
            onClick={assignSelectedProperties}
            disabled={selectedCount === 0}
            className="rounded-xl bg-green-700 px-4 py-2 font-bold text-white disabled:bg-gray-400"
          >
            Assign Selected
          </button>

          <button
            type="button"
            onClick={() => setSelectedReviewItems({})}
            disabled={selectedCount === 0}
            className="rounded-xl border px-4 py-2 font-semibold disabled:opacity-50"
          >
            Clear Selection
          </button>
        </div>
      </div>

      {reviews.length === 0 ? (
        <p className="text-gray-500">No transaction review items available.</p>
      ) : (
        <div className="space-y-4">
          {reviews.map((review, index) => {
            const status = assignmentStatus[index];
            const recommendations = review.recommendations || [];
            const topRecommendation = recommendations[0];

            return (
              <div
                key={`${review.transaction?.id || review.record?.date}-${index}`}
                className="rounded-2xl border bg-gray-50 p-5"
              >
                <div className="grid grid-cols-1 lg:grid-cols-6 gap-4 items-center">
                  <label className="flex items-center gap-3 font-semibold">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedReviewItems[index])}
                      onChange={(event) =>
                        setSelectedReviewItems((current) => ({
                          ...current,
                          [index]: event.target.checked,
                        }))
                      }
                      disabled={!review.needsAssignment}
                      className="h-5 w-5"
                    />
                    Select
                  </label>

                  <div className="lg:col-span-2">
                    <p className="font-bold">{review.transaction?.description || "No description"}</p>
                    <p className="text-sm text-gray-500">
                      {review.transaction?.date} · {formatReportCurrency(review.transaction?.amountCents || 0)}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 font-bold">
                      Current Property
                    </p>
                    <p className="font-semibold">
                      {review.resolvedProperty?.name || review.record?.property || "Unknown Property"}
                    </p>
                  </div>

                  <select
                    value={selectedProperties[index] || ""}
                    onChange={(event) =>
                      setSelectedProperties((current) => ({
                        ...current,
                        [index]: event.target.value,
                      }))
                    }
                    disabled={!review.needsAssignment}
                    className="rounded-xl border bg-white px-4 py-3"
                  >
                    <option value="">
                      {review.needsAssignment ? "Select property" : "Already resolved"}
                    </option>

                    {properties.map((property) => (
                      <option key={property.id} value={property.id}>
                        {propertyLabel(property)}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => assignProperty(review, index)}
                    disabled={!review.needsAssignment || status?.type === "saving"}
                    className="rounded-xl bg-green-700 px-4 py-3 font-bold text-white disabled:bg-gray-400"
                  >
                    {status?.type === "saving" ? "Assigning..." : "Assign"}
                  </button>
                </div>

                {review.needsAssignment && topRecommendation && (
                  <div className="mt-4 rounded-2xl border bg-white p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
                          Forge Recommendation
                        </p>
                        <p className="mt-1 font-bold">
                          {propertyLabel(topRecommendation.property)}
                        </p>
                      </div>

                      <div className="rounded-xl border bg-gray-50 px-4 py-2 font-bold">
                        {Math.round((review.confidence || 0) * 100)}% confidence
                      </div>
                    </div>

                    <p className="mt-3 text-sm text-gray-700">
                      {topRecommendation.explanation}
                    </p>

                    {recommendations.length > 1 && (
                      <div className="mt-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
                          Other matches
                        </p>

                        <ul className="mt-2 space-y-1 text-sm text-gray-700">
                          {recommendations.slice(1).map((recommendation) => (
                            <li key={recommendation.property.id}>
                              {propertyLabel(recommendation.property)} ·{" "}
                              {Math.round(recommendation.score * 100)}%
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {status && (
                  <p
                    className={`mt-3 text-sm font-semibold ${
                      status.type === "error" ? "text-red-700" : "text-green-700"
                    }`}
                  >
                    {status.message}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
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
