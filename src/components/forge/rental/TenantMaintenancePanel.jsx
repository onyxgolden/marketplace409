"use client";
import { useState } from "react";

const statusLabel = (value) => value.replaceAll("_", " ");
export default function TenantMaintenancePanel({ rentals, onSubmitted }) {
  const eligible = rentals.filter(({ lease }) => lease.status === "active");
  const [error, setError] = useState(""); const [message, setMessage] = useState("");
  async function submit(event) {
    event.preventDefault(); setError(""); setMessage(""); const form = new FormData(event.currentTarget);
    try { const response = await fetch("/api/rental/portal", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "submit-maintenance-request", leaseId: form.get("leaseId"), title: form.get("title"),
        description: form.get("description"), priority: form.get("priority"), permissionToEnter: form.get("permissionToEnter") === "on",
        contactPhone: form.get("contactPhone") }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error); event.currentTarget.reset();
      setMessage("Maintenance request submitted. Your landlord can now review it."); await onSubmitted?.();
    } catch (reason) { setError(reason.message); }
  }
  const requests = rentals.flatMap((rental) => (rental.maintenanceRequests || []).map((request) => ({ ...request, unit: rental.unit })));
  return <section className="rounded-2xl border bg-white p-6 shadow-sm">
    <p className="text-sm font-bold uppercase tracking-widest text-amber-700">Maintenance</p><h2 className="mt-2 text-xl font-black">Report an issue</h2>
    <p className="mt-2 text-sm text-slate-600">For fire, gas odor, flooding, or immediate danger, call 911 or the appropriate emergency service first.</p>
    {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-800">{error}</p> : null}
    {message ? <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-800">{message}</p> : null}
    {eligible.length ? <form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-2">
      <label className="text-sm font-bold">Rental<select name="leaseId" required className="mt-1 w-full rounded-lg border p-3 font-normal">{eligible.map(({ lease, unit }) => <option key={lease.id} value={lease.id}>{unit?.label || "Rental home"}</option>)}</select></label>
      <label className="text-sm font-bold">Priority<select name="priority" defaultValue="routine" className="mt-1 w-full rounded-lg border p-3 font-normal"><option value="routine">Routine</option><option value="soon">Needs attention soon</option><option value="urgent">Urgent</option><option value="emergency">Emergency follow-up</option></select></label>
      <label className="text-sm font-bold md:col-span-2">Short title<input name="title" required maxLength={120} className="mt-1 w-full rounded-lg border p-3 font-normal" placeholder="Example: Kitchen sink is leaking" /></label>
      <label className="text-sm font-bold md:col-span-2">What is happening?<textarea name="description" required rows={4} className="mt-1 w-full rounded-lg border p-3 font-normal" placeholder="Describe the issue, location, when it started, and anything already tried." /></label>
      <label className="text-sm font-bold">Best contact phone<input name="contactPhone" className="mt-1 w-full rounded-lg border p-3 font-normal" /></label>
      <label className="flex items-center gap-3 self-end rounded-lg bg-slate-50 p-3 text-sm font-bold"><input name="permissionToEnter" type="checkbox" /> Landlord or approved vendor may enter</label>
      <button className="rounded-lg bg-slate-950 px-5 py-3 font-bold text-white md:col-span-2">Submit maintenance request</button>
    </form> : <p className="mt-4 text-sm text-slate-600">An active lease is required before submitting a request.</p>}
    <div className="mt-7 border-t pt-6"><h3 className="font-black">Your requests</h3>{requests.length === 0 ? <p className="mt-2 text-sm text-slate-500">No maintenance requests submitted.</p> : requests.map((request) => <article key={request.id} className="mt-3 rounded-xl border p-4"><div className="flex justify-between gap-4"><strong>{request.title}</strong><span className="text-sm font-bold capitalize">{statusLabel(request.status)}</span></div><p className="mt-2 text-sm text-slate-600">{request.description}</p>{request.ownerNotes ? <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900"><strong>Landlord update:</strong> {request.ownerNotes}</p> : null}</article>)}</div>
  </section>;
}
