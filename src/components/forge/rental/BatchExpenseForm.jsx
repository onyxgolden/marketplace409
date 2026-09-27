"use client";
import { useEffect, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { ForgeLoadingState } from "@/components/forge/ForgeStates";
import { MANUAL_FINANCIAL_EVENT_CATEGORIES } from "@/application/financial/manualFinancialEventCategories";

const today = () => new Date().toISOString().slice(0, 10);
const blankRow = () => ({ eventDate: today(), payee: "", normalizedCategory: "property_repairs", amount: "", memo: "" });
const inputClass = "w-full min-w-0 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validateRow(row) {
  const errors = [];
  if (!DATE_PATTERN.test(row.eventDate)) errors.push("date");
  if (!row.payee.trim()) errors.push("payee");
  const amount = Number(row.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.push("amount");
  if (!row.normalizedCategory) errors.push("category");
  return errors;
}

async function fetchCategories() {
  const response = await fetch("/api/rental/chart-of-accounts");
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Unable to load accounts.");
  return (body.accounts || [])
    .filter((account) => account.account_type === "expense" && account.is_active)
    .map((account) => ({ value: account.code, label: account.label }));
}

// Batch expense entry: a spreadsheet-like grid for posting many expenses in
// one call. Valid rows post together; rows with problems are flagged in place
// and nothing the user typed is lost.
export default function BatchExpenseForm() {
  const [rows, setRows] = useState(() => Array.from({ length: 5 }, blankRow));
  const [categories, setCategories] = useState(null);
  const [rowErrors, setRowErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch(() => setCategories(MANUAL_FINANCIAL_EVENT_CATEGORIES.filter((c) => !["rental_income", "cam_income"].includes(c.value))));
  }, []);

  const updateRow = (index, field, value) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
    setRowErrors((current) => {
      const next = { ...current };
      delete next[index];
      return next;
    });
  };

  const addRow = () => setRows((current) => [...current, blankRow()]);
  const removeRow = (index) => {
    setRows((current) => current.filter((_, i) => i !== index));
    setRowErrors((current) => {
      const next = {};
      Object.entries(current).forEach(([key, value]) => {
        const i = Number(key);
        if (i < index) next[i] = value;
        else if (i > index) next[i - 1] = value;
      });
      return next;
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    setSubmitError("");
    setResult(null);

    // Skip completely empty rows; validate the rest client-side first.
    const candidates = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.payee.trim() || row.amount || row.memo.trim());
    if (candidates.length === 0) {
      setSubmitError("Enter at least one expense row.");
      return;
    }
    const clientErrors = {};
    candidates.forEach(({ row, index }) => {
      const problems = validateRow(row);
      if (problems.length > 0) clientErrors[index] = problems;
    });
    setRowErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) return;

    setSubmitting(true);
    try {
      const response = await fetch("/api/rental/transactions/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rows: candidates.map(({ row }) => ({
            eventDate: row.eventDate,
            description: row.payee.trim(),
            payee: row.payee.trim(),
            normalizedCategory: row.normalizedCategory,
            amount: Number(row.amount),
            memo: row.memo.trim() || undefined,
          })),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to post the batch.");

      // Map server-side per-row errors back to the visible row indexes.
      const serverErrors = {};
      (body.errors || []).forEach((entry) => {
        const visibleIndex = candidates[entry.index] ? candidates[entry.index].index : entry.index;
        serverErrors[visibleIndex] = entry.errors;
      });
      setRowErrors(serverErrors);
      setResult({ created: body.created || 0, failed: (body.errors || []).length });
    } catch (postError) {
      setSubmitError(postError.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (categories === null) return <ForgeLoadingState label="Loading batch entry" />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-slate-100">Batch Entry</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Post many expenses at once. Empty rows are skipped; every row is an expense.</p>
      </div>

      {submitError && <p className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-4 py-2 text-sm text-red-700 dark:text-red-300">{submitError}</p>}
      {result && (
        <p className={`rounded-lg border px-4 py-2 text-sm ${result.failed > 0 ? "bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200" : "bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200"}`}>
          Posted {result.created} expense{result.created === 1 ? "" : "s"}{result.failed > 0 ? ` — ${result.failed} row${result.failed === 1 ? "" : "s"} need${result.failed === 1 ? "s" : ""} attention below` : ""}.
        </p>
      )}

      <form onSubmit={submit}>
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[720px] border-collapse bg-white dark:bg-slate-900 text-sm">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800 text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Payee</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Memo</th>
                <th className="px-3 py-2" aria-label="Remove row" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const problems = rowErrors[index];
                return (
                  <tr key={index} className={`border-t border-slate-200 dark:border-slate-700 ${problems ? "bg-red-50/60 dark:bg-red-950/30" : ""}`}>
                    <td className="px-2 py-2">
                      <input type="date" value={row.eventDate} onChange={(e) => updateRow(index, "eventDate", e.target.value)} className={inputClass} aria-label={`Row ${index + 1} date`} />
                    </td>
                    <td className="px-2 py-2">
                      <input value={row.payee} onChange={(e) => updateRow(index, "payee", e.target.value)} className={inputClass} placeholder="Payee" aria-label={`Row ${index + 1} payee`} />
                    </td>
                    <td className="px-2 py-2">
                      <select value={row.normalizedCategory} onChange={(e) => updateRow(index, "normalizedCategory", e.target.value)} className={inputClass} aria-label={`Row ${index + 1} category`}>
                        {categories.map((category) => (
                          <option key={category.value} value={category.value}>{category.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input inputMode="decimal" value={row.amount} onChange={(e) => updateRow(index, "amount", e.target.value)} className={inputClass} placeholder="0.00" aria-label={`Row ${index + 1} amount`} />
                    </td>
                    <td className="px-2 py-2">
                      <input value={row.memo} onChange={(e) => updateRow(index, "memo", e.target.value)} className={inputClass} placeholder="Memo" aria-label={`Row ${index + 1} memo`} />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button type="button" onClick={() => removeRow(index)} className="text-lg font-black text-slate-400 hover:text-red-600" aria-label={`Remove row ${index + 1}`}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {Object.keys(rowErrors).length > 0 && (
          <ul className="mt-2 space-y-1">
            {Object.entries(rowErrors).map(([index, problems]) => (
              <li key={index} className="text-sm text-red-600 dark:text-red-400">
                Row {Number(index) + 1}: {Array.isArray(problems) ? problems.join(", ") : "check this row"} {Array.isArray(problems) && problems.every((p) => ["date", "payee", "amount", "category"].includes(p)) ? "— fill in the highlighted fields" : ""}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={addRow} className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm font-bold text-slate-700 dark:text-slate-200">
            + Add row
          </button>
          <button type="submit" disabled={submitting} className={goldControlClassName}>
            {submitting ? "Posting…" : "Post expenses"}
          </button>
        </div>
      </form>
    </div>
  );
}
