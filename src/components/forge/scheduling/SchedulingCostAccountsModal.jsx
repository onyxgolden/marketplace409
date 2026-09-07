"use client";
import { useEffect, useState } from "react";

function emptyDraft() {
  return { code: "", name: "" };
}

// SCHED-19: the owner-global cost-code dictionary (schedule_cost_accounts has no
// schedule_project_id, same shape as SchedulingResourcesModal.jsx's schedule_resources) -- a PO#,
// WO#, or any other code the owner wants to tag a resource assignment or expense with, so cost can
// later be filtered/summarized by code in the Costs modal. onChanged fires after any create/update/
// delete so the block drawer's own cost-code picker (BlockResourcesPanel) can refetch.
export default function SchedulingCostAccountsModal({ isOwner, onClose, onChanged }) {
  const [costAccounts, setCostAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(emptyDraft());
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");

  async function loadCostAccounts() {
    setLoading(true);
    const response = await fetch("/api/forge/scheduling/cost-accounts");
    const result = await response.json().catch(() => ({}));
    setCostAccounts(result.costAccounts || []);
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadCostAccounts(); }, []);

  async function handleCreate() {
    const code = draft.code.trim();
    const name = draft.name.trim();
    if (!code || !name) return;
    setCreating(true); setMessage("");
    const response = await fetch("/api/forge/scheduling/cost-accounts", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name }),
    });
    const result = await response.json().catch(() => ({}));
    setCreating(false);
    if (!response.ok) { setMessage(result.error || "Unable to create this cost code."); return; }
    setDraft(emptyDraft());
    setMessage("Cost code added.");
    await loadCostAccounts();
    onChanged?.();
  }

  async function handleDelete(costAccount) {
    const response = await fetch(`/api/forge/scheduling/cost-accounts/${costAccount.id}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(result.error || "Unable to delete this cost code."); return; }
    await loadCostAccounts();
    onChanged?.();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose} data-scheduling-cost-accounts>
      <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 text-slate-950 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-amber-700">Scheduling</p>
            <h2 className="mt-1 text-xl font-black">Cost codes</h2>
            <p className="mt-1 text-sm text-slate-500">PO#s, WO#s, or any other code -- shared across all of your scheduling projects. Tag a resource assignment or expense with one, then filter Costs by it.</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold hover:bg-slate-100">Close</button>
        </div>

        {isOwner && (
          <div className="mt-5 rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-bold text-slate-600">Add a cost code</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input value={draft.code} onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))} placeholder="e.g. PO-4521"
                className="w-32 rounded border border-slate-300 px-2 py-1 text-sm" data-scheduling-cost-account-code-input />
              <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Structural steel supplier"
                className="min-w-[200px] flex-1 rounded border border-slate-300 px-2 py-1 text-sm" />
              <button type="button" onClick={handleCreate} disabled={creating || !draft.code.trim() || !draft.name.trim()}
                className="rounded bg-slate-950 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" data-scheduling-add-cost-account>
                {creating ? "Adding…" : "Add"}
              </button>
            </div>
            {message && <p role="status" className="mt-2 text-xs font-bold text-slate-600">{message}</p>}
          </div>
        )}

        <div className="mt-6">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">Cost code dictionary</h3>
          {loading && <p className="mt-2 text-xs text-slate-400">Loading…</p>}
          {!loading && costAccounts.length === 0 && <p className="mt-2 text-xs text-slate-400">No cost codes yet.</p>}
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="pr-2 font-bold">Code</th>
                  <th className="pr-2 font-bold">Name</th>
                  {isOwner && <th className="pr-2 font-bold" />}
                </tr>
              </thead>
              <tbody>
                {costAccounts.map((costAccount) => (
                  <tr key={costAccount.id} className="border-t border-slate-100">
                    <td className="py-1 pr-2 font-bold">{costAccount.code}</td>
                    <td className="py-1 pr-2">{costAccount.name}</td>
                    {isOwner && (
                      <td className="py-1 pr-2">
                        <button type="button" onClick={() => handleDelete(costAccount)} className="font-bold text-red-600 hover:text-red-800">Delete</button>
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
