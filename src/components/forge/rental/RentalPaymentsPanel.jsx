"use client";
import { useEffect, useMemo, useState } from "react";
import RentalRecordBrowser from "./RentalRecordBrowser";
import { isChargeForgeCollectible } from "@/application/rental/isChargeForgeCollectible";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const label = (value) => value?.replaceAll("_", " ") || "—";
export const paymentDisplayTimestamp = (payment) => payment.received_at || payment.succeeded_at || payment.created_at || null;
export function paymentReceiptReference(payment) {
  const suffix = String(payment.sourceId || payment.id || "").replaceAll(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase();
  return suffix ? `FORGE-${suffix}` : "Recorded in FORGE";
}
export function buildRentActivity(charges, payments, settlements) {
  const byPayment = new Map(settlements.map((item) => [item.payment_id, item]));
  return [...charges.map((item) => ({ ...item, id: `charge:${item.id}`, sourceId: item.id, kind: "charge" })),
    ...payments.map((item) => ({ ...item, id: `payment:${item.id}`, sourceId: item.id, kind: "payment", settlement: byPayment.get(item.id) || null }))];
}

export function resolveScheduleContext(schedule, data) {
  const leases = data.leases || [];
  const units = data.units || [];
  const tenants = data.tenants || [];
  const leaseMemberships = data.leaseMemberships || [];
  const lease = leases.find((item) => item.id === schedule.lease_id) || null;
  const unit = lease ? units.find((item) => item.id === lease.unit_id) || null : null;
  const tenantNames = lease
    ? leaseMemberships.filter((membership) => membership.lease_id === lease.id)
        .map((membership) => tenants.find((tenant) => tenant.id === membership.tenant_id)?.display_name)
        .filter(Boolean)
    : [];
  return Object.freeze({
    leaseId: schedule.lease_id || null,
    leaseStatus: lease?.status || null,
    tenantLabel: tenantNames.length ? tenantNames.join(", ") : "Unknown tenant",
    unitLabel: unit?.label || "Unknown unit",
    propertyLabel: unit?.property_id || lease?.property_id || "Unknown property",
  });
}

export function resolveChargeIdentity(charge, data) {
  return resolveScheduleContext({ lease_id: charge.lease_id }, data);
}

export function defaultChargeMonth(schedule, today = new Date()) {
  const currentPeriod = today.toISOString().slice(0, 7);
  const dueDay = String(schedule.due_day).padStart(2, "0");
  const effectiveStartDate = schedule.effective_start_date;
  if (!effectiveStartDate || `${currentPeriod}-${dueDay}` >= effectiveStartDate) return currentPeriod;
  const [year, month] = currentPeriod.split("-").map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
}

export function isChargeVoidable(charge) {
  return charge.status !== "void" && Number(charge.paid_amount_cents) === 0;
}

// "Landlord charge lists" containment: the schedule tied to a charge (by schedule_id) determines
// whether it is FORGE-collectible or still Rentec-authoritative — this must be visible on every
// charge row, never inferred from the charge's own status, which looks identical either way.
export function chargeCollectionLabel(charge, schedules, today = new Date().toISOString().slice(0, 10)) {
  const schedule = (schedules || []).find((item) => item.id === charge.schedule_id);
  return isChargeForgeCollectible(charge, schedule, today) ? "FORGE collectible" : "Externally managed — reconciliation required";
}

function BillingPauseBanner({ billingEnabled, busy, onSetBillingEnabled }) {
  const [showResumeConfirm, setShowResumeConfirm] = useState(false);
  if (billingEnabled) {
    return <div className="mb-6 rounded-2xl border border-emerald-300 bg-emerald-50 p-5">
      <p className="text-xs font-black uppercase tracking-wide text-emerald-700">Rental online billing: ACTIVE</p>
      <p className="mt-2 text-sm text-emerald-900">Individually FORGE-activated leases can generate charges, accept online rent payments, and run autopay.</p>
      <button type="button" disabled={busy} onClick={() => onSetBillingEnabled(false)}
        className="mt-3 rounded-xl border border-emerald-700 px-4 py-2 font-bold text-emerald-900 disabled:opacity-50">Pause FORGE billing</button>
    </div>;
  }
  return <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-5">
    <p className="text-xs font-black uppercase tracking-wide text-amber-800">Rental online billing: PAUSED</p>
    <p className="mt-2 text-sm text-amber-900">Tenants remain managed in Rentec until each lease is reconciled and moved to FORGE. While paused, FORGE will not generate charges, accept online rent payments, or run autopay.</p>
    {showResumeConfirm ? <div className="mt-4 rounded-xl border border-amber-400 bg-white p-4">
      <p className="text-sm font-bold text-slate-900">Resuming does not activate any lease by itself — only leases already individually cut over to FORGE will begin collecting. No lease is silently activated. Continue?</p>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" disabled={busy} onClick={() => { onSetBillingEnabled(true); setShowResumeConfirm(false); }} className="rounded-lg bg-slate-950 px-4 py-2 font-bold text-white disabled:opacity-50">Confirm resume</button>
        <button type="button" onClick={() => setShowResumeConfirm(false)} className="rounded-lg border px-4 py-2 font-bold">Cancel</button>
      </div>
    </div> : <button type="button" disabled={busy} onClick={() => setShowResumeConfirm(true)}
      className="mt-3 rounded-xl bg-slate-950 px-4 py-2 font-bold text-white disabled:opacity-50">Resume FORGE billing</button>}
  </div>;
}

const identity = (value) => value;
export default function RentalPaymentsPanel({ initialData = null, initialAccount, dataScope = identity, initialShowSetup = false }) {
  const [account, setAccount] = useState(initialAccount), [data, setData] = useState(initialData || { openCharges: [], payments: [], settlements: [], schedules: [], billingEnabled: false });
  const [selectedId, setSelectedId] = useState(""), [showOffline, setShowOffline] = useState(false), [showSetup, setShowSetup] = useState(initialShowSetup);
  const [message, setMessage] = useState(""), [saved, setSaved] = useState(""), [busy, setBusy] = useState(false);
  async function loadRentalData() { const response = await fetch("/api/rental"), body = await response.json(); if (!response.ok) throw new Error(body.error || "Unable to load rent collection data."); setData(dataScope(body)); }
  async function loadAccount() { const response = await fetch("/api/rental/stripe-account"), body = await response.json(); if (!response.ok) throw new Error(body.error); setAccount(body.account); }
  useEffect(() => { if (!initialData) loadRentalData().catch((error) => setMessage(error.message)); if (initialAccount === undefined) loadAccount().catch((error) => setMessage(error.message)); }, [initialData, initialAccount]);
  const records = useMemo(() => buildRentActivity(data.openCharges, data.payments, data.settlements), [data]);
  const activeId = records.some((item) => item.id === selectedId) ? selectedId : records[0]?.id || "";
  const selected = records.find((item) => item.id === activeId);
  async function connect() { setBusy(true); setMessage(""); try { const response = await fetch("/api/rental/stripe-account", { method: "POST" }), body = await response.json(); if (!response.ok) throw new Error(body.error); window.location.assign(body.url); } catch (error) { setMessage(error.message); setBusy(false); } }
  async function post(body, success) { setBusy(true); setMessage(""); setSaved(""); try { const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), result = await response.json(); if (!response.ok) throw new Error(result.error); setSaved(success(result)); await loadRentalData(); return true; } catch (error) { setMessage(error.message); return false; } finally { setBusy(false); } }
  async function recordOffline(event) { event.preventDefault(); const element = event.currentTarget, form = new FormData(element); const success = await post({ operation: "record-offline-payment", payment: { chargeId: form.get("chargeId"), paymentMethod: form.get("paymentMethod"), amountCents: Math.round(Number(form.get("amount")) * 100), receivedAt: new Date(`${form.get("receivedDate")}T12:00:00`).toISOString(), receiptReference: form.get("receiptReference"), notes: form.get("notes") } }, () => "Offline payment recorded and rent balance updated."); if (success) { element.reset(); setShowOffline(false); } }
  async function voidCharge(chargeId, reason) { return post({ operation: "void-charge", chargeId, reason }, () => "Charge voided."); }
  async function setBillingEnabled(nextEnabled) { return post({ operation: "set-billing-enabled", enabled: nextEnabled }, () => nextEnabled ? "Rental online billing resumed." : "Rental online billing paused."); }
  const enabled = account?.status === "enabled";
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <BillingPauseBanner billingEnabled={data.billingEnabled === true} busy={busy} onSetBillingEnabled={setBillingEnabled} />
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-bold uppercase tracking-widest text-amber-700">Rent collection</p><h2 className="mt-2 text-2xl font-black">Rent &amp; payments</h2><p className="mt-2 text-slate-600">Review charges and payment history, then act on the selected record.</p></div><div className="flex gap-2"><button type="button" onClick={() => setShowOffline((value) => !value)} className="rounded-xl bg-amber-500 px-4 py-2 font-black">{showOffline ? "Cancel offline payment" : "Record offline payment"}</button><button type="button" onClick={() => setShowSetup((value) => !value)} className="rounded-xl border px-4 py-2 font-bold">{showSetup ? "Hide billing setup" : "Billing setup"}</button></div></div>
    {message ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-800">{message}</p> : null}{saved ? <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-800">{saved}</p> : null}
    {showOffline ? <form aria-label="Record offline payment" onSubmit={recordOffline} className="mt-6 grid gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 md:grid-cols-2"><label className="text-sm font-bold md:col-span-2">Open rent charge<select name="chargeId" required className="mt-1 w-full rounded-xl border p-3 font-normal"><option value="">Select a charge</option>{data.openCharges.map((charge) => <option key={charge.id} value={charge.id}>{charge.period} · due {charge.due_date} · {money.format((Number(charge.amount_cents) - Number(charge.paid_amount_cents)) / 100)}</option>)}</select></label><label className="text-sm font-bold">Payment method<select name="paymentMethod" required className="mt-1 w-full rounded-xl border p-3 font-normal"><option value="cash">Cash</option><option value="cashiers_check">Cashier&apos;s check</option></select></label><label className="text-sm font-bold">Amount received<input name="amount" type="number" min="0.01" step="0.01" required className="mt-1 w-full rounded-xl border p-3 font-normal" /></label><label className="text-sm font-bold">Date received<input name="receivedDate" type="date" required className="mt-1 w-full rounded-xl border p-3 font-normal" /></label><label className="text-sm font-bold">Receipt or check number<input name="receiptReference" className="mt-1 w-full rounded-xl border p-3 font-normal" /></label><label className="text-sm font-bold md:col-span-2">Notes<input name="notes" className="mt-1 w-full rounded-xl border p-3 font-normal" /></label><button disabled={busy || data.openCharges.length === 0} className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:opacity-50 md:col-span-2">{busy ? "Saving…" : "Record received payment"}</button></form> : null}
    {showSetup ? <div className="mt-6 rounded-2xl border bg-slate-50 p-5"><h3 className="text-lg font-black">Billing setup</h3><p className="mt-2 font-bold">Stripe: {account === undefined ? "checking…" : label(account?.status || "not connected")}</p>{account?.requirements_due?.length ? <p className="mt-1 text-sm text-amber-800">Stripe still requires {account.requirements_due.length} item(s).</p> : null}<button onClick={connect} disabled={busy || enabled} className="mt-3 rounded-xl bg-slate-950 px-4 py-2 font-bold text-white disabled:opacity-50">{enabled ? "Stripe ready" : account ? "Continue Stripe setup" : "Connect Stripe"}</button><button onClick={() => loadAccount().catch((error) => setMessage(error.message))} className="ml-2 mt-3 rounded-xl border px-4 py-2 font-bold">Refresh status</button><div className="mt-5 border-t pt-4"><h4 className="font-black">Lease activation and charge generation</h4><p className="mt-1 text-sm text-slate-600">Activation starts billing. Monthly charge generation is idempotent.</p>{data.schedules.length === 0 ? <p className="mt-2 text-sm text-slate-500">No saved rent schedule is available.</p> : data.schedules.map((schedule) => { const context = resolveScheduleContext(schedule, data); return <div key={schedule.id} className="mt-3 rounded-xl border bg-white p-4"><p className="font-black text-slate-950">{context.tenantLabel} · {context.unitLabel} · {context.propertyLabel}</p><p className="mt-1 font-bold">{money.format(Number(schedule.amount_cents) / 100)} monthly · due day {schedule.due_day} · lease {context.leaseStatus ? label(context.leaseStatus) : "unknown"} · schedule {label(schedule.status)}</p>{schedule.status === "draft" ? <button type="button" disabled={busy} onClick={() => post({ operation: "activate-lease-schedule", scheduleId: schedule.id }, () => "Lease and rent schedule activated.")} className="mt-3 rounded-xl bg-slate-950 px-4 py-2 font-bold text-white">Activate lease and schedule</button> : null}{schedule.status === "active" ? <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); post({ operation: "generate-charge", scheduleId: schedule.id, period: form.get("period") }, (body) => `Rent charge ready for ${body.charge.period}.`); }} className="mt-3 flex items-end gap-3"><label className="text-sm font-bold">Charge month<input name="period" type="month" required defaultValue={defaultChargeMonth(schedule)} className="mt-1 block rounded-xl border p-2 font-normal" /></label><button disabled={busy} className="rounded-xl bg-amber-500 px-4 py-2 font-black">Generate monthly charge</button></form> : null}</div>; })}</div></div> : null}
    <RentalRecordBrowser title="Charges and payments" records={records} selectedId={activeId} onSelect={setSelectedId}
      getTitle={(item) => { if (item.kind !== "charge") return `${money.format(Number(item.amount_cents) / 100)} payment`; const identity = resolveChargeIdentity(item, data); return `${identity.tenantLabel} · ${identity.unitLabel} · ${identity.propertyLabel}`; }}
      getSubtitle={(item) => { if (item.kind !== "charge") return `${label(item.payment_method || item.provider)} · ${label(item.status)}`; const identity = resolveChargeIdentity(item, data); return `${label(item.charge_type)} · ${item.period} · ${money.format(Number(item.amount_cents) / 100)} · ${label(item.status)} · due ${item.due_date} · lease ${identity.leaseId || "Unknown"} · ${chargeCollectionLabel(item, data.schedules)}`; }}
      emptyMessage="No rent charges or payments recorded.">
      {!selected ? <p className="text-sm text-slate-500">Select a charge or payment to review its details.</p> : <RecordDetail record={selected} chargeIdentity={selected.kind === "charge" ? resolveChargeIdentity(selected, data) : null} collectionLabel={selected.kind === "charge" ? chargeCollectionLabel(selected, data.schedules) : null} onRecordPayment={() => setShowOffline(true)} onVoidCharge={voidCharge} />}
    </RentalRecordBrowser><a href="/forge/rental/portal" className="mt-6 inline-block font-bold text-amber-800 underline">Open tenant portal</a>
  </section>;
}

