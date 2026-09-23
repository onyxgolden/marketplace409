"use client";
import { useMemo, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const today = () => new Date().toISOString().slice(0, 10);

// The income category is derived from the charge being paid — there is no category
// column on rental_payments, so the form never invents one. A rent charge posts as
// Rental Income; anything else labels itself honestly from the charge type.
export function incomeCategoryForChargeType(chargeType) {
  switch (chargeType) {
    case "rent": return "Rental Income";
    case "proration": return "Prorated Rent Income";
    case "late_fee": return "Late Fee Income";
    default: return "Other Income";
  }
}

// Post Income — the Rentec-style "record money received" form. Writes through the
// existing record-offline-payment operation (no new endpoint, no migration): the income
// posts against the selected open charge, and the tenant ledger picks the new payment
// row up on reload.
export default function PostIncomeForm({ tenantName, openCharges = [], defaultChargeId = null, onSaved, onCancel, onStaleBalance }) {
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [chargeId, setChargeId] = useState(defaultChargeId || openCharges[0]?.id || "");
  const [reference, setReference] = useState("");
  const [memo, setMemo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // If the authoritative open-charges list refreshes (e.g. after a stale-balance
  // rejection) and the selected charge is gone, fall back to the first open charge.
  // Derived during render — no effect, no cascading render.
  const effectiveChargeId = openCharges.some((charge) => charge.id === chargeId)
    ? chargeId
    : openCharges[0]?.id || "";
  const selectedCharge = useMemo(
    () => openCharges.find((charge) => charge.id === effectiveChargeId) || null,
    [openCharges, effectiveChargeId],
  );
  const category = incomeCategoryForChargeType(selectedCharge?.chargeType);

  function validate() {
    if (!selectedCharge) return "Select an open charge to post this income against.";
    if (!date) return "A payment date is required.";
    if (date > today()) return "The payment date cannot be in the future.";
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0) return "Enter a positive payment amount.";
    if (cents > selectedCharge.remainingCents) {
      return `That exceeds the remaining balance on this charge (${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(selectedCharge.remainingCents / 100)}).`;
    }
    if (!["cash", "cashiers_check"].includes(paymentMethod)) return "Choose a supported payment type.";
    return "";
  }

  async function submit(event) {
    event.preventDefault();
    const problem = validate();
    if (problem) { setError(problem); return; }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/rental", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "record-offline-payment",
          payment: {
            chargeId: selectedCharge.id,
            paymentMethod,
            amountCents: Math.round(Number(amount) * 100),
            receivedAt: new Date(`${date}T12:00:00`).toISOString(),
            receiptReference: reference.trim() || null,
            notes: memo.trim() || null,
          },
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to post income.");
      onSaved?.(body.payment);
    } catch (caught) {
      const message = caught.message || "Unable to post income.";
      if (/remaining/i.test(message)) {
        // The charge's remaining balance changed between the form loading and the
        // submit (another payment landed, or the charge was edited). The backend
        // RPC is the authority and refused the application — refresh the
        // authoritative open-charges list so the next attempt validates live numbers.
        onStaleBalance?.();
        setError(`${message} The charge list was refreshed with the latest balances — review the amount and submit again.`);
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

  return (
    <form onSubmit={submit} data-post-income-form aria-label={`Post income for ${tenantName || "tenant"}`}
      className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-lg font-black text-slate-950 dark:text-white">Post income{tenantName ? ` — ${tenantName}` : ""}</h4>
        {onCancel && <button type="button" onClick={onCancel} className="text-sm font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">Cancel</button>}
      </div>
      {openCharges.length === 0
        ? <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-4 text-sm font-bold text-slate-600 dark:border-slate-700 dark:text-slate-400">
            There are no open charges for this tenant. Post a charge first, then record the income against it.</p>
        : <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold text-slate-900 dark:text-white">Date
            <input type="date" required value={date} max={today()} onChange={(event) => setDate(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
          </label>
          <label className="text-sm font-bold text-slate-900 dark:text-white">Amount
            <input type="number" step="0.01" min="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00" inputMode="decimal"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
          </label>
          <label className="text-sm font-bold text-slate-900 dark:text-white">Payment type
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 dark:border-slate-600 dark:bg-slate-900 dark:text-white">
              <option value="cash">Cash</option>
              <option value="cashiers_check">Cashier&apos;s check</option>
            </select>
          </label>
          <label className="text-sm font-bold text-slate-900 dark:text-white">Apply to
            <select value={effectiveChargeId} onChange={(event) => setChargeId(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 dark:border-slate-600 dark:bg-slate-900 dark:text-white">
              {openCharges.map((charge) => (
                <option key={charge.id} value={charge.id}>
                  {charge.period || charge.dueDate || "Open charge"} · {money.format(charge.remainingCents / 100)} remaining
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm font-bold text-slate-900 dark:text-white">Category
            <p data-income-category className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {category} <span className="font-normal text-slate-500">(from the charge)</span></p>
          </div>
          <label className="text-sm font-bold text-slate-900 dark:text-white">Check / ref #
            <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Optional"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
          </label>
          <label className="text-sm font-bold text-slate-900 dark:text-white sm:col-span-2">Memo
            <input value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="Optional note on this payment"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
          </label>
        </div>}
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {openCharges.length > 0 && (
        <button type="submit" disabled={submitting}
          className={`mt-4 rounded-xl px-5 py-3 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>
          {submitting ? "Posting…" : "Post income"}
        </button>
      )}
    </form>
  );
}
