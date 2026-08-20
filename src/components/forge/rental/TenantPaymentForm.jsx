"use client";
import { useState } from "react";
import { PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";

export default function TenantPaymentForm({ returnUrl, amountLabel, dueDate, chargeLabel = "Rent", onCancel }) {
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
    const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: returnUrl }, redirect: "if_required" });
    if (result.error) setMessage(result.error.message || "Payment could not be submitted.");
    else setMessage("Payment submitted. Bank payments remain pending until Stripe confirms settlement.");
    setSubmitting(false);
  }
  return <form onSubmit={submit} className="space-y-5">
    <div className="rounded-2xl bg-slate-950 p-5 text-white">
      <p className="text-sm capitalize text-slate-300">{chargeLabel} payment</p><p className="mt-1 text-3xl font-black">{amountLabel}</p>
      <p className="mt-1 text-sm text-slate-300">Due {dueDate}</p>
    </div>
    <PaymentElement options={{ layout: "tabs" }} onReady={() => setElementReady(true)}
      onLoadError={(event) => setElementError(event?.error?.message || "The payment form could not be loaded. Please try again.")} />
    {elementError ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{elementError}</p> : null}
    {message ? <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{message}</p> : null}
    <button disabled={!stripe || !elements || !elementReady || submitting} className="w-full rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950 disabled:opacity-50">
      {submitting ? "Submitting…" : elementReady ? `Submit ${chargeLabel.toLowerCase()} payment` : "Loading payment form…"}
    </button>
    <button type="button" onClick={onCancel} disabled={submitting} className="w-full rounded-xl border px-5 py-3 font-bold text-slate-700">Back to balance</button>
    <p className="text-xs leading-5 text-slate-500">Bank payments can take several business days to settle. Your balance updates only after confirmation.</p>
  </form>;
}
