"use client";
import { useState } from "react";
import { convenienceFeeCents, feeAgreementText, formatFeePercent } from "@/domains/rental-payment/convenienceFee";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// R12: review-before-pay. The tenant chooses card vs. bank BEFORE the payment
// session is created, so the convenience fee (when enabled) is fixed at
// session creation and can never be edited afterward. Card + enabled fee
// requires the tenant's explicit agreement checkbox; the server recomputes
// and re-validates everything at session creation -- this screen is review
// copy only, never the authority.
export default function TenantPaymentReview({ charge, feeBps = 0, onConfirm, onCancel, starting }) {
  const remainingCents = Math.max(0, Number(charge?.amountCents || 0) - Number(charge?.paidAmountCents || 0));
  const [method, setMethod] = useState("us_bank_account");
  const [agreed, setAgreed] = useState(false);
  const feeCents = method === "card" ? convenienceFeeCents(remainingCents, feeBps) : 0;
  const totalCents = remainingCents + feeCents;
  const feeEnabled = feeBps > 0;
  const needsAgreement = method === "card" && feeCents > 0;
  const canContinue = !needsAgreement || agreed;
  const chargeName = String(charge?.chargeType || "rent").replaceAll("_", " ");
  return <section className="rounded-2xl border bg-white p-6 shadow-sm" aria-label="Review your payment">
    <h2 className="text-xl font-black">Review your payment</h2>
    <dl className="mt-4 space-y-2 text-sm">
      <div className="flex items-center justify-between">
        <dt className="font-bold capitalize">{chargeName} due</dt>
        <dd className="font-black">{money.format(remainingCents / 100)}</dd>
      </div>
      {feeCents > 0 ? <div className="flex items-center justify-between text-slate-700">
        <dt>Card convenience fee ({formatFeePercent(feeBps)})</dt>
        <dd className="font-bold">{money.format(feeCents / 100)}</dd>
      </div> : null}
      <div className="flex items-center justify-between border-t border-slate-200 pt-2">
        <dt className="font-bold">Total due now</dt>
        <dd className="text-2xl font-black">{money.format(totalCents / 100)}</dd>
      </div>
    </dl>
    <fieldset className="mt-5">
      <legend className="text-sm font-bold">How would you like to pay?</legend>
      <div className="mt-2 space-y-2">
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3">
          <input type="radio" name="payment-method" className="mt-1" checked={method === "us_bank_account"}
            onChange={() => setMethod("us_bank_account")} />
          <span>
            <span className="font-bold">Bank account (ACH)</span>
            <span className="block text-xs text-slate-500">No fee. Takes several business days to settle.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3">
          <input type="radio" name="payment-method" className="mt-1" checked={method === "card"}
            onChange={() => setMethod("card")} />
          <span>
            <span className="font-bold">Card</span>
            <span className="block text-xs text-slate-500">
              {feeEnabled ? `Includes a ${formatFeePercent(feeBps)} convenience fee.` : "No convenience fee is currently charged."}
            </span>
          </span>
        </label>
      </div>
    </fieldset>
    {needsAgreement ? <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-amber-50 p-4 text-sm text-slate-800">
      <input type="checkbox" className="mt-1" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
      <span>{feeAgreementText(remainingCents, feeBps)}</span>
    </label> : null}
    <div className="mt-5 flex gap-3">
      <button type="button" disabled={!canContinue || starting}
        onClick={() => onConfirm({ paymentMethod: method, feeAgreed: agreed, expectedFeeCents: feeCents })}
        className="flex-1 rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950 disabled:opacity-50">
        {starting ? "Starting…" : `Continue to payment — ${money.format(totalCents / 100)}`}
      </button>
      <button type="button" onClick={onCancel} disabled={starting}
        className="rounded-xl border px-4 py-3 font-bold disabled:opacity-50">Back</button>
    </div>
    {!canContinue ? <p className="mt-2 text-xs text-slate-500">Check the box above to agree to the card convenience fee.</p> : null}
  </section>;
}
