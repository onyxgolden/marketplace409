"use client";
import { useMemo, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { isOverpayment, splitOfflineOverpayment } from "@/domains/rental-payment/tenantCredit";

const today = () => new Date().toISOString().slice(0, 10);
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

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
// record-offline-payment operation: the income posts against the selected open charge,
// and the tenant ledger picks the new payment row up on reload.
//
// Overpayments: when the amount exceeds the charge's remaining balance, the form does
// NOT silently post it — it shows the exact split (applied vs. credit) and requires the
// reconciliation human gate (checkbox + typing CONFIRM) before submitting with
// allowOverpaymentCredit. The excess becomes an open tenant credit, auto-applied to the
// next generated charge for the lease.
const OVERPAYMENT_CONFIRM_WORD = "CONFIRM";

function newIdempotencyKey() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* fall through to the counter fallback */ }
  return `form-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export default function PostIncomeForm({ tenantId, tenantName, openCharges = [], defaultChargeId = null, onSaved, onCancel, onStaleBalance }) {
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [chargeId, setChargeId] = useState(defaultChargeId || openCharges[0]?.id || "");
  const [reference, setReference] = useState("");
  const [memo, setMemo] = useState("");
  const [alreadyDeposited, setAlreadyDeposited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [overpayment, setOverpayment] = useState(null);
  const [overpaymentChecked, setOverpaymentChecked] = useState(false);
  const [overpaymentTyped, setOverpaymentTyped] = useState("");
  // Idempotency key: one per submission intent. Stable across retries of the same
  // intent (network failure, confirm-panel resubmit) so a repeated POST replays
  // instead of recording the receipt twice; regenerated whenever the intent changes
  // (amount, date, method, or charge edited) or after a successful post.
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const touchIntent = () => setIdempotencyKey(newIdempotencyKey());

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
    if (!["cash", "cashiers_check"].includes(paymentMethod)) return "Choose a supported payment type.";
    return "";
  }

  async function submit(event) {
    event.preventDefault();
    const problem = validate();
    if (problem) { setError(problem); return; }
    const cents = Math.round(Number(amount) * 100);
    // Overpayment: pause and show the exact split behind the human gate instead of
    // posting. The second submit (from the confirm panel) carries the confirmation.
    if (!overpayment && isOverpayment(cents, selectedCharge.remainingCents)) {
      const split = splitOfflineOverpayment(cents, selectedCharge.remainingCents);
      setOverpayment({ ...split, chargeLabel: selectedCharge.period || selectedCharge.dueDate || "open charge" });
      setOverpaymentChecked(false);
      setOverpaymentTyped("");
      setError("");
      return;
    }
    if (overpayment && (!overpaymentChecked || overpaymentTyped.trim().toUpperCase() !== OVERPAYMENT_CONFIRM_WORD)) {
      setError(`To record this overpayment, check the confirmation and type ${OVERPAYMENT_CONFIRM_WORD}.`);
      return;
    }
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
            tenantId: tenantId || null,
            paymentMethod,
            amountCents: cents,
            receivedAt: new Date(`${date}T12:00:00`).toISOString(),
            receiptReference: reference.trim() || null,
            notes: memo.trim() || null,
            allowOverpaymentCredit: Boolean(overpayment),
            idempotencyKey,
            depositState: alreadyDeposited ? "deposited" : "received",
          },
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to post income.");
      setOverpayment(null);
      setIdempotencyKey(newIdempotencyKey());
      onSaved?.(body.payment);
    } catch (caught) {
      const message = caught.message || "Unable to post income.";
      if (/remaining/i.test(message)) {
        // The charge's remaining balance changed between the form loading and the
        // submit (another payment landed, or the charge was edited). The backend
        // RPC is the authority and refused the application — refresh the
        // authoritative open-charges list so the next attempt validates live numbers.
        onStaleBalance?.();
        setOverpayment(null);
        setError(`${message} The charge list was refreshed with the latest balances — review the amount and submit again.`);
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  }

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
            <input type="date" required value={date} max={today()} onChange={(event) => { setDate(event.target.value); touchIntent(); }}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
          </label>
          <label className="text-sm font-bold text-slate-900 dark:text-white">Amount
            <input type="number" step="0.01" min="0.01" required value={amount} onChange={(event) => { setAmount(event.target.value); touchIntent(); }}
              placeholder="0.00" inputMode="decimal"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
          </label>
          <label className="text-sm font-bold text-slate-900 dark:text-white">Payment type
            <select value={paymentMethod} onChange={(event) => { setPaymentMethod(event.target.value); touchIntent(); }}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 dark:border-slate-600 dark:bg-slate-900 dark:text-white">
              <option value="cash">Cash</option>
              <option value="cashiers_check">Cashier&apos;s check</option>
            </select>
          </label>
          <label className="text-sm font-bold text-slate-900 dark:text-white">Apply to
            <select value={effectiveChargeId} onChange={(event) => { setChargeId(event.target.value); touchIntent(); }}
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
          <label className="flex items-start gap-2 text-sm font-bold text-slate-900 dark:text-white sm:col-span-2">
            <input type="checkbox" checked={alreadyDeposited} onChange={(event) => { setAlreadyDeposited(event.target.checked); touchIntent(); }}
              className="mt-1 h-4 w-4 accent-amber-600" />
            <span>Already deposited — this money is in the bank account, not just in hand.
              <span className="block font-normal text-slate-500 dark:text-slate-400">Leave unchecked when you still need to deposit the cash or check.</span></span>
          </label>
        </div>}
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {overpayment && (
        <div data-overpayment-confirm className="mt-4 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-600 dark:bg-amber-950/30">
          <p className="text-sm font-black text-amber-900 dark:text-amber-200">Overpayment — confirm the split</p>
          <p className="mt-2 text-sm text-amber-900 dark:text-amber-200">
            This payment exceeds the {overpayment.chargeLabel} remaining balance. Posting it will:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-bold text-amber-900 dark:text-amber-200">
            <li>Apply {money.format(overpayment.appliedCents / 100)} to the charge (settles it in full).</li>
            <li>Record {money.format(overpayment.creditCents / 100)} as an open credit on the tenant&apos;s lease, auto-applied to the next rent charge.</li>
          </ul>
          <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
            The payment row keeps the full received amount so the receipt stays traceable; the credit is a balance-neutral memo in the ledger.
          </p>
          <label className="mt-3 flex items-start gap-2 text-sm font-bold text-amber-900 dark:text-amber-200">
            <input type="checkbox" checked={overpaymentChecked} onChange={(event) => setOverpaymentChecked(event.target.checked)}
              className="mt-1 h-4 w-4 accent-amber-600" />
            I confirm this is a genuine overpayment and the {money.format(overpayment.creditCents / 100)} excess should be held as a tenant credit.
          </label>
          <label className="mt-3 block text-sm font-bold text-amber-900 dark:text-amber-200">Type {OVERPAYMENT_CONFIRM_WORD} to record it
            <input value={overpaymentTyped} onChange={(event) => setOverpaymentTyped(event.target.value)} placeholder={OVERPAYMENT_CONFIRM_WORD}
              className="mt-1 w-full rounded-xl border border-amber-400 bg-white px-4 py-2.5 dark:border-amber-600 dark:bg-slate-900 dark:text-white" />
          </label>
          <button type="button" onClick={() => { setOverpayment(null); setError(""); }}
            className="mt-3 text-sm font-bold text-amber-800 underline hover:text-amber-900 dark:text-amber-300">
            Back — change the amount instead
          </button>
        </div>
      )}
      {openCharges.length > 0 && (
        <button type="submit" disabled={submitting}
          className={`mt-4 rounded-xl px-5 py-3 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>
          {submitting ? "Posting…" : overpayment ? "Post payment + record credit" : "Post income"}
        </button>
      )}
    </form>
  );
}
