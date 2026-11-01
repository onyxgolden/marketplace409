"use client";
import { useCallback, useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";

function resolveEnrollmentLabel(item, body) {
  const lease = (body.leases || []).find((entry) => entry.id === item.lease_id);
  const membership = (body.leaseMemberships || []).find((entry) => entry.lease_id === item.lease_id);
  const tenant = (body.tenants || []).find((entry) => entry.id === (membership?.tenant_id || item.tenant_id));
  const unit = (body.units || []).find((entry) => entry.id === lease?.unit_id);
  const tenantLabel = tenant?.display_name || null;
  const unitLabel = unit?.label || null;
  if (tenantLabel && unitLabel) return `${tenantLabel} — ${unitLabel}`;
  if (tenantLabel) return tenantLabel;
  if (unitLabel) return unitLabel;
  return `Lease ${item.lease_id}`;
}

export default function RentalAutopayPanel() {
  // Autopay authorizations: stale-while-revalidate. The cached list renders
  // instantly on return visits and refreshes in the background — the last
  // good list never blanks out.
  const fetchAutopay = useCallback(async () => {
    const response = await fetch("/api/rental");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    return body;
  }, []);
  const { data, error: loadError, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    "rental:autopay",
    fetchAutopay,
    { ttlMs: 60_000 },
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const items = data?.autopayEnrollments || null;

  async function post(body, success) {
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(success(result));
      setConfirming(null); setEditingId(null);
      await refresh();
      return true;
    } catch (caught) { setError(caught.message); return false; } finally { setBusy(false); }
  }

  async function runAction(item, operation, extra = {}) {
    const label = resolveEnrollmentLabel(item, data || {});
    const successText = {
      "pause-autopay": `Autopay paused for ${label} — the next sweep will skip this lease.`,
      "resume-autopay": `Autopay resumed for ${label} — the next sweep will collect again.`,
      "cancel-autopay": `Autopay cancelled for ${label}.`,
    }[operation];
    return post({ operation, enrollmentId: item.id, ...extra }, () => successText);
  }

  async function saveEdit(event, item) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const label = resolveEnrollmentLabel(item, data || {});
    await post({ operation: "update-autopay", enrollmentId: item.id,
      chargeDay: Number(form.get("chargeDay")), reminderDaysBefore: Number(form.get("reminderDaysBefore")) },
      () => `Autopay timing saved for ${label}: charged on day ${form.get("chargeDay")}, reminded ${form.get("reminderDaysBefore")} days before.`);
  }

  if (!items && isLoading) return <ForgeLoadingState label="Loading autopay authorizations…" />;
  if (!items && loadError) {
    return <ForgeErrorState
      title="Unable to load autopay authorizations"
      detail={loadError}
      onRetry={() => refresh()}
    />;
  }

  return <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
    <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Autopay</p>
    <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Tenant authorizations</h2>
    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Consent alone never activates a debit. “Setup required” means Stripe has not yet supplied both a reusable payment method and mandate.</p>
    {message ? <p role="status" className="mt-3 rounded-xl bg-emerald-100 px-4 py-3 text-sm font-bold text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200">{message}</p> : null}
    {error ? <p role="alert" className="mt-3 rounded-xl bg-red-100 px-4 py-3 text-sm font-bold text-red-900 dark:bg-red-900/40 dark:text-red-200">{error}</p> : null}
    {items && loadError ? <p role="status" className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Could not refresh — showing the last saved authorizations.</p> : null}
    {items && isRefreshing ? <p className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p> : null}
    <div className="mt-5 space-y-3">{items.length ? items.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <strong className="text-slate-950 dark:text-white">{resolveEnrollmentLabel(item, data || {})}</strong>
      <p className="text-sm text-slate-600 dark:text-slate-400">{item.status.replaceAll("_", " ")} · {item.payment_method_type.replaceAll("_", " ")} · day {item.charge_day} · reminded {item.reminder_days_before} days before</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Consented {new Date(item.consented_at).toLocaleString()}{item.cancelled_at ? ` · Cancelled ${new Date(item.cancelled_at).toLocaleString()}` : ""}</p>
      {item.status === "setup_required" ? <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Setup still incomplete — the tenant must finish bank or card setup in the portal before debits start. You can cancel it from here, or change its timing.</p> : null}
      {item.status === "cancelled" ? null : <div className="mt-3 flex flex-wrap gap-2">
        {item.status === "active" ? <button type="button" disabled={busy} onClick={() => setConfirming({ id: item.id, operation: "pause-autopay" })} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Pause autopay</button> : null}
        {item.status === "paused" ? <button type="button" disabled={busy} onClick={() => setConfirming({ id: item.id, operation: "resume-autopay" })} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Resume autopay</button> : null}
        <button type="button" disabled={busy} onClick={() => { setEditingId(item.id); setConfirming(null); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Edit timing</button>
        <button type="button" disabled={busy} onClick={() => { setConfirming({ id: item.id, operation: "cancel-autopay" }); setCancelReason(""); }} className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30">Cancel autopay</button>
      </div>}
      {confirming?.id === item.id && confirming.operation === "pause-autopay" ? <div role="alertdialog" aria-label="Confirm pause" className="mt-3 rounded-xl border border-slate-300 bg-white p-4 dark:border-slate-600 dark:bg-slate-900">
        <p className="text-sm font-bold text-slate-900 dark:text-white">Pause autopay for this lease? The next sweep will skip it. Resume anytime.</p>
        <div className="mt-3 flex gap-3">
          <button type="button" disabled={busy} onClick={() => runAction(item, "pause-autopay")} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">Confirm pause</button>
          <button type="button" onClick={() => setConfirming(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Keep it running</button>
        </div>
      </div> : null}
      {confirming?.id === item.id && confirming.operation === "resume-autopay" ? <div role="alertdialog" aria-label="Confirm resume" className="mt-3 rounded-xl border border-slate-300 bg-white p-4 dark:border-slate-600 dark:bg-slate-900">
        <p className="text-sm font-bold text-slate-900 dark:text-white">Resume autopay for this lease? The next sweep will collect again on the charge day.</p>
        <div className="mt-3 flex gap-3">
          <button type="button" disabled={busy} onClick={() => runAction(item, "resume-autopay")} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">Confirm resume</button>
          <button type="button" onClick={() => setConfirming(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Stay paused</button>
        </div>
      </div> : null}
      {confirming?.id === item.id && confirming.operation === "cancel-autopay" ? <form aria-label="Cancel autopay" onSubmit={async (event) => { event.preventDefault(); await runAction(item, "cancel-autopay", { reason: cancelReason, ownerConfirmed: true }); }} className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/30">
        <p className="text-sm text-slate-700 dark:text-slate-300">Cancelling stops all future debits for this lease. The tenant can re-enrol in the portal. To change the payment method instead, cancel here and ask the tenant to re-enrol — a new method needs the tenant&apos;s own consent and Stripe setup.</p>
        <label className="mt-3 block text-sm font-bold text-slate-900 dark:text-white">Reason for cancelling<input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} required className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <label className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><input type="checkbox" required /> I confirm I want to cancel this autopay authorization.</label>
        <div className="mt-3 flex gap-3">
          <button type="submit" disabled={busy} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-800 disabled:opacity-50">Confirm cancel</button>
          <button type="button" onClick={() => setConfirming(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Keep it</button>
        </div>
      </form> : null}
      {editingId === item.id ? <form onSubmit={(event) => saveEdit(event, item)} className="mt-3 grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-3 dark:border-slate-700">
        <label className="text-sm font-bold text-slate-900 dark:text-white">Charge day (1–28)<input name="chargeDay" type="number" min="1" max="28" required defaultValue={item.charge_day} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Reminder days before (0–14)<input name="reminderDaysBefore" type="number" min="0" max="14" required defaultValue={item.reminder_days_before} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <div className="flex items-end gap-3">
          <button type="submit" disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">Save timing</button>
          <button type="button" onClick={() => setEditingId(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
        </div>
      </form> : null}
    </article>) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-950/40 dark:text-slate-400">No tenant autopay authorizations recorded.</p>}</div>
  </section>;
}
