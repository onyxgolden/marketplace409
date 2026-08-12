"use client";
import { useState } from "react";

async function submit(operation, key, value) {
  const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, [key]: value }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Rental Manager operation failed.");
  return result;
}

export default function RentalSetupPanel() {
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  async function saveUnit(event) {
    event.preventDefault(); setWorking(true); setMessage("");
    const values = new FormData(event.currentTarget);
    try {
      const result = await submit("save-unit", "unit", { propertyId: values.get("propertyId"), label: values.get("label"),
        status: "preparing", bedrooms: Number(values.get("bedrooms")) || null, bathrooms: Number(values.get("bathrooms")) || null,
        squareFeet: Number(values.get("squareFeet")) || null, notes: values.get("notes") || null });
      setMessage(`Unit saved: ${result.unit.label} — ID: ${result.unit.id}`);
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-rental-setup>
      <div className="max-w-3xl"><p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">Kent Avenue setup</p>
        <h2 className="mt-2 text-2xl font-black">Create the rental unit</h2>
        <p className="mt-2 text-sm text-slate-600">This is the first owner workflow. Tenant and lease setup unlock after the unit is persisted.</p></div>
      <form className="mt-6 grid max-w-4xl gap-4 md:grid-cols-2" onSubmit={saveUnit}>
        <label className="text-sm font-bold">Property ID<input name="propertyId" defaultValue="4800-kent-ave" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
        <label className="text-sm font-bold">Unit label<input name="label" defaultValue="Main residence" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
        <label className="text-sm font-bold">Bedrooms<input name="bedrooms" type="number" min="0" step="1" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
        <label className="text-sm font-bold">Bathrooms<input name="bathrooms" type="number" min="0" step="0.5" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
        <label className="text-sm font-bold">Square feet<input name="squareFeet" type="number" min="0" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
        <label className="text-sm font-bold">Notes<input name="notes" defaultValue="Remodel in progress." className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
        <div className="md:col-span-2 flex items-center gap-4"><button disabled={working} className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:opacity-50">{working ? "Saving…" : "Save Kent Avenue unit"}</button>
          {message && <p role="status" className="text-sm font-bold text-slate-700">{message}</p>}</div>
      </form>
    </section>
  );
}
