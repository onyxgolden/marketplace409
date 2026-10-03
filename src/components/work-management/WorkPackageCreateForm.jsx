"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WP_PACKAGE_TYPES, WP_PRIORITIES } from "@/domains/work-management/workPackage.js";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const label = "block text-xs font-medium text-slate-600 mb-1";

export default function WorkPackageCreateForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "", description: "", package_type: "other", priority: "normal",
    planned_start: "", planned_finish: "",
    responsible_party: "", // display name; the full party record lives in Rung 2
    equipment_tag: "", unit: "", area: "", system: "",
    work_order_ref: "", workscope_code: "",
  });

  function set(key) {
    return (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const response = await fetch("/api/work-packages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: form.title, description: form.description || null,
        package_type: form.package_type, priority: form.priority,
        planned_start: form.planned_start || null, planned_finish: form.planned_finish || null,
        responsible_party: form.responsible_party
          ? { domain: "contractor", type: "contractor", display_name: form.responsible_party }
          : null,
        equipment_tag: form.equipment_tag || null, unit: form.unit || null,
        area: form.area || null, system: form.system || null,
        work_order_ref: form.work_order_ref || null, workscope_code: form.workscope_code || null,
      }),
    });
    const body = await response.json();
    setSaving(false);
    if (!response.ok) {
      setError(body.error || "Unable to create the package.");
      return;
    }
    router.push(`/forge/work/${body.package.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-6">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Package</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={label} htmlFor="title">Title *</label>
            <input id="title" className={input} value={form.title} onChange={set("title")} required />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="description">Scope description</label>
            <textarea id="description" className={input} rows={3} value={form.description} onChange={set("description")} />
          </div>
          <div>
            <label className={label} htmlFor="package_type">Type</label>
            <select id="package_type" className={input} value={form.package_type} onChange={set("package_type")}>
              {WP_PACKAGE_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="priority">Priority</label>
            <select id="priority" className={input} value={form.priority} onChange={set("priority")}>
              {WP_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="planned_start">Planned start</label>
            <input id="planned_start" type="date" className={input} value={form.planned_start} onChange={set("planned_start")} />
          </div>
          <div>
            <label className={label} htmlFor="planned_finish">Planned finish</label>
            <input id="planned_finish" type="date" className={input} value={form.planned_finish} onChange={set("planned_finish")} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="responsible_party">Responsible party</label>
            <input id="responsible_party" className={input} placeholder="Crew or contractor name" value={form.responsible_party} onChange={set("responsible_party")} />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Industrial identity (optional)</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="equipment_tag">Equipment tag</label>
            <input id="equipment_tag" className={input} value={form.equipment_tag} onChange={set("equipment_tag")} />
          </div>
          <div>
            <label className={label} htmlFor="work_order_ref">Work order ref</label>
            <input id="work_order_ref" className={input} value={form.work_order_ref} onChange={set("work_order_ref")} />
          </div>
          <div>
            <label className={label} htmlFor="unit">Unit</label>
            <input id="unit" className={input} value={form.unit} onChange={set("unit")} />
          </div>
          <div>
            <label className={label} htmlFor="area">Area</label>
            <input id="area" className={input} value={form.area} onChange={set("area")} />
          </div>
          <div>
            <label className={label} htmlFor="system">System</label>
            <input id="system" className={input} value={form.system} onChange={set("system")} />
          </div>
          <div>
            <label className={label} htmlFor="workscope_code">Workscope code</label>
            <input id="workscope_code" className={input} value={form.workscope_code} onChange={set("workscope_code")} />
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="submit" disabled={saving}
          className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create package"}
        </button>
      </div>
    </form>
  );
}
