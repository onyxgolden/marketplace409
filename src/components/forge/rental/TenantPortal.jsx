"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import TenantPaymentForm from "./TenantPaymentForm";
import TenantMaintenancePanel from "./TenantMaintenancePanel";
import TenantDocumentsPanel from "./TenantDocumentsPanel";
import RentalPaymentReceipt from "./RentalPaymentReceipt";
import TenantDepositPanel from "./TenantDepositPanel";
import TenantInspectionsPanel from "./TenantInspectionsPanel";
import TenantAutopayPanel from "./TenantAutopayPanel";
import TenantInsurancePanel from "./TenantInsurancePanel";
import TenantAnimalsPanel from "./TenantAnimalsPanel";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
export function buildTenantPaymentSummary(rentals) {
  const charges = rentals.flatMap((rental) => rental.charges || []);
  return Object.freeze({ dueCents: charges.filter((charge) => !["paid", "void"].includes(charge.status))
    .reduce((sum, charge) => sum + charge.amountCents - charge.paidAmountCents, 0),
    openCharges: charges.filter((charge) => !["paid", "void"].includes(charge.status)).length });
}
const RESUMABLE_PAYMENT_STATUSES = ["created", "requires_payment_method", "requires_action"];
export function paymentPendingForCharge(payments, chargeId) {
  return payments.some((payment) => payment.chargeId === chargeId &&
    ["created", "requires_payment_method", "requires_action", "processing"].includes(payment.status));
}
export function resumablePaymentForCharge(payments, chargeId) {
  return payments.find((payment) => payment.chargeId === chargeId && RESUMABLE_PAYMENT_STATUSES.includes(payment.status)) || null;
}
export function isValidPublishableKey(key) {
  return typeof key === "string" && /^pk_(test|live)_/.test(key);
}
const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
export default function TenantPortal({ initialPortal = null } = {}) {
  const [portal, setPortal] = useState(initialPortal); const [error, setError] = useState("");
  const [session, setSession] = useState(null); const [starting, setStarting] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [stripeInitError, setStripeInitError] = useState(false); const [stripeRetryCount, setStripeRetryCount] = useState(0);
  const loadPortal = useCallback(() => fetch("/api/rental/portal").then(async (response) => {
    const body = await response.json(); if (!response.ok) throw new Error(body.error); return body.portal;
  }).then(setPortal), []);
  useEffect(() => { if (!initialPortal) loadPortal().catch((reason) => setError(reason.message)); }, [loadPortal, initialPortal]);
  const stripePromise = useMemo(() => {
    if (!session) return null;
    if (!isValidPublishableKey(STRIPE_PUBLISHABLE_KEY)) return Promise.resolve(null);
    return loadStripe(STRIPE_PUBLISHABLE_KEY, { stripeAccount: session.connectedAccountId });
  }, [session, stripeRetryCount]);
  useEffect(() => {
    if (!stripePromise) return;
    let cancelled = false;
    stripePromise.then((stripe) => { if (!cancelled && !stripe) setStripeInitError(true); })
      .catch(() => { if (!cancelled) setStripeInitError(true); });
    return () => { cancelled = true; };
  }, [stripePromise]);
  async function pay(chargeId) {
    setStarting(chargeId); setError(""); setStripeInitError(false);
    try { const response = await fetch("/api/rental/portal/payment-session", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ chargeId }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error); setSession(body);
    } catch (reason) { setError(reason.message); } finally { setStarting(null); }
  }
  async function resume(paymentId, chargeId) {
    setStarting(chargeId); setError(""); setStripeInitError(false);
    try { const response = await fetch("/api/rental/portal/payment-session/resume", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentId }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error); setSession(body);
    } catch (reason) { setError(reason.message); } finally { setStarting(null); }
  }
  function retryStripeInit() { setStripeInitError(false); setStripeRetryCount((count) => count + 1); }
  if (error && !portal) return <main className="mx-auto max-w-3xl p-8"><p role="alert">{error}</p></main>;
  if (!portal) return <main className="mx-auto max-w-3xl p-8">Loading your tenant portal…</main>;
  const summary = buildTenantPaymentSummary(portal.rentals);
  return <main className="min-h-screen bg-slate-50 px-5 py-10"><div className="mx-auto max-w-3xl space-y-6">
    <header><p className="text-sm font-bold uppercase tracking-widest text-amber-700">FORGE Tenant Portal</p>
      <h1 className="mt-2 text-3xl font-black text-slate-950">Welcome, {portal.tenant.displayName}</h1></header>
    {error ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p> : null}
    {!session ? <section className="rounded-2xl bg-slate-950 p-6 text-white shadow-sm">
      <p className="text-sm font-bold uppercase tracking-widest text-amber-400">Current balance</p>
      <p className="mt-2 text-4xl font-black">{money.format(summary.dueCents / 100)}</p>
      <p className="mt-2 text-sm text-slate-300">{summary.openCharges ? `${summary.openCharges} open rent charge${summary.openCharges === 1 ? "" : "s"}` : "You are paid in full."}</p>
    </section> : null}
    {session ? (stripeInitError ? <section className="rounded-2xl border border-red-200 bg-red-50 p-6" role="alert">
        <h2 className="text-xl font-black text-red-900">Unable to load the secure payment form</h2>
        <p className="mt-2 text-sm text-red-800">Stripe could not be initialized. Nothing has been charged and your existing payment attempt is unaffected — you can safely retry.</p>
        <div className="mt-4 flex gap-3">
          <button type="button" onClick={retryStripeInit} className="rounded-xl bg-slate-950 px-4 py-2 font-bold text-white">Retry loading payment form</button>
          <button type="button" onClick={() => setSession(null)} className="rounded-xl border px-4 py-2 font-bold">Back to balance</button>
        </div>
      </section> : <section className="rounded-2xl border bg-white p-6 shadow-sm"><h2 className="mb-5 text-xl font-black">Pay rent securely</h2>
      <Elements key={stripeRetryCount} stripe={stripePromise} options={{ clientSecret: session.clientSecret, appearance: { theme: "stripe" } }}>
        <TenantPaymentForm returnUrl={session.returnUrl} amountLabel={money.format(session.amountCents / 100)}
          dueDate={date.format(new Date(`${session.dueDate}T00:00:00`))} chargeLabel={(session.chargeType || "rent").replaceAll("_", " ")} onCancel={() => setSession(null)} />
      </Elements></section>) : portal.rentals.map(({ lease, unit, charges, payments = [] }) => <section key={lease.id} className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="text-xl font-black">{unit?.label || "Rental home"}</h2>
      <p className="mt-1 text-sm text-slate-500">Lease {lease.startDate} {lease.endDate ? `through ${lease.endDate}` : "— current"}</p>
      <div className="mt-6 space-y-3">{charges.map((charge) => <div key={charge.id} className="flex items-center justify-between gap-4 rounded-xl border p-4">
        <div><p className="font-bold">{date.format(new Date(`${charge.dueDate}T00:00:00`))}</p><p className="text-sm capitalize text-slate-500">{charge.period} {(charge.chargeType||"rent").replaceAll("_"," ")} · {charge.status.replaceAll("_", " ")}</p></div>
        <div className="text-right"><p className="font-black">{money.format((charge.amountCents - charge.paidAmountCents) / 100)}</p>
          {!['paid', 'void'].includes(charge.status) ? (() => {
            const resumable = resumablePaymentForCharge(payments, charge.id);
            const trulyPending = !resumable && paymentPendingForCharge(payments, charge.id);
            return <button onClick={() => resumable ? resume(resumable.id, charge.id) : pay(charge.id)}
              disabled={starting === charge.id || trulyPending}
              className="mt-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {trulyPending ? "Payment pending" : starting === charge.id ? "Opening…" : resumable ? "Resume payment" : "Pay now"}</button>;
          })() : null}</div>
      </div>)}</div>
      <div className="mt-8 border-t pt-6"><h3 className="font-black">Payment history</h3>
        {payments.length === 0 ? <p className="mt-2 text-sm text-slate-500">No payments recorded yet.</p> :
          payments.map((payment) => <div key={payment.id} className="mt-3 flex justify-between gap-4 border-b pb-3 text-sm">
            <span><span className="font-bold capitalize">{payment.paymentMethod ? payment.paymentMethod.replaceAll("_", " ") : payment.status.replaceAll("_", " ")}</span><br/><span className="text-slate-500">{date.format(new Date(payment.receivedAt || payment.createdAt))}{payment.receiptReference ? ` · Ref ${payment.receiptReference}` : ""}</span></span>
            <span className="text-right"><span className="font-bold">{money.format(payment.amountCents / 100)}</span>{payment.refundedAmountCents?<><br/><span className="text-red-700">Refunded {money.format(payment.refundedAmountCents/100)}</span></>:null}{payment.status==="succeeded"?<><br/><button onClick={()=>setReceipt({payment,unitLabel:unit?.label||"Rental home"})} className="mt-1 font-bold text-blue-700 underline">View receipt</button></>:null}</span></div>)}</div>
      </section>) }
    {receipt?<RentalPaymentReceipt payment={receipt.payment} tenantName={portal.tenant.displayName} unitLabel={receipt.unitLabel} onClose={()=>setReceipt(null)}/>:null}
    {!session ? <TenantDepositPanel rentals={portal.rentals} /> : null}
    {!session ? <TenantAutopayPanel rentals={portal.rentals} onChanged={loadPortal} /> : null}
    {!session ? <TenantInspectionsPanel rentals={portal.rentals} onAcknowledged={loadPortal} /> : null}
    {!session ? <section className="rounded-2xl border border-blue-200 bg-blue-50 p-6">
      <p className="text-sm font-bold uppercase tracking-widest text-blue-800">Optional tenant service</p>
      <h2 className="mt-2 text-xl font-black text-slate-950">Build credit with rent history</h2>
      <p className="mt-2 text-sm leading-6 text-slate-700">FORGE plans to offer voluntary rent-payment reporting through an independent credit-reporting provider. The monthly price, bureaus covered, consent terms, and cancellation controls will appear here before enrollment.</p>
      <p className="mt-3 text-sm font-bold text-blue-900">Not yet available — no fee will be charged.</p>
    </section> : null}
    {!session ? <TenantMaintenancePanel rentals={portal.rentals} onSubmitted={loadPortal} /> : null}
    {!session ? <TenantDocumentsPanel /> : null}
    {!session ? <TenantInsurancePanel rentals={portal.rentals} onSubmitted={loadPortal} /> : null}
    {!session ? <TenantAnimalsPanel rentals={portal.rentals} onChanged={loadPortal} /> : null}
    {!session ? <section className="rounded-2xl border border-violet-200 bg-violet-50 p-6">
      <p className="text-sm font-bold uppercase tracking-widest text-violet-800">Dog liability coverage</p>
      <h2 className="mt-2 text-xl font-black text-slate-950">Coverage for qualifying dogs</h2>
      <p className="mt-2 text-sm leading-6 text-slate-700">If the landlord’s insurer requires separate dog-liability coverage for your pet, FORGE will show the required limit and accept proof from a qualifying provider. Coverage must include bodily injury and property damage without excluding the applicable dog.</p>
      <p className="mt-3 text-sm font-bold text-violet-900">Every pet requires landlord approval and carries its own monthly pet fee under the lease. Insurance provider links are external and premiums are never paid to FORGE. Assistance-animal requests receive separate human review.</p>
    </section> : null}
  </div></main>;
}
