"use client";
import { useEffect, useState } from "react";

export default function RentalTenantPanel() {
  const [message, setMessage] = useState("");
  const [tenants, setTenants] = useState([]);
  const [working, setWorking] = useState(false);
  async function loadTenants() {
    const response = await fetch("/api/rental");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load tenants.");
    setTenants(result.tenants || []);
  }
  useEffect(() => {
    fetch("/api/rental").then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load tenants.");
      return result.tenants || [];
    }).then(setTenants).catch((error) => setMessage(error.message));
  }, []);
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
      event.currentTarget.reset();
      await loadTenants();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  async function updateEmail(event, tenantId) {
    event.preventDefault(); setWorking(true); setMessage(""); const form = new FormData(event.currentTarget);
    try { const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "update-tenant-email", tenantId, email: form.get("portalEmail") }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to update tenant email.");
      setMessage(`Portal email updated for ${result.tenant.display_name}.`); await loadTenants();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-rental-tenant-setup>
    <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">Tenant setup</p>
    <h2 className="mt-2 text-2xl font-black">Create the Kent Avenue tenant</h2>
    <p className="mt-2 text-sm text-slate-600">This creates the private tenant record. Portal access remains inactive until an authenticated account is linked.</p>
    {tenants.length > 0 && <div className="mt-5 rounded-xl border border-emerald-300 bg-emerald-50 p-4">
      <p className="text-sm font-black text-emerald-950">Saved tenants</p>
      <ul className="mt-2 space-y-3 text-sm text-emerald-950">{tenants.map((tenant) =>
        <li key={tenant.id}><div><strong>{tenant.display_name}</strong> · {tenant.email} · ID: <code>{tenant.id}</code></div>
          <form onSubmit={(event) => updateEmail(event, tenant.id)} className="mt-2 flex flex-wrap gap-2">
            <input name="portalEmail" type="email" required defaultValue={tenant.email}
              className="min-w-72 rounded-lg border border-emerald-300 bg-white px-3 py-2" aria-label={`Portal email for ${tenant.display_name}`} />
            <button disabled={working} className="rounded-lg bg-emerald-900 px-3 py-2 font-bold text-white disabled:opacity-50">Update portal email</button>
          </form></li>)}</ul>
      <a href="/auth?next=/forge/rental/portal" className="mt-4 inline-block font-bold text-emerald-900 underline">Open tenant sign-in</a>
    </div>}
    <form onSubmit={save} className="mt-6 grid max-w-4xl gap-4 md:grid-cols-2">
      <label className="text-sm font-bold">Tenant name<input name="displayName" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold">Email<input name="email" type="email" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold">Phone<input name="phone" type="tel" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <div className="flex items-end"><button disabled={working} className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:opacity-50">{working ? "Saving…" : "Save tenant"}</button></div>
      {message && <p role="status" className="md:col-span-2 text-sm font-bold text-slate-700">{message}</p>}
    </form>
  </section>;
}
