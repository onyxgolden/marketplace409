"use client";
import { useState } from "react";

export default function RentalLeasePanel() {
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  async function save(event) {
    event.preventDefault(); setWorking(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const leaseResponse = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-lease", lease: { propertyId: form.get("propertyId"), unitId: form.get("unitId"),
          tenantIds: [form.get("tenantId")], status: "draft", startDate: form.get("startDate"), endDate: form.get("endDate") || null,
          monthlyRentCents: Math.round(Number(form.get("monthlyRent")) * 100), currencyCode: "USD",
          rentDueDay: Number(form.get("dueDay")), notes: form.get("notes") || null } }) });
      const leaseResult = await leaseResponse.json();
      if (!leaseResponse.ok) throw new Error(leaseResult.error || "Unable to save lease.");
      const scheduleResponse = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-schedule", schedule: { leaseId: leaseResult.lease.id, status: "draft",
          amountCents: leaseResult.lease.monthlyRentCents, currencyCode: "USD", dueDay: leaseResult.lease.rentDueDay,
          effectiveStartDate: leaseResult.lease.startDate, effectiveEndDate: leaseResult.lease.endDate } }) });
      const scheduleResult = await scheduleResponse.json();
      if (!scheduleResponse.ok) throw new Error(scheduleResult.error || "Lease saved, but its rent schedule could not be saved.");
      setMessage(`Lease saved: ${leaseResult.lease.id} — Schedule: ${scheduleResult.schedule.id}`);
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-rental-lease-setup>
    <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">Lease setup</p>
    <h2 className="mt-2 text-2xl font-black">Record lease and rent schedule</h2>
    <p className="mt-2 text-sm text-slate-600">Use the Unit and Tenant IDs returned by the earlier steps. The schedule remains draft until the signed lease is ready.</p>
    <form onSubmit={save} className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <label className="text-sm font-bold">Property ID<input name="propertyId" defaultValue="4800-kent-ave" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold">Unit ID<input name="unitId" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold">Tenant ID<input name="tenantId" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold">Start date<input name="startDate" type="date" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold">End date<input name="endDate" type="date" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold">Monthly rent<input name="monthlyRent" type="number" min="0.01" step="0.01" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold">Due day<input name="dueDay" type="number" min="1" max="28" defaultValue="1" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold xl:col-span-2">Notes<input name="notes" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <div className="md:col-span-2 xl:col-span-3 flex items-center gap-4"><button disabled={working} className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:opacity-50">{working ? "Saving…" : "Save draft lease and schedule"}</button>
        {message && <p role="status" className="text-sm font-bold text-slate-700">{message}</p>}</div>
    </form>
  </section>;
}
