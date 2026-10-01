"use client";
import { useEffect, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import StatementEmailDialog from "./StatementEmailDialog";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const CHARGE_TYPE_LABELS = {
  rent: "Rent",
  proration: "Proration",
  late_fee: "Late fee",
  damage: "Damage",
  fee: "Fee",
  utility: "Utility reimbursement",
  other: "Other charge",
};
const CHARGE_TYPES = Object.keys(CHARGE_TYPE_LABELS);
const inputClass = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 dark:border-slate-600 dark:bg-slate-900 dark:text-white";
const labelClass = "text-sm font-bold text-slate-900 dark:text-white";

async function fetchCharge(chargeId) {
  const response = await fetch(`/api/rental/tenant-charges?chargeId=${encodeURIComponent(chargeId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load the charge.");
  return body.charge;
}

// Edit Invoice — the reference accounting product's invoice screen, applied to
// a tenant charge (FORGE's invoice unit). Invoice Details (date, total,
// display-as) plus editable charge lines with Add Charge and a two-step
// Delete Invoice. New lines post as separate charges on the same lease — the
// tenant's balance is identical either way, and each line stays individually
// voidable. Payment-history safety: a line's amount can never drop below what
// has already been applied to the charge; paid charges are amount-final and
// voided charges are immutable (the API enforces all of this too).
export default function TenantInvoiceEditor({ chargeId, tenantId, tenantName, tenantEmail, onClose, onSaved }) {
  const [charge, setCharge] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [displayAs, setDisplayAs] = useState("");
  const [lines, setLines] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [emailInvoiceOpen, setEmailInvoiceOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCharge(chargeId).then(
      (row) => {
        if (cancelled) return;
        setCharge(row);
        setInvoiceDate(row.dueDate || "");
        setDisplayAs(row.notes || "");
        setLines([{ key: `existing:${row.id}`, chargeId: row.id, chargeType: row.chargeType, amount: (row.amountCents / 100).toFixed(2), memo: row.notes || "", paidCents: row.paidCents, isNew: false }]);
      },
      (caught) => { if (!cancelled) setLoadError(caught.message || "Unable to load the charge."); },
    );
    return () => { cancelled = true; };
  }, [chargeId]);

  const totalCents = lines.reduce((sum, line) => {
    const cents = Math.round(Number(line.amount) * 100);
    return sum + (Number.isSafeInteger(cents) && cents > 0 ? cents : 0);
  }, 0);

  function updateLine(key, field, value) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, [field]: value } : line)));
  }
  function removeLine(key) {
    const line = lines.find((item) => item.key === key);
    if (!line) return;
    if (!line.isNew) {
      // Removing the invoiced line voids the whole invoice — same two-step gate.
      setConfirmDelete(true);
      return;
    }
    setLines((current) => current.filter((item) => item.key !== key));
  }
  function addLine() {
    setLines((current) => [...current, {
      key: `new:${Date.now()}:${current.length}`,
      chargeId: null, chargeType: "other", amount: "", memo: "", paidCents: 0, isNew: true,
    }]);
  }

  function validate() {
    if (!invoiceDate) return "An invoice date is required.";
    for (const line of lines) {
      if (!CHARGE_TYPES.includes(line.chargeType)) return "Every line needs a category.";
      const cents = Math.round(Number(line.amount) * 100);
      if (!Number.isSafeInteger(cents) || cents <= 0) return "Every line needs a positive amount.";
      if (!line.isNew && cents < line.paidCents) {
        return `This invoice has ${money.format(line.paidCents / 100)} already applied — a line cannot go below applied payments.`;
      }
    }
    return "";
  }

  async function save(event) {
    event.preventDefault();
    const problem = validate();
    if (problem) { setError(problem); return; }
    setSubmitting(true);
    setError("");
    setSavedMessage("");
    try {
      const primary = lines.find((line) => !line.isNew);
      if (primary) {
        const response = await fetch("/api/rental/tenant-charges", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chargeId: primary.chargeId,
            dueDate: invoiceDate,
            chargeType: primary.chargeType,
            amountCents: Math.round(Number(primary.amount) * 100),
            notes: displayAs.trim() || primary.memo.trim() || null,
          }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to save the invoice.");
      }
      for (const line of lines.filter((item) => item.isNew)) {
        const response = await fetch("/api/rental/tenant-charges", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            leaseId: charge.leaseId,
            chargeType: line.chargeType,
            amountCents: Math.round(Number(line.amount) * 100),
            description: line.memo.trim() || CHARGE_TYPE_LABELS[line.chargeType],
            dueDate: invoiceDate,
            chargeDate: invoiceDate,
          }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to add the charge line.");
      }
      setSavedMessage(`Invoice saved — total ${money.format(totalCents / 100)}.`);
      onSaved?.();
    } catch (caught) {
      setError(caught.message || "Unable to save the invoice.");
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteInvoice() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/rental", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "void-charge", chargeId, reason: "Invoice deleted from the tenant ledger." }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to delete the invoice.");
      onSaved?.();
      onClose?.();
    } catch (caught) {
      setError(caught.message || "Unable to delete the invoice.");
      setConfirmDelete(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function sendInvoiceEmail() {
    const response = await fetch("/api/rental/tenant-statement-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId, kind: "invoice", chargeId }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "The invoice email could not be sent.");
    setEmailInvoiceOpen(false);
    setSavedMessage(body.alreadySent
      ? `Invoice already emailed to ${body.recipient || tenantEmail || "the tenant"}.`
      : `Invoice emailed to ${body.recipient || tenantEmail || "the tenant"}.`);
  }

  return (
    <div data-invoice-editor aria-label={`Edit invoice for ${tenantName || "tenant"}`}
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Tenants / {tenantName || "Tenant"}</p>
          <h3 className="mt-1 text-2xl font-black tracking-tight text-slate-950 dark:text-white">Edit Invoice</h3>
        </div>
        <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setEmailInvoiceOpen(true)} disabled={!charge || submitting}
          title="Email this invoice to the tenant"
          className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-2.5 text-sm font-black text-sky-700 transition hover:bg-sky-100 disabled:opacity-50 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950/60">
          Email invoice
        </button>
        <button type="button" onClick={deleteInvoice} disabled={submitting}
          className={`rounded-xl px-4 py-2.5 text-sm font-black text-white transition disabled:opacity-50 ${confirmDelete ? "bg-red-700 hover:bg-red-800" : "bg-red-600 hover:bg-red-700"}`}>
          {confirmDelete ? "Confirm delete invoice" : "Delete Invoice"}
        </button>
        </div>
      </div>
      {confirmDelete && (
        <p role="alert" className="mt-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-bold text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          Deleting voids this invoice. It is blocked while any payment is applied — resolve payments through refunds or credits first.
          <button type="button" onClick={() => setConfirmDelete(false)} className="ml-3 underline">Keep it</button>
        </p>
      )}

      {loadError ? (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{loadError}</p>
      ) : !charge ? (
        <p className="mt-4 text-sm font-bold text-slate-500 dark:text-slate-400">Loading invoice…</p>
      ) : (
        <form onSubmit={save}>
          <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
            <h4 className="bg-sky-700 px-4 py-2.5 text-sm font-black text-white dark:bg-sky-900">Invoice Details</h4>
            <div className="grid gap-4 p-4 sm:grid-cols-3">
              <label className={labelClass}>Date
                <input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} className={inputClass} />
              </label>
              <label className={labelClass}>Amount
                <input value={money.format(totalCents / 100)} readOnly aria-readonly
                  className={`${inputClass} bg-slate-100 dark:bg-slate-800`} title="Recalculated from the charge lines below" />
              </label>
              <label className={labelClass}>Display As
                <input value={displayAs} onChange={(event) => setDisplayAs(event.target.value)}
                  placeholder="Shown on the ledger line" className={inputClass} />
              </label>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
            <h4 className="bg-sky-700 px-4 py-2.5 text-sm font-black text-white dark:bg-sky-900">Charge Lines</h4>
            <div className="space-y-4 p-4">
              {lines.map((line) => (
                <div key={line.key} className="grid gap-3 sm:grid-cols-[1fr_10rem_1fr_auto] sm:items-end" data-invoice-line={line.isNew ? "new" : "existing"}>
                  <label className={labelClass}>Category
                    <select value={line.chargeType} onChange={(event) => updateLine(line.key, "chargeType", event.target.value)} className={inputClass}>
                      {CHARGE_TYPES.map((type) => (
                        <option key={type} value={type}>{CHARGE_TYPE_LABELS[type]}</option>
                      ))}
                    </select>
                  </label>
                  <label className={labelClass}>Amount
                    <input type="number" step="0.01" min="0.01" value={line.amount}
                      onChange={(event) => updateLine(line.key, "amount", event.target.value)}
                      inputMode="decimal" className={inputClass} />
                  </label>
                  <label className={labelClass}>Memo
                    <input value={line.memo} onChange={(event) => updateLine(line.key, "memo", event.target.value)}
                      placeholder="Optional memo" className={inputClass} />
                  </label>
                  <button type="button" onClick={() => removeLine(line.key)} title={line.isNew ? "Remove this line" : "Void this invoice"}
                    aria-label={line.isNew ? "Remove charge line" : "Void this invoice"}
                    className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-black text-slate-500 hover:bg-red-50 hover:text-red-700 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-red-950/40">
                    🗑
                  </button>
                  {!line.isNew && line.paidCents > 0 && (
                    <p className="text-xs font-bold text-amber-700 dark:text-amber-300 sm:col-span-4">
                      {money.format(line.paidCents / 100)} already applied — the amount cannot go below this.
                    </p>
                  )}
                </div>
              ))}
              <button type="button" onClick={addLine}
                className="rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-black text-white transition hover:bg-violet-800">
                + Add Charge
              </button>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                New lines post as separate charges on this tenant&apos;s ledger when you save — the balance owed is identical, and each line stays individually voidable.
              </p>
            </div>
          </div>

          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
          {savedMessage && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">{savedMessage}</p>}

          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <button type="button" onClick={onClose}
              className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              ← Cancel
            </button>
            <button type="submit" disabled={submitting}
              className={`rounded-xl px-5 py-2.5 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>
              {submitting ? "Saving…" : "✓ Save Changes"}
            </button>
          </div>
        </form>
      )}
      {emailInvoiceOpen && (
        <StatementEmailDialog
          title={`Email invoice — ${tenantName || "tenant"}`}
          recipientEmail={tenantEmail || ""}
          summaryLines={[
            { label: "Invoice", value: charge?.chargeType ? String(charge.chargeType).replaceAll("_", " ") : "Charge" },
            { label: "Amount", value: `$${(Number(charge?.amountCents || 0) / 100).toFixed(2)}` },
          ]}
          confirmLabel="Send invoice"
          onConfirm={sendInvoiceEmail}
          onClose={() => setEmailInvoiceOpen(false)}
        />
      )}
    </div>
  );
}
