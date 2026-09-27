"use client";
import { useEffect, useState } from "react";
import { TENANT_CHARGE_TYPES, TENANT_CHARGE_LABELS, defaultTenantChargeDueDate } from "@/application/rental/tenantCharges";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const today = () => new Date().toISOString().slice(0, 10);
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

async function fetchTenantLeases(tenantId) {
  const response = await fetch(`/api/rental/tenant-leases?tenantId=${encodeURIComponent(tenantId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load the tenant's leases.");
  return body.leases || [];
}

// Standalone "Add charge" — posts ONLY a tenant charge through POST
// /api/rental/tenant-charges. No expense is fabricated: this creates the
// schedule-less rent_charges row and nothing else. Used inline on the tenant
// ledger beside "Post Income". Posting a charge makes the tenant owe money,
// so the human-gate confirm checkbox is required.
export default function AddTenantChargeForm({ tenantId, tenantName, onSaved, onCancel }) {
  const [leases, setLeases] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [leaseId, setLeaseId] = useState("");
  const [chargeType, setChargeType] = useState("other");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(() => defaultTenantChargeDueDate(today()) || "");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchTenantLeases(tenantId).then(
      (rows) => {
        if (cancelled) return;
        setLeases(rows);
        const active = rows.filter((lease) => lease.status === "active");
        if (active.length === 1) setLeaseId(active[0].id);
      },
      (caught) => {
        if (!cancelled) setLoadError(caught.message || "Unable to load the tenant's leases.");
      },
    );
    return () => { cancelled = true; };
  }, [tenantId]);

  function validate() {
    if (loadError) return loadError;
    if (!leases) return "The tenant's leases are still loading.";
    if (leases.length === 0) return "This tenant has no lease to attach the charge to.";
    if (!leaseId) return "Select the lease to attach the charge to.";
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0) return "Enter a positive charge amount.";
    if (!description.trim()) return "A description is required for the charge.";
    if (!dueDate) return "A charge due date is required.";
    if (!confirmed) return "Check the confirmation to post the charge.";
    return "";
  }

  async function submit(event) {
    event.preventDefault();
    const problem = validate();
    if (problem) { setError(problem); return; }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/rental/tenant-charges", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leaseId,
          chargeType,
          amountCents: Math.round(Number(amount) * 100),
          description: description.trim(),
          dueDate,
          chargeDate: today(),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to post the charge.");
      onSaved?.(body.charge);
    } catch (caught) {
      setError(caught.message || "Unable to post the charge.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 dark:border-slate-600 dark:bg-slate-900 dark:text-white";
  const labelClass = "text-sm font-bold text-slate-900 dark:text-white";
  const cents = Math.round(Number(amount) * 100);
  const confirmLabel = Number.isSafeInteger(cents) && cents > 0 ? money.format(cents / 100) : "the entered amount";

  return (
    <form onSubmit={submit} data-add-tenant-charge-form aria-label={`Add charge for ${tenantName || "tenant"}`}
      className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-lg font-black text-slate-950 dark:text-white">Add charge{tenantName ? ` — ${tenantName}` : ""}</h4>
        {onCancel && <button type="button" onClick={onCancel} className="text-sm font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">Cancel</button>}
      </div>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Posts a charge to the tenant&apos;s ledger. This does not create an expense — it only makes the tenant owe the amount.
      </p>

      {loadError ? (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{loadError}</p>
      ) : !leases ? (
        <p className="mt-4 text-sm font-bold text-slate-500 dark:text-slate-400">Loading the tenant&apos;s leases…</p>
      ) : leases.length === 0 ? (
        <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          This tenant has no lease to attach the charge to.
        </p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>Lease
            <select value={leaseId} onChange={(event) => setLeaseId(event.target.value)} className={inputClass}>
              <option value="">Select a lease…</option>
              {leases.map((lease) => (
                <option key={lease.id} value={lease.id}>{lease.label || lease.id} · {lease.status}</option>
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
          <label className={labelClass}>Amount
            <input type="number" step="0.01" min="0.01" required value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00" inputMode="decimal" className={inputClass} />
          </label>
          <label className={labelClass}>Due date
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className={inputClass} />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>Description
            <input value={description} onChange={(event) => setDescription(event.target.value)}
              placeholder="e.g. Broken window — bedroom" className={inputClass} />
          </label>
          <label className="flex items-start gap-2 text-sm font-bold text-slate-900 dark:text-white sm:col-span-2">
            <input type="checkbox" checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-1 h-4 w-4 accent-emerald-600" />
            <span>I confirm this posts a {confirmLabel} charge to {tenantName || "the tenant"}&apos;s ledger.</span>
          </label>
        </div>
      )}

      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      {leases && leases.length > 0 && (
        <button type="submit" disabled={submitting}
          className={`mt-4 rounded-xl px-5 py-3 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>
          {submitting ? "Posting…" : "Post charge"}
        </button>
      )}
    </form>
  );
}
