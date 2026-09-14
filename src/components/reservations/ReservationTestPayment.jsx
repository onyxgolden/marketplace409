"use client";

import { useMemo, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

function ConfirmationForm({ returnUrl, onResult }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: returnUrl }, redirect: "if_required" });
    setSubmitting(false);
    if (result.error) onResult(result.error.message || "The test payment could not be confirmed.");
    else onResult("Test payment submitted. Stripe confirmation and the authenticated webhook determine the final status.");
  }

  return <form onSubmit={submit} className="mt-4 space-y-4">
    <PaymentElement />
    <button disabled={!stripe || submitting} className="rounded-lg bg-sky-700 px-4 py-2 font-bold text-white disabled:opacity-50">
      {submitting ? "Submitting…" : "Pay booking balance in test mode"}
    </button>
  </form>;
}

export default function ReservationTestPayment({ slug, token, amountDueCents, currencyCode }) {
  const [session, setSession] = useState(null);
  const [message, setMessage] = useState("");
  const [starting, setStarting] = useState(false);
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
  const stripePromise = useMemo(
    () => session && publishableKey ? loadStripe(publishableKey, { stripeAccount: session.connectedAccountId }) : null,
    [publishableKey, session],
  );

  async function start() {
    setStarting(true);
    setMessage("");
    try {
      const response = await fetch(`/api/book/${encodeURIComponent(slug)}/payment-session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to start the test payment.");
      setSession(body);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setStarting(false);
    }
  }

  if (!publishableKey) return null;
  return <section aria-label="Test payment" className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sky-950">
    <p className="font-black">Stripe test payment</p>
    <p className="mt-1 text-sm">This pays only the booking balance ({new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode }).format(amountDueCents / 100)}). The security deposit is not collected.</p>
    {!session && <button onClick={start} disabled={starting || amountDueCents <= 0} className="mt-3 rounded-lg bg-sky-700 px-4 py-2 font-bold text-white disabled:opacity-50">{starting ? "Starting…" : "Enter test card"}</button>}
    {session && stripePromise && <Elements stripe={stripePromise} options={{ clientSecret: session.clientSecret }}><ConfirmationForm returnUrl={session.returnUrl} onResult={setMessage} /></Elements>}
    {message && <p role="status" className="mt-3 text-sm font-bold">{message}</p>}
    <p className="mt-3 text-xs">Test mode only. A successful payment is “paid” before it is settled, available, or paid out.</p>
  </section>;
}
