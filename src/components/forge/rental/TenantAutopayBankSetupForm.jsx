"use client";
import { useState } from "react";
import { PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";

// Collects the tenant's US bank account once for recurring ACH debits. The SetupIntent was
// created server-side with mandate_data (online acceptance, server-captured IP + user agent),
// so confirming here also records the debit mandate Stripe needs for off-session charges.
export default function TenantAutopayBankSetupForm({ busy, onSuccess, onCancel }) {
  const stripe = useStripe();
  const elements = useElements();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [elementReady, setElementReady] = useState(false);
  const [elementError, setElementError] = useState("");
  async function submit(event) {
    event.preventDefault();
    if (!stripe || !elements || !elementReady || submitting || busy) return;
    setSubmitting(true); setMessage("");
    const result = await stripe.confirmSetup({ elements,
      confirmParams: { return_url: `${window.location.origin}/forge/rental/portal?autopay=setup-returned` },
      redirect: "if_required" });
    if (result.error) {
      setMessage(result.error.message || "Bank account could not be linked.");
      setSubmitting(false);
      return;
    }
    // No bank redirect was required: the setup intent confirmed in place.
    // (If a redirect did happen, the page navigates away and the portal resumes
    // activation from sessionStorage when Stripe returns.)
    await onSuccess(result.setupIntent.id);
    setSubmitting(false);
  }
  return <form onSubmit={submit} className="space-y-5">
    <p className="text-sm leading-6 text-slate-600">
      Link the bank account your automatic payments will be debited from. Your bank verifies
      the account instantly and securely through Stripe — FORGE never sees your login.
    </p>
    <PaymentElement options={{ layout: "tabs" }} onReady={() => setElementReady(true)}
      onLoadError={(event) => setElementError(event?.error?.message || "The bank form could not be loaded. Please try again.")} />
    {elementError ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{elementError}</p> : null}
    {message ? <p role="status" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{message}</p> : null}
    <button disabled={!stripe || !elements || !elementReady || submitting || busy}
      className="w-full rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950 disabled:opacity-50">
      {submitting || busy ? "Linking…" : elementReady ? "Link bank account" : "Loading bank form…"}
    </button>
    <button type="button" onClick={onCancel} disabled={submitting || busy}
      className="w-full rounded-xl border px-5 py-3 font-bold text-slate-700">Back</button>
    <p className="text-xs leading-5 text-slate-500">
      By linking your account you authorize recurring debits under your autopay schedule.
      You can cancel future automatic payments at any time.
    </p>
  </form>;
}
