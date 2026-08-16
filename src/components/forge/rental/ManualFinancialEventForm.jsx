"use client";
import { useState } from "react";
import { MANUAL_FINANCIAL_EVENT_CATEGORIES } from "@/application/financial/manualFinancialEventCategories";

const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = () => ({
  eventDate: today(),
  description: "",
  transactionKind: "expense",
  normalizedCategory: "property_repairs",
  amount: "",
  propertyId: "",
  paymentMethod: "cash",
});

export default function ManualFinancialEventForm({ availableProperties, onSaved }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccessMessage("");
    try {
      const response = await fetch("/api/rental/manual-financial-event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setSuccessMessage("Entry saved.");
      setForm(emptyForm());
      onSaved?.();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:border-slate-400 print:hidden"
      >
        + Add manual entry (cash payment / deposit)
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 print:hidden">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold uppercase tracking-wide text-slate-700">Add manual entry</p>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-slate-700">
          Cancel
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        For cash contractor payments, cash deposits, or anything that doesn&apos;t come through the bank feed.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <label className="text-sm">
          <span className="block font-bold text-slate-700">Date</span>
          <input
            type="date"
            required
            value={form.eventDate}
            onChange={update("eventDate")}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="block font-bold text-slate-700">Type</span>
          <select value={form.transactionKind} onChange={update("transactionKind")} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
            <option value="expense">Expense (paid out)</option>
            <option value="income">Income (received)</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block font-bold text-slate-700">Amount</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            required
            value={form.amount}
            onChange={update("amount")}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="text-sm md:col-span-2">
          <span className="block font-bold text-slate-700">Description</span>
          <input
            type="text"
            required
            placeholder="e.g. Cash payment to Gulf Coast Plumbing"
            value={form.description}
            onChange={update("description")}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="block font-bold text-slate-700">Category</span>
          <select value={form.normalizedCategory} onChange={update("normalizedCategory")} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
            {MANUAL_FINANCIAL_EVENT_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block font-bold text-slate-700">Property</span>
          <select value={form.propertyId} onChange={update("propertyId")} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
            <option value="">Unassigned / general</option>
            {availableProperties.filter((id) => id !== "unassigned").map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block font-bold text-slate-700">Payment method</span>
          <select value={form.paymentMethod} onChange={update("paymentMethod")} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
            <option value="cash">Cash</option>
            <option value="check">Check</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {successMessage && (
        <p className="mt-3 rounded-lg bg-green-50 p-2 text-sm text-green-800">{successMessage}</p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="mt-4 rounded-lg bg-slate-950 px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
      >
        {submitting ? "Saving…" : "Save entry"}
      </button>
    </form>
  );
}
