"use client";
import { useEffect, useMemo, useState } from "react";

// R18 (rentec-parity): correct a recorded tenant payment.
//
// The dialog shows before → after for every changed field, requires a
// reason, and lists the payment's correction history (the audit trail).
// Amount/date/method/deposit amount/charge are editable only for manually
// recorded (offline) payments — provider payments moved real money, so
// their correctable surface is notes + receipt reference. Deposit amount
// is the portion of this payment that is security-deposit money (default
// 0, never more than the payment amount); it moves no charge or credit
// balance by design, so changing it can never strand one.

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const centsToDollars = (cents) => money.format(Number(cents || 0) / 100);
const dollarsToCents = (value) => {
  const n = Number(String(value || "").replaceAll(",", "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
};
// Deposit amounts may be zero (no deposit portion); an empty input reads as 0.
const dollarsToDepositCents = (value) => {
  if (String(value || "").trim() === "") return 0;
  const n = Number(String(value).replaceAll(",", "").trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
};
const inputClass = "mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100";
const labelClass = "block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400";
const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
};
const label = (value) => String(value ?? "—").replaceAll("_", " ");

function formatCorrectionValue(field, value, chargeLabels) {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "amount_cents") return centsToDollars(Number(value));
  if (field === "deposit_amount_cents") return centsToDollars(Number(value));
  if (field === "received_at") return formatDate(String(value).slice(0, 10));
  if (field === "payment_method") return label(value);
  if (field === "deposit_state") return label(value);
  if (field === "charge_id") return chargeLabels?.[value] || String(value);
  return String(value);
}

const chargeLabel = (charge) => {
  if (!charge) return null;
  const period = charge.period ? `${charge.period} · ` : "";
  const due = charge.dueDate ? `due ${formatDate(charge.dueDate)} · ` : "";
  return `${period}${due}${centsToDollars(charge.amountCents)}`;
};

export default function CorrectPaymentDialog({ paymentId, onDone, onClose }) {
  const [payment, setPayment] = useState(null);
  const [corrections, setCorrections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [amount, setAmount] = useState("");
  const [receivedAt, setReceivedAt] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [depositState, setDepositState] = useState("received");
  const [depositAmount, setDepositAmount] = useState("");
  const [chargeId, setChargeId] = useState("");
  const [availableCharges, setAvailableCharges] = useState([]);
  const [receiptReference, setReceiptReference] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [doneSummary, setDoneSummary] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const response = await fetch(`/api/rental/tenant-payments/${encodeURIComponent(paymentId)}`);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Unable to load the payment.");
        if (cancelled) return;
        setPayment(body.payment);
        setCorrections(body.corrections || []);
        setAvailableCharges(body.availableCharges || []);
        setAmount((Number(body.payment.amountCents || 0) / 100).toFixed(2));
        setReceivedAt(String(body.payment.receivedAt || "").slice(0, 10));
        setPaymentMethod(body.payment.paymentMethod || "");
        setDepositState(body.payment.depositState || "received");
        setDepositAmount((Number(body.payment.depositAmountCents || 0) / 100).toFixed(2));
        setChargeId(body.payment.chargeId || "");
        setReceiptReference(body.payment.receiptReference || "");
        setNotes(body.payment.notes || "");
      } catch (caught) {
        if (!cancelled) setLoadError(caught.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [paymentId]);

  // Charge labels for the select, the preview, and history rows: never a
  // raw id alone. The select offers the current charge plus same-lease
  // charges that can still take money (due, scheduled, partially paid).
  const chargeLabels = useMemo(() => {
    const map = {};
    for (const charge of availableCharges) {
      map[charge.id] = chargeLabel(charge) || charge.id;
    }
    return map;
  }, [availableCharges]);
  const chargeOptions = useMemo(() => {
    if (!payment) return [];
    const current = availableCharges.find((charge) => charge.id === payment.chargeId);
    const payable = availableCharges.filter(
      (charge) =>
        charge.id !== payment.chargeId &&
        ["due", "scheduled", "partially_paid"].includes(charge.status)
    );
    return [...(current ? [current] : []), ...payable];
  }, [payment, availableCharges]);

  // Before → after preview: only fields the user actually changed.
  const preview = useMemo(() => {
    if (!payment) return [];
    const rows = [];
    const moneyOk = payment.moneyFieldsCorrectable === true;
    if (moneyOk) {
      const amountCents = dollarsToCents(amount);
      if (amountCents !== null && amountCents !== Number(payment.amountCents || 0)) {
        rows.push({ field: "amount_cents", label: "Amount", from: Number(payment.amountCents || 0), to: amountCents });
      }
      if (receivedAt && receivedAt !== String(payment.receivedAt || "").slice(0, 10)) {
        rows.push({ field: "received_at", label: "Received date", from: String(payment.receivedAt || "").slice(0, 10), to: receivedAt });
      }
      if (paymentMethod && paymentMethod !== (payment.paymentMethod || "")) {
        rows.push({ field: "payment_method", label: "Payment method", from: payment.paymentMethod || "", to: paymentMethod });
      }
      if (depositState !== (payment.depositState || "received")) {
        rows.push({ field: "deposit_state", label: "Deposit state", from: payment.depositState || "received", to: depositState });
      }
      const depositCents = dollarsToDepositCents(depositAmount);
      if (depositCents !== null && depositCents !== Number(payment.depositAmountCents || 0)) {
        rows.push({ field: "deposit_amount_cents", label: "Deposit amount", from: Number(payment.depositAmountCents || 0), to: depositCents });
      }
      if (chargeId && chargeId !== (payment.chargeId || "")) {
        rows.push({ field: "charge_id", label: "Applies to", from: payment.chargeId || "", to: chargeId });
      }
    }
    const ref = receiptReference.trim();
    if (ref !== (payment.receiptReference || "")) {
      rows.push({ field: "receipt_reference", label: "Receipt reference", from: payment.receiptReference || "", to: ref || null });
    }
    if (notes.trim() !== (payment.notes || "")) {
      rows.push({ field: "notes", label: "Notes", from: payment.notes || "", to: notes.trim() || null });
    }
    return rows;
  }, [payment, amount, receivedAt, paymentMethod, depositState, depositAmount, chargeId, receiptReference, notes]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (preview.length === 0) { setError("Nothing to correct — change at least one field."); return; }
    if (!reason.trim()) { setError("A reason is required to correct a payment."); return; }
    if (!confirmed) { setError("Please confirm you want to correct this payment."); return; }
    const moneyOk = payment.moneyFieldsCorrectable === true;
    const changes = {};
    if (moneyOk) {
      const amountCents = dollarsToCents(amount);
      if (amountCents === null) { setError("Enter a valid positive amount."); return; }
      if (amountCents !== Number(payment.amountCents || 0)) changes.amountCents = amountCents;
      if (receivedAt && receivedAt !== String(payment.receivedAt || "").slice(0, 10)) changes.receivedAt = receivedAt;
      if (paymentMethod && paymentMethod !== (payment.paymentMethod || "")) changes.paymentMethod = paymentMethod;
      if (depositState !== (payment.depositState || "received")) changes.depositState = depositState;
      const depositCents = dollarsToDepositCents(depositAmount);
      if (depositCents === null) { setError("Enter a valid deposit amount (0 or more)."); return; }
      if (depositCents !== Number(payment.depositAmountCents || 0)) changes.depositAmountCents = depositCents;
      if (chargeId && chargeId !== (payment.chargeId || "")) changes.chargeId = chargeId;
    }
    const ref = receiptReference.trim();
    if (ref !== (payment.receiptReference || "")) changes.receiptReference = ref || null;
    if (notes.trim() !== (payment.notes || "")) changes.notes = notes.trim() || null;

    setSaving(true);
    try {
      const response = await fetch(`/api/rental/tenant-payments/${encodeURIComponent(paymentId)}/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...changes, reason: reason.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to correct the payment.");
      setDoneSummary(body.correction);
      // The dialog stays open on its emerald done summary (the confirmation
      // where the user is looking); the parent only refreshes behind it.
      // Done → onClose. Parents must NOT unmount on onDone, or the
      // confirmation never paints.
      onDone(body.correction);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-label="Correct payment"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-xl font-black text-slate-950 dark:text-white">Correct payment</h3>
          <button type="button" onClick={onClose} aria-label="Close correct payment"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-black text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">✕</button>
        </div>

        {loading && <p className="mt-4 text-sm text-slate-500">Loading the payment…</p>}
        {loadError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{loadError}</p>}

        {!loading && !loadError && payment && !doneSummary && (
          <>
            {!payment.correctable && (
              <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                {payment.correctableReason || "This payment cannot be corrected."}
              </p>
            )}
            {payment.correctable && (
              <form onSubmit={submit} className="mt-4 space-y-3">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  The original values stay on the books as a correction record — nothing is rewritten without a trail.
                  {payment.moneyFieldsCorrectable !== true && " This payment settled through a provider, so only the receipt reference and notes can be corrected."}
                </p>
                {payment.moneyFieldsCorrectable === true && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <label className={labelClass}>Amount
                        <input className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
                      </label>
                      <label className={labelClass}>Received date
                        <input type="date" className={inputClass} value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
                      </label>
                    </div>
                    <label className={labelClass}>Payment method
                      <select className={inputClass} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                        <option value="cash">Cash</option>
                        <option value="cashiers_check">Cashier&rsquo;s check</option>
                        <option value="check">Personal check</option>
                      </select>
                    </label>
                    <label className={labelClass}>Deposit state
                      <select className={inputClass} value={depositState} onChange={(e) => setDepositState(e.target.value)}>
                        <option value="received">Received — awaiting deposit</option>
                        <option value="deposited">Deposited</option>
                      </select>
                    </label>
                    <label className={labelClass}>Deposit amount
                      <input className={inputClass} value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} inputMode="decimal" placeholder="Portion of this payment that is security-deposit money" />
                    </label>
                    <label className={labelClass}>Applies to
                      <select className={inputClass} value={chargeId} onChange={(e) => setChargeId(e.target.value)}>
                        {chargeOptions.length === 0 && <option value="">No other open charge on this lease</option>}
                        {chargeOptions.map((charge) => (
                          <option key={charge.id} value={charge.id}>
                            {charge.id === payment.chargeId ? "Current: " : ""}{chargeLabels[charge.id] || charge.id}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                <label className={labelClass}>Receipt reference
                  <input className={inputClass} value={receiptReference} onChange={(e) => setReceiptReference(e.target.value)} placeholder="Check #, money order #, …" />
                </label>
                <label className={labelClass}>Notes
                  <textarea className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
                </label>

                {preview.length > 0 && (
                  <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 dark:border-sky-800 dark:bg-sky-950/30">
                    <p className="text-xs font-black uppercase tracking-wide text-sky-800 dark:text-sky-300">Before → after</p>
                    <ul className="mt-1.5 space-y-1 text-sm font-bold text-sky-900 dark:text-sky-200">
                      {preview.map((row) => (
                        <li key={row.field}>
                          {row.label}: {formatCorrectionValue(row.field, row.from, chargeLabels)} <span aria-hidden="true">→</span> {formatCorrectionValue(row.field, row.to, chargeLabels)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <label className={labelClass}>Reason *
                  <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this payment being corrected?" autoFocus />
                </label>
                <label className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  I confirm the corrected values are right.
                </label>
                {error && <p role="alert" className="text-sm font-bold text-red-600">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
                  <button type="submit" disabled={saving || preview.length === 0} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50">{saving ? "Correcting…" : "Correct payment"}</button>
                </div>
              </form>
            )}

            {corrections.length > 0 && (
              <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Correction history</p>
                <ul className="mt-2 space-y-2">
                  {corrections.map((correction) => (
                    <li key={correction.id} className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                      <p className="font-bold text-slate-900 dark:text-white">{formatDate(correction.correctedAt)} — {correction.reason}</p>
                      <ul className="mt-1 space-y-0.5 text-slate-600 dark:text-slate-300">
                        {correction.changes.map((change) => (
                          <li key={change.field}>{change.label}: {formatCorrectionValue(change.field, change.from, chargeLabels)} <span aria-hidden="true">→</span> {formatCorrectionValue(change.field, change.to, chargeLabels)}</li>
                        ))}
                      </ul>
                      {correction.reconciledWarning && (
                        <p className="mt-1 font-bold text-amber-700 dark:text-amber-300">Corrected while reconciled — no money facts changed.</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {doneSummary && (
          <div className="mt-4">
            <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              ✓ {centsToDollars(payment.amountCents)} payment corrected. The ledger, statement, and receipt now show the corrected values; the originals are kept in the correction history below.
            </p>
            <ul className="mt-3 space-y-1 text-sm font-bold text-slate-700 dark:text-slate-300">
              {doneSummary.changes.map((change) => (
                <li key={change.field}>{change.label}: {formatCorrectionValue(change.field, change.from, chargeLabels)} <span aria-hidden="true">→</span> {formatCorrectionValue(change.field, change.to, chargeLabels)}</li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={onClose} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
