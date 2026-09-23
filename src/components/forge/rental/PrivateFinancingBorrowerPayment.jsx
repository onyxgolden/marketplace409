"use client";import{useEffect,useMemo,useState}from"react";import{Elements}from"@stripe/react-stripe-js";import{loadStripe}from"@stripe/stripe-js";import TenantPaymentForm from"./TenantPaymentForm";
import AutopayPaymentNotice,{formatAutopayDateLabel,pfAutopayNoticeKind}from"./AutopayPaymentNotice";
const KEY=process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
export default function PrivateFinancingBorrowerPayment({accountId,regularScheduledPaymentCents,pendingPayment,autopayChargeDay,onCancel}){
 const[amount,setAmount]=useState((regularScheduledPaymentCents/100).toFixed(2)),[session,setSession]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const stripe=useMemo(()=>session&&KEY?loadStripe(KEY,{stripeAccount:session.connectedAccountId}):null,[session]);
 // A resumable pending payment means the borrower already has an in-flight Stripe PaymentIntent
 // for this account (e.g. they backed out of the card/bank entry step last time) -- re-open that
 // same attempt instead of showing the amount form, which would just bounce off the "already
 // pending" guard in payment-session/route.js. No setState runs synchronously in this effect body
 // (only inside the fetch's .then continuation) so it can't trigger a cascading render.
 useEffect(()=>{
  if(!pendingPayment?.resumable)return;
  let cancelled=false;
  fetch("/api/private-financing/portal/payment-session/resume",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({paymentId:pendingPayment.id})})
   .then(response=>response.json().then(payload=>({response,payload})))
   .then(({response,payload})=>{if(cancelled)return;if(!response.ok){setError(payload.error);return;}setSession(payload);});
  return ()=>{cancelled=true;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 async function start(){const cents=Math.round(Number(amount)*100);if(!Number.isSafeInteger(cents)||cents<=0){setError("Enter a valid payment amount.");return;}setBusy(true);setError("");const response=await fetch("/api/private-financing/portal/payment-session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId,amountCents:cents})});const payload=await response.json();setBusy(false);if(!response.ok){setError(payload.error);return;}setSession(payload);}
 if(session)
  // onCancel (not a local reset) on purpose: a session here always means a pending payment row now
  // exists server-side, so backing out must return to the account view -- which reloads and offers
  // "Resume payment" -- rather than silently reopening a blank amount form the next Continue click
  // would just bounce off the same "already pending" guard.
  return <Elements stripe={stripe} options={{clientSecret:session.clientSecret,appearance:{theme:"stripe"}}}><TenantPaymentForm returnUrl={session.returnUrl} amountLabel={`$${(session.amountCents/100).toFixed(2)}`} dueDate="Current financing account" chargeLabel="Financing" onCancel={onCancel}/></Elements>;
 if(pendingPayment?.resumable)return <div className="mt-6 rounded-2xl border border-amber-300 p-5">
  <p className="text-sm font-bold">{error||"Resuming your payment…"}</p>
  {error?<button onClick={onCancel} className="mt-3 rounded-xl border px-5 py-3 font-bold">Back</button>:null}
 </div>;
 return <div className="mt-6 rounded-2xl border border-amber-300 p-5"><h3 className="text-lg font-black">Make a payment</h3><p className="mt-1 text-sm">Pay securely by bank account or eligible card. FORGE charges no platform fee. The seller credits the actual Stripe processing fee back to your principal after settlement.</p>{(()=>{if(autopayChargeDay==null)return null;const notice=pfAutopayNoticeKind({amountCents:Math.round(Number(amount)*100),scheduledCents:regularScheduledPaymentCents,chargeDay:autopayChargeDay});return <div className="mt-4"><AutopayPaymentNotice coversAutopay={notice.kind==="covers"} autopayDateLabel={formatAutopayDateLabel(notice.runDate)}/></div>;})()}<label className="mt-4 block text-sm font-bold">Payment amount<input type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} className="mt-1 block w-full rounded-lg border p-3 text-slate-950"/></label><button onClick={start} disabled={busy} className="mt-3 rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950 disabled:opacity-50">{busy?"Starting…":"Continue to secure payment"}</button><button onClick={onCancel} className="ml-3 mt-3 rounded-xl border px-5 py-3 font-bold">Cancel</button>{error?<p role="alert" className="mt-3 text-sm font-bold text-red-700">{error}</p>:null}</div>;
}
