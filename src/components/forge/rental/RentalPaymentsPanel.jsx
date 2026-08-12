"use client";
import { useEffect, useState } from "react";
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default function RentalPaymentsPanel() {
  const [account, setAccount] = useState(undefined); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [charges, setCharges] = useState([]); const [schedules, setSchedules] = useState([]); const [saved, setSaved] = useState("");
  async function loadRentalData() { const response = await fetch("/api/rental"); const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Unable to load rent collection data.");
    setCharges(body.openCharges || []); setSchedules(body.schedules || []); }
  async function load() { try { const response = await fetch("/api/rental/stripe-account"); const body = await response.json();
    if (!response.ok) throw new Error(body.error); setAccount(body.account); } catch (error) { setMessage(error.message); } }
  useEffect(() => { fetch("/api/rental/stripe-account").then(async (response) => {
    const body = await response.json(); if (!response.ok) throw new Error(body.error); return body.account;
  }).then(setAccount).catch((error) => setMessage(error.message));
    fetch("/api/rental").then(async (response) => { const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load rent collection data."); return body;
    }).then((body) => { setCharges(body.openCharges || []); setSchedules(body.schedules || []); })
      .catch((error) => setMessage(error.message)); }, []);
  async function connect() { setBusy(true); setMessage(""); try { const response = await fetch("/api/rental/stripe-account", { method: "POST" });
    const body = await response.json(); if (!response.ok) throw new Error(body.error); window.location.assign(body.url);
  } catch (error) { setMessage(error.message); setBusy(false); } }
  async function recordOffline(event) {
    event.preventDefault(); const formElement = event.currentTarget; setBusy(true); setMessage(""); setSaved(""); const form = new FormData(formElement);
    try { const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "record-offline-payment", payment: { chargeId: form.get("chargeId"),
        paymentMethod: form.get("paymentMethod"), amountCents: Math.round(Number(form.get("amount")) * 100),
        receivedAt: new Date(`${form.get("receivedDate")}T12:00:00`).toISOString(),
        receiptReference: form.get("receiptReference"), notes: form.get("notes") } }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error); setSaved("Offline payment recorded and rent balance updated.");
      formElement.reset(); const refreshed = await fetch("/api/rental").then((item) => item.json()); setCharges(refreshed.openCharges || []);
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  async function activateSchedule(scheduleId) { setBusy(true); setMessage(""); setSaved(""); try {
    const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "activate-lease-schedule", scheduleId }) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error);
    setSaved("Lease and rent schedule activated. First-charge generation is now available."); await loadRentalData();
  } catch (error) { setMessage(error.message); } finally { setBusy(false); } }
  async function generateCharge(event) { event.preventDefault(); setBusy(true); setMessage(""); setSaved("");
    const form = new FormData(event.currentTarget); try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "generate-charge", scheduleId: form.get("scheduleId"), period: form.get("period") }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      setSaved(`Rent charge ready for ${body.charge.period}. Repeating this action will reuse the same charge.`); await loadRentalData();
    } catch (error) { setMessage(error.message); } finally { setBusy(false); } }
  const enabled = account?.status === "enabled";
  return <section className="rounded-2xl border border-slate-200 bg-white p-7">
    <p className="text-sm font-bold uppercase tracking-widest text-amber-700">Rent collection</p>
    <h2 className="mt-2 text-2xl font-black text-slate-950">Stripe payment account</h2>
    <p className="mt-2 max-w-2xl text-slate-600">Connect the landlord account before inviting the Kent Avenue tenant to pay. Stripe handles identity verification and bank details.</p>
    <div className="mt-6 rounded-xl border bg-slate-50 p-5">
      <p className="font-bold">Status: {account === undefined ? "checking…" : account?.status?.replaceAll("_", " ") || "not connected"}</p>
      {account?.requirements_due?.length ? <p className="mt-2 text-sm text-amber-800">Stripe still requires {account.requirements_due.length} item(s).</p> : null}
      <button onClick={connect} disabled={busy || enabled} className="mt-4 rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:opacity-50">
        {enabled ? "Stripe ready" : busy ? "Opening Stripe…" : account ? "Continue Stripe setup" : "Connect Stripe"}
      </button>
      <button onClick={load} className="ml-3 mt-4 rounded-xl border px-5 py-3 font-bold text-slate-700">Refresh status</button>
    </div>
    {message ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-800">{message}</p> : null}
    <div className="mt-8 border-t pt-7"><h3 className="text-xl font-black">Activate lease and create first charge</h3>
      <p className="mt-1 text-sm text-slate-600">Activation starts billing. Use it only after the lease terms are approved. Monthly charge generation is idempotent.</p>
      {schedules.length === 0 ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">No saved rent schedule is available.</p> :
        <div className="mt-4 space-y-3">{schedules.map((schedule) => <div key={schedule.id} className="rounded-xl border bg-slate-50 p-4">
          <p className="font-bold">{money.format(Number(schedule.amount_cents) / 100)} monthly · due day {schedule.due_day} · Status: {schedule.status}</p>
          <p className="mt-1 text-xs text-slate-600">Effective {schedule.effective_start_date}{schedule.effective_end_date ? ` through ${schedule.effective_end_date}` : ""}</p>
          {schedule.status === "draft" ? <button type="button" disabled={busy} onClick={() => activateSchedule(schedule.id)}
            className="mt-3 rounded-xl bg-slate-950 px-4 py-2 font-bold text-white disabled:opacity-50">Activate lease and schedule</button> : null}
          {schedule.status === "active" ? <form onSubmit={generateCharge} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="scheduleId" value={schedule.id} /><label className="text-sm font-bold">Charge month
              <input name="period" type="month" required defaultValue={new Date().toISOString().slice(0, 7)} className="mt-1 block rounded-xl border p-2 font-normal" /></label>
            <button disabled={busy} className="rounded-xl bg-amber-500 px-4 py-2 font-black text-slate-950 disabled:opacity-50">Generate monthly charge</button>
          </form> : null}
        </div>)}</div>}
    </div>
    <div className="mt-8 border-t pt-7"><h3 className="text-xl font-black">Record an offline payment</h3>
      <p className="mt-1 text-sm text-slate-600">Use only after cash or a cashier’s check has actually been received.</p>
      <form onSubmit={recordOffline} className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="text-sm font-bold md:col-span-2">Open rent charge<select name="chargeId" required className="mt-1 w-full rounded-xl border p-3 font-normal">
          <option value="">Select a charge</option>{charges.map((charge) => <option key={charge.id} value={charge.id}>{charge.period} · due {charge.due_date} · {money.format((Number(charge.amount_cents) - Number(charge.paid_amount_cents)) / 100)}</option>)}</select></label>
        <label className="text-sm font-bold">Payment method<select name="paymentMethod" required className="mt-1 w-full rounded-xl border p-3 font-normal"><option value="cash">Cash</option><option value="cashiers_check">Cashier&apos;s check</option></select></label>
        <label className="text-sm font-bold">Amount received<input name="amount" type="number" min="0.01" step="0.01" required className="mt-1 w-full rounded-xl border p-3 font-normal" /></label>
        <label className="text-sm font-bold">Date received<input name="receivedDate" type="date" required className="mt-1 w-full rounded-xl border p-3 font-normal" /></label>
        <label className="text-sm font-bold">Receipt or check number<input name="receiptReference" className="mt-1 w-full rounded-xl border p-3 font-normal" /></label>
        <label className="text-sm font-bold md:col-span-2">Notes<input name="notes" className="mt-1 w-full rounded-xl border p-3 font-normal" /></label>
        <button disabled={busy || charges.length === 0} className="rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950 disabled:opacity-50 md:col-span-2">{busy ? "Saving…" : "Record received payment"}</button>
      </form>{saved ? <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-800">{saved}</p> : null}
    </div>
    <a href="/forge/rental/portal" className="mt-6 inline-block font-bold text-amber-800 underline">Open tenant portal</a>
  </section>;
}
