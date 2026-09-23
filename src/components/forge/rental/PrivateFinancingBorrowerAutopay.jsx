"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import PrivateFinancingAutopaySetupForm from "./PrivateFinancingAutopaySetupForm";
import ChargeDayPicker, { ordinalDayOfMonth, dayOfMonth } from "./ChargeDayPicker";

const KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

// Borrower-facing autopay controls for one financing account. Mirrors the rental
// TenantAutopayPanel flow: consent -> Stripe bank-account link + mandate -> active.
// ACH (US bank account) is the default and only autopay method in this slice.
// nextDueDate is the portal's already-computed next due date ("YYYY-MM-DD") for
// this account, when available; its day-of-month is highlighted in the picker as
// the suggested charge day. No new data is fetched and nothing is invented.
export default function PrivateFinancingBorrowerAutopay({ accountId, enrollments = [], nextDueDate = null, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [setup, setSetup] = useState(null);
  const current = enrollments.find((e) => ["setup_required", "active", "paused"].includes(e.status)) || null;
  // Start from the existing enrollment's charge day when one is already loaded,
  // so reopening the form never silently resets the user's configured day to 1.
  const [chargeDay, setChargeDay] = useState(() => current?.chargeDay ?? 1);
  // Portal enrollments can arrive after first render: sync the picker's day
  // then, but never clobber a day the user has already picked this session.
  const chargeDayPickedByUser = useRef(false);
  useEffect(() => {
    if (!chargeDayPickedByUser.current && current?.chargeDay) setChargeDay(current.chargeDay);
  }, [current?.chargeDay]);
  const pickChargeDay = (day) => { chargeDayPickedByUser.current = true; setChargeDay(day); };
  const stripe = useMemo(() => setup && KEY ? loadStripe(KEY, { stripeAccount: setup.connectedAccountId }) : null, [setup]);

  async function callOperation(operation, payload) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/private-financing/portal", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, ...payload }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Request failed.");
      return body;
    } finally {
      setBusy(false);
    }
  }

  async function requestAutopay(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await callOperation("request-autopay", { accountId, paymentMethodType: "us_bank_account",
        chargeDay: Number(form.get("chargeDay")), reminderDaysBefore: Number(form.get("reminderDaysBefore")),
        consentConfirmed: form.get("consentConfirmed") === "on" });
      setMessage("Consent recorded. Link your bank account to activate automatic payments.");
      onChanged();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function startBankLink() {
    try {
      const body = await callOperation("create-autopay-setup", { enrollmentId: current.id });
      setSetup(body);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function finishBankLink(setupIntentId) {
    if (!setupIntentId) throw new Error("Bank setup did not return a confirmation reference.");
    const body = await callOperation("complete-autopay-setup", { enrollmentId: current.id, setupIntentId });
    setSetup(null);
    setMessage(body.enrollment?.status === "active" ? "Autopay is active. Your monthly payment will debit automatically." : "Autopay updated.");
    onChanged();
  }

  async function cancelAutopay() {
    try {
      await callOperation("cancel-autopay", { enrollmentId: current.id, reason: "Cancelled by borrower in portal" });
      setMessage("Autopay enrollment cancelled.");
      onChanged();
    } catch (error) {
      setMessage(error.message);
    }
  }

  return <section className="mt-6 rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
    <p className="text-sm font-bold uppercase tracking-widest text-amber-700">Automatic payments</p>
    <h3 className="mt-2 text-lg font-black">Autopay</h3>
    {setup ? (
      <div className="mt-4">
        {stripe ? (
          <Elements stripe={stripe} options={{ clientSecret: setup.clientSecret, appearance: { theme: "stripe" } }}>
            <PrivateFinancingAutopaySetupForm onLinked={finishBankLink} onCancel={() => { setSetup(null); onChanged(); }} />
          </Elements>
        ) : <p role="status" className="text-sm">Loading secure bank form…</p>}
      </div>
    ) : current ? (
      <>
        <p className="mt-3 text-sm">Status: <strong>{current.status.replaceAll("_", " ")}</strong> · charged on the {ordinalDayOfMonth(current.chargeDay)} of each month · bank account (ACH)</p>
        <p className="mt-2 text-sm text-slate-600">
          {current.status === "setup_required"
            ? "No automatic debit can occur yet. Link your bank account below so Stripe can verify it and record your debit authorization."
            : current.status === "paused"
              ? "Automatic payments are paused after repeated failures. Link your bank account again or contact support to resume."
              : "Your monthly payment debits automatically. You may cancel future automatic payments at any time."}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {current.status !== "active" ? (
            <button disabled={busy} onClick={startBankLink} className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:opacity-50">
              {busy ? "Starting…" : "Link bank account"}
            </button>
          ) : null}
          <button disabled={busy} onClick={cancelAutopay} className="rounded-xl border px-4 py-3 font-bold disabled:opacity-50">Cancel autopay</button>
        </div>
      </>
    ) : (
      <form className="mt-4 grid gap-4" onSubmit={requestAutopay}>
        <label className="text-sm font-bold">Payment method
          <select name="paymentMethodType" disabled className="mt-1 w-full rounded-xl border bg-slate-50 p-3 font-normal text-slate-700">
            <option value="us_bank_account">US bank account (ACH) — lowest fees</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-bold">Charge day (day of the month)
            <ChargeDayPicker value={chargeDay} onChange={pickChargeDay} suggestedDay={dayOfMonth(nextDueDate)} />
            <span className="mt-1 block text-xs font-normal text-slate-600">You&apos;ll be charged on this day each month — e.g. 15 means the 15th of every month. Pick a day from 1 to 28.</span>
          </label>
          <label className="text-sm font-bold">Reminder days before
            <input name="reminderDaysBefore" type="number" min="0" max="14" defaultValue="3" required className="mt-1 w-full rounded-xl border p-3 font-normal" />
          </label>
        </div>
        <label className="flex gap-3 rounded-xl bg-amber-50 p-4 text-sm">
          <input name="consentConfirmed" type="checkbox" required />
          <span>I authorize recurring loan repayments from my US bank account under the schedule shown here. I understand enrollment is not active until Stripe securely verifies my bank account and debit authorization, and I may cancel future payments.</span>
        </label>
        <button disabled={busy} className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:opacity-50">
          {busy ? "Saving…" : "Continue autopay setup"}
        </button>
      </form>
    )}
    {message ? <p role="status" className="mt-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-900">{message}</p> : null}
  </section>;
}
