"use client";
import { useEffect, useRef, useState } from "react";
import { validateSplits } from "@/application/rental/validateSplits";
import { TENANT_CHARGE_TYPES, TENANT_CHARGE_LABELS, defaultTenantChargeDueDate } from "@/application/rental/tenantCharges";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { MANUAL_FINANCIAL_EVENT_CATEGORIES } from "@/application/financial/manualFinancialEventCategories";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";

const today = () => new Date().toISOString().slice(0, 10);
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

async function fetchBankAccounts() {
  const response = await fetch("/api/rental/bank-accounts");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load bank accounts.");
  return body.accounts || [];
}

async function fetchSplits(eventId) {
  const response = await fetch(`/api/rental/transaction-splits?eventId=${encodeURIComponent(eventId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load split lines.");
  return (body.splits || []).map((split) => ({
    normalizedCategory: split.normalized_category,
    amount: String(split.amount),
    memo: split.memo || "",
  }));
}

async function saveSplits(eventId, splits) {
  const response = await fetch("/api/rental/transaction-splits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId, splits }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to save split lines.");
}

async function fetchAttachments(eventId) {
  const response = await fetch(`/api/rental/transaction-attachments?eventId=${encodeURIComponent(eventId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load attachments.");
  return body.attachments || [];
}

async function uploadAttachment(eventId, file) {
  const form = new FormData();
  form.append("eventId", eventId);
  form.append("file", file);
  const response = await fetch("/api/rental/transaction-attachments", { method: "POST", body: form });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to upload the attachment.");
  return body.attachment;
}

async function deleteAttachment(attachmentId) {
  const response = await fetch(`/api/rental/transaction-attachments?attachmentId=${encodeURIComponent(attachmentId)}`, { method: "DELETE" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to remove the attachment.");
}

const emptyForm = (propertyId, kind) => ({
  eventDate: today(),
  transactionKind: kind === "income" ? "income" : "expense",
  amount: "",
  description: "",
  payee: "",
  checkNumber: "",
  bankAccountId: "",
  tenantId: "",
  propertyId: propertyId || "",
  normalizedCategory: kind === "income" ? "rental_income" : "property_repairs",
  memo: "",
  cleared: false,
});

// Rentec-style Post Income / Post Expense form. Writes through POST
// /api/rental/transactions, which stores the new slice-2 columns (payee,
// check number, bank account, cleared flag). Used as a modal from the property
// ledger; edit mode arrives in the edit slice via the initialEvent prop.
// Live split-total indicator: green when the lines match the transaction amount
// to the cent, amber otherwise.
function SplitTotalIndicator({ splits, amount }) {
  const splitCents = splits.reduce((sum, split) => sum + Math.round(Number(split.amount || 0) * 100), 0);
  const totalCents = Math.round(Number(amount || 0) * 100);
  const balanced = totalCents > 0 && splitCents === totalCents;
  return (
    <span className={`rounded-lg px-2.5 py-1.5 text-xs font-black ${balanced
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
      : "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"}`}>
      Lines total ${(splitCents / 100).toFixed(2)}{balanced ? " — balanced" : ` of $${(totalCents / 100).toFixed(2)}`}
    </span>
  );
}

async function fetchTenantLeases(tenantId) {
  const response = await fetch(`/api/rental/tenant-leases?tenantId=${encodeURIComponent(tenantId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load the tenant's leases.");
  return body.leases || [];
}

// "Charge tenant" section for the Post Expense form. Mounted with
// key={tenantId} so every tenant selection starts from a clean slate. The
// charge amount tracks the expense amount until the user types their own
// value (derived during render — no effect, no cascading render); the due
// date defaults to event date + 15 days; the lease list is fetched on mount
// with exactly one active lease preselected. Reports up through chargeRef as
// { enabled, validate(), getPayload() }, which the parent reads at submit
// time.
function ChargeTenantSection({ tenantId, expenseAmount, eventDate, chargeRef, inputClass, labelClass }) {
  const [chargeEnabled, setChargeEnabled] = useState(false);
  const [leases, setLeases] = useState({ loading: true, error: "", rows: [] });
  const [leaseId, setLeaseId] = useState("");
  const [chargeType, setChargeType] = useState("other");
  const [customAmount, setCustomAmount] = useState(null);
  const [dueDate, setDueDate] = useState(() => defaultTenantChargeDueDate(eventDate) || "");
  const [chargeDescription, setChargeDescription] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const effectiveAmount = customAmount ?? (expenseAmount ? String(expenseAmount) : "");
  const chargeCents = Math.round(Number(effectiveAmount) * 100);
  const confirmLabel = Number.isSafeInteger(chargeCents) && chargeCents > 0 ? money.format(chargeCents / 100) : "the entered amount";

  useEffect(() => {
    let cancelled = false;
    fetchTenantLeases(tenantId).then(
      (rows) => {
        if (cancelled) return;
        setLeases({ loading: false, error: "", rows });
        const active = rows.filter((lease) => lease.status === "active");
        if (active.length === 1) setLeaseId(active[0].id);
      },
      (caught) => {
        if (!cancelled) setLeases({ loading: false, error: caught.message || "Unable to load the tenant's leases.", rows: [] });
      },
    );
    return () => { cancelled = true; chargeRef.current = null; };
  }, [tenantId, chargeRef]);

  const chargeApi = {
    enabled: chargeEnabled,
    validate() {
      if (!chargeEnabled) return "";
      if (leases.loading) return "The tenant's leases are still loading.";
      if (leases.error) return leases.error;
      if (leases.rows.length === 0) return "This tenant has no lease to attach the charge to.";
      if (!leaseId) return "Select the lease to attach the charge to.";
      if (!Number.isSafeInteger(chargeCents) || chargeCents <= 0) return "Enter a positive charge amount.";
      if (!dueDate) return "A charge due date is required.";
      if (!confirmed) return "Check the confirmation to post the tenant charge.";
      return "";
    },
    getPayload() {
      return {
        leaseId,
        chargeType,
        amountCents: chargeCents,
        description: chargeDescription.trim() || undefined,
        dueDate,
      };
    },
  };

  // Publish the latest charge state for the parent's submit handler. An effect
  // (not render) so the ref write follows the rules of hooks; it re-runs after
  // every render so the closures never go stale.
  useEffect(() => {
    chargeRef.current = chargeApi;
  });

  return (
    <div data-charge-tenant-section className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40">
      <label className="flex items-start gap-2 text-sm font-black text-slate-900 dark:text-white">
        <input type="checkbox" checked={chargeEnabled}
          onChange={(event) => { setChargeEnabled(event.target.checked); setConfirmed(false); }}
          className="mt-1 h-4 w-4 accent-emerald-600" />
        <span>Charge tenant
          <span className="block font-normal text-slate-500 dark:text-slate-400">Post this expense as a charge on the tenant&apos;s ledger — the tenant will owe this amount.</span>
        </span>
      </label>

      {chargeEnabled && (
        leases.loading ? (
          <p className="mt-3 text-sm font-bold text-slate-500 dark:text-slate-400">Loading the tenant&apos;s leases…</p>
        ) : leases.error ? (
          <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{leases.error}</p>
        ) : leases.rows.length === 0 ? (
          <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            This tenant has no lease to attach the charge to.
          </p>
        ) : (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className={labelClass}>Lease
                <select value={leaseId} onChange={(event) => { setLeaseId(event.target.value); setConfirmed(false); }} className={inputClass}>
                  <option value="">Select a lease…</option>
                  {leases.rows.map((lease) => (
                    <option key={lease.id} value={lease.id}>
                      {lease.label || lease.id} · {lease.status}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>Charge type
                <select value={chargeType} onChange={(event) => setChargeType(event.target.value)} className={inputClass}>
                  {TENANT_CHARGE_TYPES.map((type) => (
                    <option key={type} value={type}>{TENANT_CHARGE_LABELS[type]}</option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>Charge amount
                <input type="number" step="0.01" min="0.01" value={effectiveAmount} inputMode="decimal" placeholder="0.00"
                  onChange={(event) => setCustomAmount(event.target.value)}
                  className={inputClass} />
              </label>
              <label className={labelClass}>Due date
                <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className={inputClass} />
              </label>
              <label className={`${labelClass} sm:col-span-2`}>Charge description
                <input value={chargeDescription} onChange={(event) => setChargeDescription(event.target.value)}
                  placeholder="Defaults to the expense description" className={inputClass} />
              </label>
            </div>
            <label className="mt-4 flex items-start gap-2 text-sm font-bold text-slate-900 dark:text-white">
              <input type="checkbox" checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-1 h-4 w-4 accent-emerald-600" />
              <span>I confirm this posts a {confirmLabel} charge to the tenant&apos;s ledger.</span>
            </label>
          </>
        )
      )}
    </div>
  );
}

export default function TransactionForm({
  propertyId,
  properties = [],
  tenants = [],
  defaultKind = "expense",
  initialEvent = null,
  submitLabel = null,
  onSaved,
  onCancel,
}) {
  const [form, setForm] = useState(() => ({ ...emptyForm(propertyId, defaultKind), ...(initialEvent || {}) }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [pendingFiles, setPendingFiles] = useState([]);
  const [savedAttachments, setSavedAttachments] = useState([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(Boolean(initialEvent?.id));
  const [splits, setSplits] = useState([]);
  const [splitsLoading, setSplitsLoading] = useState(Boolean(initialEvent?.id));
  const { data: accountsData } = useStaleWhileRevalidate("transaction-form:bank-accounts", fetchBankAccounts, { ttlMs: 300_000 });
  const accounts = accountsData || [];

  const editingId = initialEvent?.id || null;

  // Charge-tenant section (create mode, expense kind, tenant selected only —
  // never in edit mode: PATCH with chargeTenant=true is rejected server-side).
  // The section owns its state inside ChargeTenantSection, remounted per tenant
  // via key so every tenant selection starts clean. It reports up through
  // chargeRef ({ enabled, validate(), getPayload() }) — the parent reads it at
  // submit time, so no setState-in-effect syncing is needed. Posting the charge
  // makes the tenant owe money, so it stays off by default and requires the
  // human-gate confirm checkbox.
  const chargeSectionVisible = !editingId && form.transactionKind === "expense" && Boolean(form.tenantId);
  const chargeRef = useRef(null);

  // Load existing attachments and split lines in edit mode — once on mount.
  // State updates happen in the fetch callbacks, never synchronously in the
  // effect body.
  useEffect(() => {
    if (!editingId) return undefined;
    let cancelled = false;
    fetchAttachments(editingId).then(
      (rows) => { if (!cancelled) { setSavedAttachments(rows); setAttachmentsLoading(false); } },
      () => { if (!cancelled) { setSavedAttachments([]); setAttachmentsLoading(false); } },
    );
    fetchSplits(editingId).then(
      (rows) => { if (!cancelled) { setSplits(rows); setSplitsLoading(false); } },
      () => { if (!cancelled) { setSplits([]); setSplitsLoading(false); } },
    );
    return () => { cancelled = true; };
  }, [editingId]);

  async function refreshAttachments() {
    if (!editingId) return;
    setAttachmentsLoading(true);
    try {
      setSavedAttachments(await fetchAttachments(editingId));
    } catch {
      setSavedAttachments([]);
    } finally {
      setAttachmentsLoading(false);
    }
  }

  const update = (field) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  function validate() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.eventDate)) return "A valid date is required.";
    if (form.eventDate > today()) return "The date cannot be in the future.";
    const cents = Math.round(Number(form.amount) * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0) return "Enter a positive amount.";
    if (!form.description.trim()) return "A description is required.";
    if (splits.length > 0) {
      const splitCheck = validateSplits(
        splits.map((split) => ({ normalizedCategory: split.normalizedCategory, amount: Number(split.amount), memo: split.memo })),
        Number(form.amount),
      );
      if (!splitCheck.valid) return splitCheck.errors[0];
    }
    if (chargeSectionVisible) {
      const chargeProblem = chargeRef.current?.validate() || "";
      if (chargeProblem) return chargeProblem;
    }
    return "";
  }

  async function submit(event) {
    event.preventDefault();
    const problem = validate();
    if (problem) { setError(problem); return; }
    setSubmitting(true);
    setError("");
    try {
      const isEdit = Boolean(initialEvent?.id);
      const response = await fetch("/api/rental/transactions", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(isEdit ? { eventId: initialEvent.id } : {}),
          eventDate: form.eventDate,
          transactionKind: form.transactionKind,
          amount: Number(form.amount),
          description: form.description.trim(),
          payee: form.payee.trim() || null,
          checkNumber: form.checkNumber.trim() || null,
          bankAccountId: form.bankAccountId || null,
          tenantId: form.tenantId || null,
          propertyId: form.propertyId || null,
          normalizedCategory: form.normalizedCategory,
          memo: form.memo.trim() || null,
          cleared: form.cleared,
          // Expense-linked tenant charge: the server creates the expense and
          // the rent_charges row atomically. A missing charge description falls
          // back to the expense description server-side.
          ...(chargeSectionVisible && chargeRef.current?.enabled ? {
            chargeTenant: true,
            tenantCharge: chargeRef.current.getPayload(),
          } : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to save the transaction.");
      const savedEvent = body.event;
      const savedId = isEdit ? initialEvent.id : savedEvent?.id;
      // Split lines save after the event — the server re-validates the total.
      // A split failure must not lose the transaction — it is reported and the
      // event still saves.
      if (savedId && splits.length > 0) {
        try {
          await saveSplits(savedId, splits.map((split) => ({
            normalizedCategory: split.normalizedCategory,
            amount: Number(split.amount),
            memo: split.memo.trim() || null,
          })));
        } catch (splitError) {
          setError(`Transaction saved, but the split lines failed: ${splitError.message}`);
        }
      }
      // Files picked before the event existed upload now that it has an id.
      // An upload failure must not lose the transaction — it is reported and
      // the event still saves.
      if (!isEdit && savedEvent?.id && pendingFiles.length > 0) {
        for (const file of pendingFiles) {
          try {
            await uploadAttachment(savedEvent.id, file);
          } catch (uploadError) {
            setError(`Transaction saved, but "${file.name}" failed to upload: ${uploadError.message}`);
          }
        }
      }
      onSaved?.(savedEvent);
    } catch (caught) {
      setError(caught.message || "Unable to save the transaction.");
    } finally {
      setSubmitting(false);
    }
  }

  const isIncome = form.transactionKind === "income";
  const inputClass = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 dark:border-slate-600 dark:bg-slate-900 dark:text-white";
  const labelClass = "text-sm font-bold text-slate-900 dark:text-white";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 print:hidden"
      onClick={onCancel} role="presentation">
      <div role="dialog" aria-modal="true" aria-label={initialEvent ? "Edit transaction" : `Post ${isIncome ? "income" : "expense"}`}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-xl font-black text-slate-950 dark:text-white">
            {initialEvent ? "Edit transaction" : `Post ${isIncome ? "income" : "expense"}`}
          </h3>
          <button type="button" onClick={onCancel} aria-label="Close transaction form"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-black text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">✕</button>
        </div>

        <form onSubmit={submit} className="mt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className={labelClass}>Type
              <div className="mt-1 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Transaction type">
                {(["expense", "income"]).map((kind) => (
                  <button key={kind} type="button" role="radio" aria-checked={form.transactionKind === kind}
                    onClick={() => setForm((current) => ({
                      ...current,
                      transactionKind: kind,
                      normalizedCategory: kind === "income" ? "rental_income" : "property_repairs",
                    }))}
                    className={`rounded-xl border px-4 py-2.5 text-sm font-black transition ${form.transactionKind === kind
                      ? kind === "income"
                        ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                      : "border-slate-300 text-slate-600 hover:border-slate-400 dark:border-slate-600 dark:text-slate-300"}`}>
                    {kind === "income" ? "Income (credit)" : "Expense (debit)"}
                  </button>
                ))}
              </div>
            </div>
            <label className={labelClass}>Date
              <input type="date" required value={form.eventDate} max={today()} onChange={update("eventDate")} className={inputClass} />
            </label>
            <label className={labelClass}>Amount
              <input type="number" step="0.01" min="0.01" required value={form.amount} onChange={update("amount")}
                placeholder="0.00" inputMode="decimal" className={inputClass} />
            </label>
            <label className={labelClass}>Category
              <select value={form.normalizedCategory} onChange={update("normalizedCategory")} className={inputClass}>
                {MANUAL_FINANCIAL_EVENT_CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>{category.label}</option>
                ))}
              </select>
            </label>
            <label className={`${labelClass} sm:col-span-2`}>Description
              <input value={form.description} onChange={update("description")} required
                placeholder={isIncome ? "e.g. October rent — 308 Paula" : "e.g. Water heater replacement"}
                className={inputClass} />
            </label>
            <label className={labelClass}>Payee
              <input value={form.payee} onChange={update("payee")} placeholder="Vendor or payer name (optional)" className={inputClass} />
            </label>
            <label className={labelClass}>Check #
              <input value={form.checkNumber} onChange={update("checkNumber")} placeholder="Optional" className={inputClass} />
            </label>
            <label className={labelClass}>Bank account
              <select value={form.bankAccountId} onChange={update("bankAccountId")} className={inputClass}>
                <option value="">Not from a bank account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.official_name || account.name}</option>
                ))}
              </select>
            </label>
            <label className={labelClass}>Property
              <select value={form.propertyId} onChange={update("propertyId")} className={inputClass}>
                <option value="">Rental business / portfolio</option>
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>{property.label || property.id}</option>
                ))}
              </select>
            </label>
            <label className={labelClass}>Tenant
              <span className="block font-normal text-slate-500 dark:text-slate-400">Links this transaction to the tenant&apos;s record.</span>
              <select value={form.tenantId} onChange={update("tenantId")} className={inputClass}>
                <option value="">No tenant</option>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>{tenant.name || tenant.id}</option>
                ))}
              </select>
            </label>
            <label className={`${labelClass} flex items-start gap-2 pt-6`}>
              <input type="checkbox" checked={form.cleared} onChange={update("cleared")} className="mt-1 h-4 w-4 accent-emerald-600" />
              <span>Cleared<span className="block font-normal text-slate-500 dark:text-slate-400">Already cleared the bank.</span></span>
            </label>
            <label className={`${labelClass} sm:col-span-2`}>Memo
              <input value={form.memo} onChange={update("memo")} placeholder="Optional note on this transaction" className={inputClass} />
            </label>
          </div>

          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

          <div className={`${labelClass} mt-4`}>
            Split lines
            <span className="block font-normal text-slate-500 dark:text-slate-400">Break this transaction across categories. The lines must total the amount exactly.</span>
            {splitsLoading
              ? <p className="mt-2 text-xs font-bold text-slate-400">Loading split lines…</p>
              : (
                <>
                  {splits.length > 0 && (
                    <ul className="mt-2 space-y-2">
                      {splits.map((split, index) => (
                        <li key={index} className="grid grid-cols-12 gap-2 rounded-xl bg-slate-50 p-2 dark:bg-slate-800/60">
                          <select value={split.normalizedCategory}
                            onChange={(event) => setSplits((current) => current.map((row, i) => i === index ? { ...row, normalizedCategory: event.target.value } : row))}
                            aria-label={`Split line ${index + 1} category`}
                            className="col-span-5 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-900">
                            {MANUAL_FINANCIAL_EVENT_CATEGORIES.map((category) => (
                              <option key={category.value} value={category.value}>{category.label}</option>
                            ))}
                          </select>
                          <input type="number" min="0.01" step="0.01" value={split.amount}
                            onChange={(event) => setSplits((current) => current.map((row, i) => i === index ? { ...row, amount: event.target.value } : row))}
                            aria-label={`Split line ${index + 1} amount`} placeholder="0.00"
                            className="col-span-3 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-900" />
                          <input type="text" value={split.memo}
                            onChange={(event) => setSplits((current) => current.map((row, i) => i === index ? { ...row, memo: event.target.value } : row))}
                            aria-label={`Split line ${index + 1} memo`} placeholder="Memo"
                            className="col-span-3 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-900" />
                          <button type="button" aria-label={`Remove split line ${index + 1}`}
                            onClick={() => setSplits((current) => current.filter((_, i) => i !== index))}
                            className="col-span-1 rounded-lg text-sm font-black text-slate-400 hover:text-red-700 dark:hover:text-red-400">✕</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button type="button"
                      onClick={() => setSplits((current) => [...current, { normalizedCategory: "other", amount: "", memo: "" }])}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-black text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                      + Add split line
                    </button>
                    {splits.length > 0 && (
                      <SplitTotalIndicator splits={splits} amount={form.amount} />
                    )}
                  </div>
                </>
              )}
          </div>

          <div className={`${labelClass} mt-4`}>
            Attachments
            <span className="block font-normal text-slate-500 dark:text-slate-400">Receipts, invoices — PDF, JPG, or PNG, up to 10 MB each.</span>
            <input type="file" multiple accept="application/pdf,image/jpeg,image/png"
              onChange={async (event) => {
                const files = Array.from(event.target.files || []);
                event.target.value = "";
                if (files.length === 0) return;
                if (editingId) {
                  for (const file of files) {
                    try {
                      await uploadAttachment(editingId, file);
                    } catch (caught) {
                      setError(`"${file.name}" failed to upload: ${caught.message}`);
                      return;
                    }
                  }
                  await refreshAttachments();
                } else {
                  setPendingFiles((current) => [...current, ...files]);
                }
              }}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-normal dark:border-slate-600 dark:bg-slate-900" />
            {pendingFiles.length > 0 && (
              <ul className="mt-2 space-y-1">
                {pendingFiles.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold dark:bg-slate-800">
                    <span className="truncate">{file.name}</span>
                    <button type="button"
                      onClick={() => setPendingFiles((current) => current.filter((_, i) => i !== index))}
                      className="shrink-0 font-black text-slate-500 hover:text-red-700 dark:hover:text-red-400">Remove</button>
                  </li>
                ))}
              </ul>
            )}
            {editingId && (
              attachmentsLoading
                ? <p className="mt-2 text-xs font-bold text-slate-400">Loading attachments…</p>
                : savedAttachments.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {savedAttachments.map((attachment) => (
                      <li key={attachment.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold dark:bg-slate-800">
                        <span className="truncate">{attachment.filename}</span>
                        <button type="button"
                          onClick={async () => {
                            try {
                              await deleteAttachment(attachment.id);
                              await refreshAttachments();
                            } catch (caught) {
                              setError(caught.message);
                            }
                          }}
                          className="shrink-0 font-black text-slate-500 hover:text-red-700 dark:hover:text-red-400">Remove</button>
                      </li>
                    ))}
                  </ul>
                )
            )}
          </div>

          {chargeSectionVisible && (
            <ChargeTenantSection key={form.tenantId} tenantId={form.tenantId}
              expenseAmount={form.amount} eventDate={form.eventDate}
              chargeRef={chargeRef} inputClass={inputClass} labelClass={labelClass} />
          )}

          <div className="mt-5 flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
              {form.amount && Number(form.amount) > 0 ? `Posting ${money.format(Number(form.amount))} as ${isIncome ? "credit" : "debit"}` : " "}
            </p>
            <button type="submit" disabled={submitting}
              className={`rounded-xl px-5 py-3 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>
              {submitting ? "Saving…" : submitLabel || (initialEvent ? "Save changes" : `Post ${isIncome ? "income" : "expense"}`)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
