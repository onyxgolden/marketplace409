"use client";
import { useEffect, useState } from "react";

const RESOURCE_TYPES = ["labor", "nonlabor", "material"];

function emptyDraft() {
  return { name: "", resourceType: "labor", unitOfMeasure: "", maxUnitsPerDay: "8", stdRate: "0" };
}

// The owner-global resource dictionary (see the SCHED-05 migration -- schedule_resources has no
// schedule_project_id) -- opened from any project's board, but what it manages is shared across all
// of this owner's projects, same mental model as a P6 enterprise resource pool. onChanged fires
// after any create/update/delete so the board's own resources list (used by the per-block
// assignment picker in the drawer) can refetch.
export default function SchedulingResourcesModal({ isOwner, onClose, onChanged }) {
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(emptyDraft());
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");

  async function loadResources() {
    setLoading(true);
    const response = await fetch("/api/forge/scheduling/resources");
    const result = await response.json().catch(() => ({}));
    setResources(result.resources || []);
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadResources(); }, []);

  async function handleCreate() {
    const name = draft.name.trim();
    if (!name) return;
    setCreating(true); setMessage("");
    const response = await fetch("/api/forge/scheduling/resources", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, resourceType: draft.resourceType, unitOfMeasure: draft.unitOfMeasure, maxUnitsPerDay: draft.maxUnitsPerDay, stdRate: draft.stdRate }),
    });
    const result = await response.json().catch(() => ({}));
    setCreating(false);
    if (!response.ok) { setMessage(result.error || "Unable to create this resource."); return; }
    setDraft(emptyDraft());
    setMessage("Resource added.");
    await loadResources();
    onChanged?.();
  }

  async function handleToggleActive(resource) {
    await fetch(`/api/forge/scheduling/resources/${resource.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isActive: !resource.is_active }),
    });
    await loadResources();
    onChanged?.();
  }

  async function handleDelete(resource) {
    const response = await fetch(`/api/forge/scheduling/resources/${resource.id}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(result.error || "Unable to delete this resource."); return; }
    await loadResources();
    onChanged?.();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose} data-scheduling-resources>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 text-slate-950 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-amber-700">Scheduling</p>
            <h2 className="mt-1 text-xl font-black">Resources</h2>
            <p className="mt-1 text-sm text-slate-500">A dictionary of labor, nonlabor, and material resources -- shared across all of your scheduling projects.</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold hover:bg-slate-100">Close</button>
        </div>

        {isOwner && (
          <div className="mt-5 rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-bold text-slate-600">Add a resource</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Framing Crew"
                className="rounded border border-slate-300 px-2 py-1 text-sm" data-scheduling-resource-name-input />
              <select value={draft.resourceType} onChange={(e) => setDraft((d) => ({ ...d, resourceType: e.target.value }))} className="rounded border border-slate-300 px-2 py-1 text-sm">
                {RESOURCE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <input value={draft.unitOfMeasure} onChange={(e) => setDraft((d) => ({ ...d, unitOfMeasure: e.target.value }))} placeholder="Unit (material only)"
                className="w-36 rounded border border-slate-300 px-2 py-1 text-sm" />
              <label className="flex items-center gap-1 text-xs font-bold text-slate-600">
                Max/day
                <input type="number" min={0} value={draft.maxUnitsPerDay} onChange={(e) => setDraft((d) => ({ ...d, maxUnitsPerDay: e.target.value }))}
                  className="w-16 rounded border border-slate-300 px-2 py-1 text-sm" />
              </label>
              <label className="flex items-center gap-1 text-xs font-bold text-slate-600">
                Rate
                <input type="number" min={0} value={draft.stdRate} onChange={(e) => setDraft((d) => ({ ...d, stdRate: e.target.value }))}
                  className="w-20 rounded border border-slate-300 px-2 py-1 text-sm" />
              </label>
              <button type="button" onClick={handleCreate} disabled={creating || !draft.name.trim()}
                className="rounded bg-slate-950 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" data-scheduling-add-resource>
                {creating ? "Adding…" : "Add"}
              </button>
            </div>
            {message && <p role="status" className="mt-2 text-xs font-bold text-slate-600">{message}</p>}
          </div>
        )}

        <div className="mt-6">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">Resource dictionary</h3>
          {loading && <p className="mt-2 text-xs text-slate-400">Loading…</p>}
          {!loading && resources.length === 0 && <p className="mt-2 text-xs text-slate-400">No resources yet.</p>}
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="pr-2 font-bold">Name</th>
                  <th className="pr-2 font-bold">Type</th>
                  <th className="pr-2 font-bold">Max/day</th>
                  <th className="pr-2 font-bold">Rate</th>
                  <th className="pr-2 font-bold">Active</th>
                  {isOwner && <th className="pr-2 font-bold" />}
                </tr>
              </thead>
              <tbody>
                {resources.map((resource) => (
                  <tr key={resource.id} className="border-t border-slate-100">
                    <td className="py-1 pr-2 font-bold">{resource.name}{resource.unit_of_measure ? ` (${resource.unit_of_measure})` : ""}</td>
                    <td className="py-1 pr-2">{resource.resource_type}</td>
                    <td className="py-1 pr-2">{resource.max_units_per_day}</td>
                    <td className="py-1 pr-2">${Number(resource.std_rate).toLocaleString()}</td>
                    <td className="py-1 pr-2">
                      {isOwner ? (
                        <button type="button" onClick={() => handleToggleActive(resource)} className={resource.is_active ? "font-bold text-emerald-600" : "font-bold text-slate-400"}>
                          {resource.is_active ? "Active" : "Inactive"}
                        </button>
                      ) : (resource.is_active ? "Active" : "Inactive")}
                    </td>
                    {isOwner && (
                      <td className="py-1 pr-2">
                        <button type="button" onClick={() => handleDelete(resource)} className="font-bold text-red-600 hover:text-red-800">Delete</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
