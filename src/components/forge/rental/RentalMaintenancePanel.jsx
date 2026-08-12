"use client";
import { useCallback, useEffect, useState } from "react";

const labels = { submitted: "Submitted", reviewing: "Reviewing", scheduled: "Scheduled",
  in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" };
const priorityStyle = { emergency: "bg-red-100 text-red-900", urgent: "bg-orange-100 text-orange-900",
  soon: "bg-amber-100 text-amber-900", routine: "bg-slate-100 text-slate-700" };

export default function RentalMaintenancePanel() {
  const [requests, setRequests] = useState([]); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const load = useCallback(() => fetch("/api/rental").then(async (response) => {
    const body = await response.json(); if (!response.ok) throw new Error(body.error); return body.maintenanceRequests || [];
  }).then(setRequests), []);
  useEffect(() => { load().catch((reason) => setError(reason.message)); }, [load]);
  async function update(event, requestId) {
    event.preventDefault(); setError(""); setMessage(""); const form = new FormData(event.currentTarget);
    try { const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "update-maintenance-request", requestId, status: form.get("status"), ownerNotes: form.get("ownerNotes") }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error); await load(); setMessage("Maintenance request updated.");
    } catch (reason) { setError(reason.message); }
  }
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <p className="text-sm font-bold uppercase tracking-widest text-amber-700">Maintenance operations</p>
    <h2 className="mt-2 text-2xl font-black">Tenant requests</h2>
    <p className="mt-2 text-slate-600">Review tenant-reported issues, record internal notes, and move each request through a visible status.</p>
    {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-800">{error}</p> : null}
    {message ? <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-800">{message}</p> : null}
    <div className="mt-6 space-y-4">{requests.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-slate-600">No maintenance requests have been submitted.</p> : requests.map((request) =>
      <article key={request.id} className="rounded-xl border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-black">{request.title}</h3>
          <p className="mt-1 text-sm text-slate-500">Submitted {new Date(request.submitted_at).toLocaleString()}</p></div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${priorityStyle[request.priority]}`}>{request.priority}</span></div>
        <p className="mt-4 whitespace-pre-wrap text-slate-800">{request.description}</p>
        <p className="mt-3 text-sm text-slate-600">Permission to enter: <strong>{request.permission_to_enter ? "Yes" : "No"}</strong>{request.contact_phone ? ` · Contact ${request.contact_phone}` : ""}</p>
        <form className="mt-5 grid gap-3 md:grid-cols-[220px_1fr_auto]" onSubmit={(event) => update(event, request.id)}>
          <label className="text-sm font-bold">Status<select name="status" defaultValue={request.status} className="mt-1 w-full rounded-lg border p-2 font-normal">
            {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-sm font-bold">Owner notes<input name="ownerNotes" defaultValue={request.owner_notes || ""} className="mt-1 w-full rounded-lg border p-2 font-normal" /></label>
          <button className="self-end rounded-lg bg-slate-950 px-4 py-2 font-bold text-white">Save update</button>
        </form>
      </article>)}</div>
    <p className="mt-5 text-sm text-slate-500">Photo evidence, vendor assignment, scheduling dates, and outbound vendor messages are the next maintenance expansion.</p>
  </section>;
}
