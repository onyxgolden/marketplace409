"use client";
import { useState } from "react";

export default function RentalTenantPanel() {
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  async function save(event) {
    event.preventDefault(); setWorking(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-tenant", tenant: { displayName: form.get("displayName"),
          email: form.get("email"), phone: form.get("phone") || null, status: "invited" } }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save tenant.");
      setMessage(`Tenant saved: ${result.tenant.displayName} — ID: ${result.tenant.id}`);
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-rental-tenant-setup>
    <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">Tenant setup</p>
    <h2 className="mt-2 text-2xl font-black">Create the Kent Avenue tenant</h2>
    <p className="mt-2 text-sm text-slate-600">This creates the private tenant record. Portal access remains inactive until an authenticated account is linked.</p>
    <form onSubmit={save} className="mt-6 grid max-w-4xl gap-4 md:grid-cols-2">
      <label className="text-sm font-bold">Tenant name<input name="displayName" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold">Email<input name="email" type="email" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold">Phone<input name="phone" type="tel" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <div className="flex items-end"><button disabled={working} className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:opacity-50">{working ? "Saving…" : "Save tenant"}</button></div>
      {message && <p role="status" className="md:col-span-2 text-sm font-bold text-slate-700">{message}</p>}
    </form>
  </section>;
}
