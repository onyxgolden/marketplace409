// R13: tenant portal payment-schedule block -- shows the tenant's payment
// frequency in plain English, the whole-cent amount of each payment, and the
// next due date. The tenant can change their own frequency directly; the
// change posts to /api/rental/portal (operation "change-payment-frequency"),
// which resets the cadence from the change date and notifies the owner in the
// in-portal conversation thread.
import { useState } from "react";
import PaymentFrequencyPicker from "./PaymentFrequencyPicker";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function TenantPaymentSchedulePanel({ leaseId, billingCadence, onChanged }) {
  const [changing, setChanging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  if (!billingCadence) return null;
  async function changeFrequency(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const paymentFrequency = form.get("paymentFrequency");
    if (!paymentFrequency || paymentFrequency === billingCadence.frequency) { setChanging(false); return; }
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/rental/portal", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "change-payment-frequency", leaseId, paymentFrequency }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to change the payment schedule.");
      setChanging(false);
      setMessage("Payment schedule updated. Your landlord has been notified.");
      await onChanged?.();
    } catch (error) { setMessage(error.message); } finally { setSaving(false); }
  }
  return <div className="mt-8 border-t pt-6">
    <h3 className="font-black">Payment schedule</h3>
    <p className="mt-1 text-sm text-slate-500">
      {billingCadence.frequencyLabel} — {money.format(billingCadence.perPaymentCents / 100)} per payment.
      {billingCadence.nextDueDate ? ` Next payment due ${dateFormat.format(new Date(`${billingCadence.nextDueDate}T00:00:00`))}.` : ""}
    </p>
    {message && <p role="status" className="mt-2 text-sm font-bold text-slate-700">{message}</p>}
    {changing ? (
      <form onSubmit={changeFrequency} className="mt-3 flex flex-wrap items-end gap-3">
        <PaymentFrequencyPicker name="paymentFrequency" defaultValue={billingCadence.frequency}
          className="mt-1 rounded-xl border border-slate-300 bg-white px-4 py-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
        <button disabled={saving} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {saving ? "Saving…" : "Change schedule"}
        </button>
        <button type="button" disabled={saving} onClick={() => setChanging(false)}
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50">
          Cancel
        </button>
        <p className="w-full text-xs text-slate-500">Future charges follow the new schedule starting today. Charges already posted keep their original terms.</p>
      </form>
    ) : (
      <button type="button" onClick={() => { setChanging(true); setMessage(""); }}
        className="mt-3 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700">
        Change payment schedule
      </button>
    )}
  </div>;
}
