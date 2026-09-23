"use client";
import { useState } from "react";
import { PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";

// Setup-mode counterpart of TenantPaymentForm: collects the borrower's US bank
// account through Stripe (Financial Connections or manual entry) and confirms the
// SetupIntent, which creates the ACH debit mandate for autopay.
export default function PrivateFinancingAutopaySetupForm({ onLinked, onCancel }) {
  const stripe = useStripe();
  const elements = useElements();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [elementReady, setElementReady] = useState(false);
  const [elementError, setElementError] = useState("");
  async function submit(event) {
    event.preventDefault();
    if (!stripe || !elements || !elementReady || submitting) return;
    setSubmitting(true); setMessage("");
    const result = await stripe.confirmSetup({ elements, redirect: "if_required" });
    if (result.error) {
      setMessage(result.error.message || "Bank account could not be linked.");
      setSubmitting(false);
      return;
    }
    setMessage("Bank account linked. Activating autopay…");
    try {
      await onLinked(result.setupIntent?.id);
    } catch (linkError) {
      setMessage(linkError?.message || "Autopay could not be activated.");
      setSubmitting(false);
    }
  }
  return <form onSubmit={submit} className="space-y-5">
    <div className="rounded-2xl bg-slate-950 p-5 text-white">
      <p className="text-sm capitalize text-slate-300">Automatic payments</p>
      <p className="mt-1 text-2xl font-black">Link your bank account</p>
      <p className="mt-1 text-sm text-slate-300">Your monthly payment debits automatically from this account. Bank debits can take several business days to settle.</p>
    </div>
    <PaymentElement options={{ layout: "tabs" }} onReady={() => setElementReady(true)}
      onLoadError={(event) => setElementError(event?.error?.message || "The bank form could not be loaded. Please try again.")} />
    {elementError ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{elementError}</p> : null}
    {message ? <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{message}</p> : null}
    <button disabled={!stripe || !elements || !elementReady || submitting} className="w-full rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950 disabled:opacity-50">
      {submitting ? "Linking…" : elementReady ? "Link bank account" : "Loading bank form…"}
    </button>
    <button type="button" onClick={onCancel} disabled={submitting} className="w-full rounded-xl border px-5 py-3 font-bold text-slate-700">Back</button>
  </form>;
}
