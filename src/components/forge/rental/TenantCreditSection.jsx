"use client";
import { useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { applyCreditToCharge } from "@/domains/rental-payment/tenantCredit";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const APPLY_CONFIRM_WORD = "CONFIRM";

// Tenant credits — the overpayment carry-forward section of the tenant ledger.
// Open credits auto-apply to the next generated rent charge; this panel covers the
// manual path (apply to a specific open charge, or void the unapplied remainder)
// behind the reconciliation human gate (checkbox + typing CONFIRM).
export default function TenantCreditSection({ credits = [], creditApplications = [], openCharges = [], onChanged }) {
  const [applyFor, setApplyFor] = useState(null);
  const [applyChargeId, setApplyChargeId] = useState("");
  const [applyAmount, setApplyAmount] = useState("");
  const [applyChecked, setApplyChecked] = useState(false);
  const [applyTyped, setApplyTyped] = useState("");
  const [voidFor, setVoidFor] = useState(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidChecked, setVoidChecked] = useState(false);
  const [voidTyped, setVoidTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const openCredits = credits.filter((credit) => credit.status === "open" && Number(credit.remaining_cents) > 0);
  const applicationsByCredit = new Map();
  for (const application of creditApplications) {
    if (!applicationsByCredit.has(application.credit_id)) applicationsByCredit.set(application.credit_id, []);
    applicationsByCredit.get(application.credit_id).push(application);
  }

  if (credits.length === 0) return null;

  async function postApply() {
    const credit = applyFor;
    const charge = openCharges.find((c) => c.id === applyChargeId);
    const cents = Math.round(Number(applyAmount) * 100);
    if (!charge) { setError("Select an open charge to apply the credit to."); return; }
    if (!Number.isSafeInteger(cents) || cents <= 0) { setError("Enter a positive credit amount."); return; }
    try {
      // Client-side preview uses the same domain math as the RPC; the RPC re-validates.
      applyCreditToCharge({ creditRemainingCents: Number(credit.remaining_cents), chargeRemainingCents: charge.remainingCents, requestedCents: cents });
    } catch (caught) { setError(caught.message); return; }
    if (!applyChecked || applyTyped.trim().toUpperCase() !== APPLY_CONFIRM_WORD) {
      setError(`Check the confirmation and type ${APPLY_CONFIRM_WORD} to apply this credit.`);
      return;
    }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/rental", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "apply-tenant-credit",
          credit: { creditId: credit.id, chargeId: charge.id, amountCents: cents, ownerConfirmed: true },
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to apply the credit.");
      setApplyFor(null); setApplyChargeId(""); setApplyAmount(""); setApplyChecked(false); setApplyTyped("");
      onChanged?.();
    } catch (caught) {
      setError(caught.message || "Unable to apply the credit.");
    } finally {
      setBusy(false);
    }
  }

  async function postVoid() {
    const credit = voidFor;
    if (!voidReason.trim()) { setError("A reason is required to void a credit."); return; }
    if (!voidChecked || voidTyped.trim().toUpperCase() !== APPLY_CONFIRM_WORD) {
      setError(`Check the confirmation and type ${APPLY_CONFIRM_WORD} to void this credit.`);
      return;
    }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/rental", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "void-tenant-credit",
          creditId: credit.id, reason: voidReason.trim(), ownerConfirmed: true,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to void the credit.");
      setVoidFor(null); setVoidReason(""); setVoidChecked(false); setVoidTyped("");
      onChanged?.();
    } catch (caught) {
      setError(caught.message || "Unable to void the credit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 p-5 dark:border-sky-900 dark:bg-sky-950/30" data-tenant-credits>
      <h4 className="text-lg font-black text-slate-950 dark:text-white">Tenant credits</h4>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Overpayments held on this tenant&apos;s lease. The money was already received and counted in the payment
        history — credits are memo entries, not a second payment. Open credits apply automatically to the next
        rent charge, oldest first.
      </p>
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      <ul className="mt-3 space-y-3">
        {credits.map((credit) => {
          const applications = applicationsByCredit.get(credit.id) || [];
          const isOpen = credit.status === "open";
          return (
            <li key={credit.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-black text-slate-950 dark:text-white">
                  {money.format(Number(credit.amount_cents) / 100)} credit
                  <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-black uppercase text-sky-800 dark:bg-sky-900 dark:text-sky-200">{credit.status}</span>
                </p>
                <p className="text-sm font-bold text-slate-600 dark:text-slate-400">
                  {isOpen ? `${money.format(Number(credit.remaining_cents) / 100)} remaining` : "no remaining balance"}
                </p>
              </div>
              {credit.notes && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{credit.notes}</p>}
              {credit.status === "void" && credit.void_reason && (
                <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                  Voided{credit.voided_at ? ` on ${credit.voided_at.slice(0, 10)}` : ""}: {credit.void_reason}
                </p>
              )}
              {applications.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                  {applications.map((application) => (
                    <li key={application.id}>
                      Applied {money.format(Number(application.amount_cents) / 100)} on {application.applied_at?.slice(0, 10) || "—"}
                      {application.notes ? ` — ${application.notes}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {isOpen && (
                <div className="mt-3 flex flex-wrap gap-2 print:hidden">
                  {openCharges.length > 0 && (
                    <button type="button" onClick={() => { setApplyFor(credit); setApplyChargeId(""); setApplyAmount((Number(credit.remaining_cents) / 100).toFixed(2)); setApplyChecked(false); setApplyTyped(""); setError(""); }}
                      className="rounded-xl border border-sky-600 px-3 py-1.5 text-xs font-black text-sky-700 hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-900/40">
                      Apply to a charge…
                    </button>
                  )}
                  <button type="button" onClick={() => { setVoidFor(credit); setVoidReason(""); setVoidChecked(false); setVoidTyped(""); setError(""); }}
                    className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-black text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800">
                    Void remaining…
                  </button>
                </div>
              )}
              {applyFor?.id === credit.id && (
                <div className="mt-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-600 dark:bg-amber-950/30">
                  <p className="text-sm font-black text-amber-900 dark:text-amber-200">Apply credit to a charge</p>
                  <label className="mt-2 block text-sm font-bold text-amber-900 dark:text-amber-200">Open charge
                    <select value={applyChargeId} onChange={(event) => setApplyChargeId(event.target.value)}
                      className="mt-1 w-full rounded-xl border border-amber-400 bg-white px-3 py-2 dark:border-amber-600 dark:bg-slate-900 dark:text-white">
                      <option value="">Select a charge…</option>
                      {openCharges.map((charge) => (
                        <option key={charge.id} value={charge.id}>
                          {(charge.period || charge.dueDate || "Charge")} — {money.format(charge.remainingCents / 100)} remaining
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="mt-2 block text-sm font-bold text-amber-900 dark:text-amber-200">Amount
                    <input value={applyAmount} onChange={(event) => setApplyAmount(event.target.value)} inputMode="decimal" placeholder="0.00"
                      className="mt-1 w-full rounded-xl border border-amber-400 bg-white px-3 py-2 dark:border-amber-600 dark:bg-slate-900 dark:text-white" />
                  </label>
                  <label className="mt-3 flex items-start gap-2 text-sm font-bold text-amber-900 dark:text-amber-200">
                    <input type="checkbox" checked={applyChecked} onChange={(event) => setApplyChecked(event.target.checked)} className="mt-1 h-4 w-4 accent-amber-600" />
                    I confirm this credit should be applied to the selected charge.
                  </label>
                  <label className="mt-2 block text-sm font-bold text-amber-900 dark:text-amber-200">Type {APPLY_CONFIRM_WORD}
                    <input value={applyTyped} onChange={(event) => setApplyTyped(event.target.value)} placeholder={APPLY_CONFIRM_WORD}
                      className="mt-1 w-full rounded-xl border border-amber-400 bg-white px-3 py-2 dark:border-amber-600 dark:bg-slate-900 dark:text-white" />
                  </label>
                  <div className="mt-3 flex gap-2">
                    <button type="button" disabled={busy} onClick={postApply}
                      className={`rounded-xl px-4 py-2 text-sm font-black disabled:opacity-50 ${goldControlClassName}`}>
                      {busy ? "Applying…" : "Apply credit"}
                    </button>
                    <button type="button" onClick={() => setApplyFor(null)} className="text-sm font-bold text-amber-800 underline dark:text-amber-300">Cancel</button>
                  </div>
                </div>
              )}
              {voidFor?.id === credit.id && (
                <div className="mt-3 rounded-xl border-2 border-red-400 bg-red-50 p-4 dark:border-red-700 dark:bg-red-950/30">
                  <p className="text-sm font-black text-red-900 dark:text-red-200">
                    Void the remaining {money.format(Number(credit.remaining_cents) / 100)}
                  </p>
                  <p className="mt-1 text-xs text-red-800 dark:text-red-300">
                    Amounts already applied to charges stay as history. Only the unapplied remainder is voided.
                  </p>
                  <label className="mt-2 block text-sm font-bold text-red-900 dark:text-red-200">Reason
                    <input value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="e.g. refunded to tenant in cash"
                      className="mt-1 w-full rounded-xl border border-red-400 bg-white px-3 py-2 dark:border-red-700 dark:bg-slate-900 dark:text-white" />
                  </label>
                  <label className="mt-3 flex items-start gap-2 text-sm font-bold text-red-900 dark:text-red-200">
                    <input type="checkbox" checked={voidChecked} onChange={(event) => setVoidChecked(event.target.checked)} className="mt-1 h-4 w-4 accent-red-600" />
                    I confirm the remaining credit should be voided for the reason above.
                  </label>
                  <label className="mt-2 block text-sm font-bold text-red-900 dark:text-red-200">Type {APPLY_CONFIRM_WORD}
                    <input value={voidTyped} onChange={(event) => setVoidTyped(event.target.value)} placeholder={APPLY_CONFIRM_WORD}
                      className="mt-1 w-full rounded-xl border border-red-400 bg-white px-3 py-2 dark:border-red-700 dark:bg-slate-900 dark:text-white" />
                  </label>
                  <div className="mt-3 flex gap-2">
                    <button type="button" disabled={busy} onClick={postVoid}
                      className="rounded-xl bg-red-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50 hover:bg-red-700">
                      {busy ? "Voiding…" : "Void credit"}
                    </button>
                    <button type="button" onClick={() => setVoidFor(null)} className="text-sm font-bold text-red-800 underline dark:text-red-300">Cancel</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
