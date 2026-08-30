"use client";

import { useMemo, useRef, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const centsToMoney = (cents) => money.format((cents ?? 0) / 100);
const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600";

const METHODS = [
  ["venmo", "Venmo"],
  ["cash_app", "Cash App"],
  ["zelle", "Zelle"],
  ["paypal", "PayPal"],
  ["bank_transfer", "Bank transfer / ACH"],
  ["cash", "Cash"],
  ["check", "Check"],
  ["money_order", "Money order"],
  ["other", "Other"],
];

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function dollarsToCents(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

function initialForm() {
  return {
    amount: "",
    paymentMethod: "",
    sourceReference: "",
    effectiveDate: todayISODate(),
    reason: "Seller confirmed external payment receipt",
    borrowerVisibleExplanation: "",
    externalEvidenceReference: "",
    internalNote: "",
    selectedExtraComponentId: "",
    acknowledgeOverpayment: false,
  };
}

export default function PrivateFinancingExternalPaymentForm({
  accountId,
  components = [],
  onPosted,
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState("idle");
  const [previewResult, setPreviewResult] = useState(null);
  const [error, setError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [duplicatesReviewed, setDuplicatesReviewed] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const inFlight = useRef(false);

  const inputs = useMemo(
    () => ({
      amountCents: dollarsToCents(form.amount),
      paymentMethod: form.paymentMethod,
      sourceReference: form.sourceReference.trim(),
      reason: form.reason.trim(),
      borrowerVisibleExplanation: form.borrowerVisibleExplanation.trim() || null,
      externalEvidenceReference: form.externalEvidenceReference.trim() || null,
      acknowledgeOverpayment: form.acknowledgeOverpayment,
      selectedExtraComponentId: form.selectedExtraComponentId || null,
    }),
    [form],
  );

  const reset = () => {
    setOpen(false);
    setForm(initialForm());
    setStatus("idle");
    setPreviewResult(null);
    setError("");
    setReviewed(false);
    setDuplicatesReviewed(false);
    setReceipt(null);
  };

  const update = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }));
    setPreviewResult(null);
    setStatus("idle");
    setReviewed(false);
    setDuplicatesReviewed(false);
  };

  const preview = async (event) => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus("previewing");
    setError("");
    try {
      const response = await fetch(
        `/api/private-financing/accounts/${accountId}/payments/external/preview`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...inputs, effectiveDate: form.effectiveDate }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to preview this payment.");
      setPreviewResult(payload);
      setStatus("ready");
    } catch (previewError) {
      setError(previewError.message);
      setStatus("error");
    } finally {
      inFlight.current = false;
    }
  };

  const hasDuplicates = (previewResult?.duplicateCandidates?.length ?? 0) > 0;
  const blockers = previewResult?.preview?.blockingValidation ?? [];
  const canConfirm =
    status === "ready" &&
    blockers.length === 0 &&
    reviewed &&
    (!hasDuplicates || duplicatesReviewed);

  const confirm = async () => {
    if (!canConfirm || inFlight.current) return;
    inFlight.current = true;
    setStatus("posting");
    setError("");
    try {
      const response = await fetch(
        `/api/private-financing/accounts/${accountId}/payments/external/confirm`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...inputs,
            effectiveDate: form.effectiveDate,
            internalNote: form.internalNote.trim() || null,
            previewToken: previewResult.previewToken,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to record this payment.");
      setReceipt(payload.event);
      setStatus("posted");
      onPosted?.();
    } catch (confirmError) {
      setError(confirmError.message);
      setStatus("error");
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <section
      aria-labelledby="pf-external-payment-heading"
      className="rounded-2xl border border-slate-200 p-5 dark:border-slate-700"
    >
      <h3 id="pf-external-payment-heading" className="text-lg font-black text-slate-950 dark:text-white">
        Record an external payment
      </h3>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
        Record money you already received through a payment app, bank transfer, cash, check, or money order.
        The borrower cannot post this entry, and FORGE does not move money during this workflow.
      </p>

      {!open ? (
        <button
          type="button"
          data-guided-workflow-control="open-external-payment"
          onClick={() => setOpen(true)}
          className={`mt-4 rounded-lg px-4 py-2 text-sm font-bold ${goldControlClassName} ${FOCUS_RING}`}
        >
          Record payment
        </button>
      ) : null}

      {open && !receipt ? (
        <form onSubmit={preview} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-bold text-slate-900 dark:text-white">
            Amount received
            <input
              type="number"
              min="0.01"
              step="0.01"
              required
              value={form.amount}
              onChange={(event) => update("amount", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
          <label className="text-sm font-bold text-slate-900 dark:text-white">
            Payment method
            <select
              required
              value={form.paymentMethod}
              onChange={(event) => update("paymentMethod", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            >
              <option value="">Select…</option>
              {METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="text-sm font-bold text-slate-900 dark:text-white">
            Date received
            <input
              type="date"
              max={todayISODate()}
              required
              value={form.effectiveDate}
              onChange={(event) => update("effectiveDate", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
          <label className="text-sm font-bold text-slate-900 dark:text-white">
            Transaction, check, or receipt reference
            <input
              type="text"
              required
              value={form.sourceReference}
              onChange={(event) => update("sourceReference", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
          <label className="text-sm font-bold text-slate-900 dark:text-white sm:col-span-2">
            Borrower-visible explanation (optional)
            <input
              type="text"
              value={form.borrowerVisibleExplanation}
              onChange={(event) => update("borrowerVisibleExplanation", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
          <label className="text-sm font-bold text-slate-900 dark:text-white">
            Private evidence reference (optional)
            <input
              type="text"
              value={form.externalEvidenceReference}
              onChange={(event) => update("externalEvidenceReference", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
          <label className="text-sm font-bold text-slate-900 dark:text-white">
            Internal note (optional)
            <input
              type="text"
              value={form.internalNote}
              onChange={(event) => update("internalNote", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
          {components.length > 1 ? (
            <label className="text-sm font-bold text-slate-900 dark:text-white">
              Extra-payment component (only when required by this account’s policy)
              <select
                value={form.selectedExtraComponentId}
                onChange={(event) => update("selectedExtraComponentId", event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              >
                <option value="">No selection</option>
                {components.map((component) => (
                  <option key={component.componentKey} value={component.componentKey}>{component.label}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex items-start gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <input
              type="checkbox"
              checked={form.acknowledgeOverpayment}
              onChange={(event) => update("acknowledgeOverpayment", event.target.checked)}
              className="mt-1"
            />
            Allow an unapplied/refundable overpayment if the preview identifies one.
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={status === "previewing"}
              data-guided-workflow-control="preview-external-payment"
              className={`rounded-lg px-4 py-2 text-sm font-bold ${goldControlClassName} ${FOCUS_RING}`}
            >
              {status === "previewing" ? "Previewing…" : "Preview payment"}
            </button>
            <button type="button" onClick={reset} className={`rounded-lg border px-4 py-2 text-sm font-bold ${FOCUS_RING}`}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {error ? <p role="alert" className="mt-3 text-sm font-bold text-red-800 dark:text-red-300">{error}</p> : null}

      {previewResult && !receipt ? (
        <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/30">
          <p className="font-black text-slate-950 dark:text-white">Review payment allocation</p>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
            Amount received: {centsToMoney(inputs.amountCents)}
          </p>
          {Object.entries(previewResult.preview.allocationBreakdown?.interestPaidByComponentCents ?? {}).map(([key, cents]) => (
            <p key={`interest-${key}`} className="text-sm text-slate-700 dark:text-slate-300">
              Interest — {key}: {centsToMoney(cents)}
            </p>
          ))}
          {Object.entries(previewResult.preview.allocationBreakdown?.principalPaidByComponentCents ?? {}).map(([key, cents]) => (
            <p key={`principal-${key}`} className="text-sm text-slate-700 dark:text-slate-300">
              Principal — {key}: {centsToMoney(cents)}
            </p>
          ))}
          {(previewResult.preview.allocationBreakdown?.unallocatedCents ?? 0) > 0 ? (
            <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
              Unapplied/refundable: {centsToMoney(previewResult.preview.allocationBreakdown.unallocatedCents)}
            </p>
          ) : null}

          {blockers.map((blocker) => <p key={blocker} role="alert" className="mt-2 text-sm font-bold text-red-800 dark:text-red-300">{blocker}</p>)}

          {hasDuplicates ? (
            <div className="mt-3 rounded-lg border border-amber-300 p-3">
              <p className="text-sm font-black text-amber-900 dark:text-amber-200">
                Possible duplicate payment found ({previewResult.duplicateCandidates.length})
              </p>
              <label className="mt-2 flex items-start gap-2 text-sm font-bold">
                <input type="checkbox" checked={duplicatesReviewed} onChange={(event) => setDuplicatesReviewed(event.target.checked)} />
                I reviewed the possible duplicate and still intend to record this payment.
              </label>
            </div>
          ) : null}

          {blockers.length === 0 ? (
            <>
              <label className="mt-3 flex items-start gap-2 text-sm font-bold text-slate-900 dark:text-white">
                <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
                I confirm this money was received and the allocation above is correct.
              </label>
              <button
                type="button"
                disabled={!canConfirm || status === "posting"}
                onClick={confirm}
                data-guided-workflow-control="confirm-external-payment"
                className={`mt-3 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950 ${FOCUS_RING}`}
              >
                {status === "posting" ? "Recording…" : "Confirm and record payment"}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {receipt ? (
        <div role="status" className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
          <p className="font-black text-emerald-900 dark:text-emerald-200">Payment recorded</p>
          <p className="text-sm text-emerald-900 dark:text-emerald-200">
            {centsToMoney(receipt.amountCents)} via {receipt.paymentMethod}; ledger #{receipt.ledgerSequence}.
          </p>
          <button type="button" onClick={reset} className={`mt-3 rounded-lg border px-3 py-1.5 text-sm font-bold ${FOCUS_RING}`}>Done</button>
        </div>
      ) : null}
    </section>
  );
}