function RecordDetail({ record, chargeIdentity, collectionLabel, onRecordPayment, onVoidCharge }) {
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  if (record.kind === "charge") return <div><p className="text-xs font-bold uppercase tracking-widest text-slate-500">Selected charge</p><h3 className="mt-2 text-xl font-black">{record.period} rent</h3><dl className="mt-5 grid gap-4 sm:grid-cols-2"><Fact term="Tenant" value={chargeIdentity.tenantLabel} /><Fact term="Unit" value={chargeIdentity.unitLabel} /><Fact term="Property" value={chargeIdentity.propertyLabel} /><Fact term="Status" value={label(record.status)} /><Fact term="Collection" value={collectionLabel} /><Fact term="Due date" value={record.due_date} /><Fact term="Original amount" value={money.format(Number(record.amount_cents) / 100)} /><Fact term="Paid amount" value={money.format(Number(record.paid_amount_cents) / 100)} /><Fact term="Balance" value={money.format((Number(record.amount_cents) - Number(record.paid_amount_cents)) / 100)} /><Fact term="Charge type" value={label(record.charge_type)} /><Fact term="Lease ID" value={chargeIdentity.leaseId || "Unknown"} /></dl><button type="button" onClick={onRecordPayment} className="mt-6 rounded-xl bg-amber-500 px-4 py-2 font-black">Record payment for an open charge</button>
    {isChargeVoidable(record) ? (showVoidConfirm ? <form aria-label="Void charge" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const success = await onVoidCharge(record.sourceId, form.get("reason")); if (success) setShowVoidConfirm(false); }} className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4">
      <label className="text-sm font-bold">Reason for voiding<input name="reason" required className="mt-1 w-full rounded-lg border p-2 font-normal" /></label>
      <label className="mt-3 flex items-center gap-2 text-sm font-bold"><input type="checkbox" name="confirmed" required /> I confirm I want to void this charge. This preserves it as history but makes it non-payable.</label>
      <div className="mt-3 flex items-center gap-3"><button type="submit" className="rounded-lg bg-red-700 px-4 py-2 font-bold text-white">Confirm void</button><button type="button" onClick={() => setShowVoidConfirm(false)} className="rounded-lg border px-4 py-2 font-bold">Cancel</button></div>
    </form> : <button type="button" onClick={() => setShowVoidConfirm(true)} className="ml-2 mt-6 rounded-xl border border-red-300 px-4 py-2 font-bold text-red-700">Void charge</button>) : null}
  </div>;
  const timestamp = paymentDisplayTimestamp(record);
  return <div><p className="text-xs font-bold uppercase tracking-widest text-slate-500">Selected payment</p><h3 className="mt-2 text-xl font-black">{money.format(Number(record.amount_cents) / 100)} payment</h3><dl className="mt-5 grid gap-4 sm:grid-cols-2"><Fact term="Status" value={label(record.status)} /><Fact term="Method" value={label(record.payment_method || record.provider)} /><Fact term="Received" value={timestamp ? new Date(timestamp).toLocaleDateString() : "—"} /><Fact term="Refunded" value={money.format(Number(record.refunded_amount_cents || 0) / 100)} /><Fact term="Receipt" value={paymentReceiptReference(record)} /><Fact term="Settlement" value={record.provider === "stripe" ? label(record.settlement?.status || "awaiting settlement") : "Not applicable"} /></dl></div>;
}
function Fact({ term, value }) { return <div><dt className="text-xs font-bold uppercase text-slate-500">{term}</dt><dd className="mt-1 font-bold capitalize">{value}</dd></div>; }
