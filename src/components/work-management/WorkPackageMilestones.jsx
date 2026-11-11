// Work Package Planner slice 9 — the Milestones tab for one work
// package: instantiate the package's timing backbone from a named,
// client-editable template (any number of complexity tiers — the
// source data proved a real client used two, not the usual three),
// then track planned/actual dates, percent complete, and the ±7-day
// late flag. `late` is computed server-side on every read, never
// stored. Stage-gate milestones (the formal TR-N turnaround reviews)
// are visually distinguished. A "Master only" toggle keeps the 14-row
// backbone on one screen; "All" also shows functional sub-items.
"use client";

import { useMemo, useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { withWorkspaceQuery } from "./workspaceQuery.js";
import MilestonesPrintView from "./MilestonesPrintView.jsx";

const input = "w-full rounded-lg border border-slate-300 px-2 py-1 text-sm";
const label = "block text-xs font-medium text-slate-600 mb-1";
const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const btnPrimary = `${btn} bg-slate-900 text-white hover:bg-slate-700`;
const btnGhost = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;

async function api(path, options) {
  const response = await fetch(withWorkspaceQuery(path), {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

function formatDate(value) {
  if (!value) return "—";
  const [y, m, d] = String(value).slice(0, 10).split("-");
  return y && m && d ? `${m}/${d}/${y}` : String(value);
}

export default function WorkPackageMilestones({ packageId, onChanged, refreshKey = 0 }) {
  const [confirmation, setConfirmation] = useState("");
  const [viewAll, setViewAll] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [instantiateForm, setInstantiateForm] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [editReason, setEditReason] = useState("");
  const [retireReason, setRetireReason] = useState({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const { data, error: loadError, isLoading, refresh } = useStaleWhileRevalidate(
    `work-packages:${packageId}:milestones:${refreshKey}`,
    () => api(`/api/work-packages/${packageId}/milestones`),
    { ttlMs: 10_000 },
  );

  const templates = useMemo(() => data?.templates || [], [data]);
  const instances = useMemo(() => data?.instances || [], [data]);
  const packageStatus = data?.packageStatus || "";
  const isTerminal = packageStatus === "cancelled" || packageStatus === "verified_closed";
  const notApplied = Boolean(data?.notApplied);

  const templateNames = useMemo(
    () => Array.from(new Set(templates.map((t) => t.templateName))).sort(),
    [templates],
  );

  const tiersForTemplate = useMemo(() => {
    if (!instantiateForm?.templateName) return [];
    const rows = templates.filter((t) => t.templateName === instantiateForm.templateName);
    const tiers = new Set();
    rows.forEach((t) => t.offsets.forEach((o) => tiers.add(o.complexityTier)));
    return Array.from(tiers).sort();
  }, [templates, instantiateForm]);

  const visibleInstances = useMemo(
    () => (viewAll ? instances : instances.filter((m) => m.isMaster)).sort((a, b) => a.milestoneNumber - b.milestoneNumber),
    [instances, viewAll],
  );

  async function reload(message) {
    if (message) setConfirmation(message);
    setActionError("");
    await refresh();
    if (onChanged) onChanged();
  }

  async function onInstantiate(event) {
    event.preventDefault();
    setBusy(true);
    setActionError("");
    try {
      await api(`/api/work-packages/${packageId}/milestones`, {
        method: "POST",
        body: JSON.stringify({
          templateName: instantiateForm.templateName,
          anchorDate: instantiateForm.anchorDate,
          complexityTier: instantiateForm.complexityTier,
        }),
      });
      setInstantiateForm(null);
      await reload(`Instantiated milestones from the ${instantiateForm.templateName} template (${instantiateForm.complexityTier} complexity).`);
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(milestone) {
    setEditingId(milestone.id);
    setEditDraft({
      description: milestone.description,
      responsibilityRole: milestone.responsibilityRole || "",
      department: milestone.department || "",
      plannedDate: milestone.plannedDate,
      actualDate: milestone.actualDate || "",
      percentComplete: String(milestone.percentComplete),
      comments: milestone.comments || "",
      justification: milestone.justification || "",
      expectedVersion: milestone.version,
    });
    setEditReason("");
    setActionError("");
  }

  async function onSaveEdit(milestone) {
    if (!editReason.trim()) {
      setActionError("Enter a reason for this change first.");
      return;
    }
    setBusy(true);
    setActionError("");
    try {
      await api(`/api/work-packages/${packageId}/milestones/${milestone.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          description: editDraft.description,
          responsibilityRole: editDraft.responsibilityRole || null,
          department: editDraft.department || null,
          plannedDate: editDraft.plannedDate,
          actualDate: editDraft.actualDate || null,
          percentComplete: Number(editDraft.percentComplete),
          comments: editDraft.comments || null,
          justification: editDraft.justification || null,
          expectedVersion: editDraft.expectedVersion,
          reason: editReason.trim(),
        }),
      });
      setEditingId(null);
      setEditDraft(null);
      await reload(`Saved milestone ${milestone.milestoneNumber} — ${editDraft.description}.`);
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function onRetire(milestone) {
    const reason = (retireReason[milestone.id] || "").trim();
    if (!reason) {
      setActionError("Enter a reason to retire this milestone.");
      return;
    }
    setBusy(true);
    setActionError("");
    try {
      await api(`/api/work-packages/${packageId}/milestones/${milestone.id}/retire`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: milestone.version, reason }),
      });
      await reload(`Retired milestone ${milestone.milestoneNumber} — ${milestone.description}.`);
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy(false);
    }
  }

  if (isLoading && !data) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Milestones</h2>
        <p className="mt-2 text-sm text-slate-500">Loading…</p>
      </section>
    );
  }

  if (notApplied) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Milestones</h2>
        <p className="mt-2 text-sm text-amber-700">
          Milestones isn&apos;t available yet — the database change for this feature hasn&apos;t been
          applied.
        </p>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Milestones</h2>
        <p className="mt-2 text-sm text-red-700">Unable to load Milestones. {loadError.message}</p>
      </section>
    );
  }

  if (showPrint) {
    return <MilestonesPrintView instances={visibleInstances} onClose={() => setShowPrint(false)} />;
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5" aria-label="Milestones">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">Milestones</h2>
        <div className="flex items-center gap-2">
          {instances.length > 0 && (
            <>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={viewAll}
                  onChange={(event) => setViewAll(event.target.checked)}
                />
                Show functional sub-items (All)
              </label>
              <button type="button" className={btnGhost} onClick={() => setShowPrint(true)}>
                Download PDF
              </button>
            </>
          )}
          {instances.length === 0 && !instantiateForm && !isTerminal && (
            <button
              type="button"
              className={btnPrimary}
              onClick={() => setInstantiateForm({ templateName: templateNames[0] || "", anchorDate: "", complexityTier: "" })}
            >
              Instantiate from template…
            </button>
          )}
        </div>
      </div>

      {confirmation && <p className="mt-2 text-sm text-emerald-700">{confirmation}</p>}
      {actionError && <p className="mt-2 text-sm text-red-700">{actionError}</p>}
      {isTerminal && (
        <p className="mt-2 text-sm text-slate-500">This work package is closed — Milestones is read-only.</p>
      )}

      {instantiateForm && (
        <form onSubmit={onInstantiate} className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={label} htmlFor="milestones_template_name">Template</label>
              <select
                id="milestones_template_name"
                className={input}
                value={instantiateForm.templateName}
                onChange={(event) => setInstantiateForm((f) => ({ ...f, templateName: event.target.value, complexityTier: "" }))}
              >
                {templateNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="milestones_anchor_date">Anchor date (outage start)</label>
              <input
                id="milestones_anchor_date"
                type="date"
                className={input}
                value={instantiateForm.anchorDate}
                onChange={(event) => setInstantiateForm((f) => ({ ...f, anchorDate: event.target.value }))}
                required
              />
            </div>
            <div>
              <label className={label} htmlFor="milestones_tier">Complexity tier</label>
              <select
                id="milestones_tier"
                className={input}
                value={instantiateForm.complexityTier}
                onChange={(event) => setInstantiateForm((f) => ({ ...f, complexityTier: event.target.value }))}
                required
              >
                <option value="" disabled>Choose…</option>
                {tiersForTemplate.map((tier) => (
                  <option key={tier} value={tier}>{tier}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className={btnPrimary} disabled={busy || !instantiateForm.complexityTier}>
              Instantiate
            </button>
            <button type="button" className={btnGhost} onClick={() => setInstantiateForm(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {instances.length === 0 && !instantiateForm && (
        <p className="mt-3 text-sm text-slate-600">
          No milestones yet. Instantiate this package&apos;s timing backbone from a template to start
          tracking planned and actual dates.
        </p>
      )}

      {visibleInstances.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">Description</th>
                <th className="px-2 py-2">Responsibility</th>
                <th className="px-2 py-2">Department</th>
                <th className="px-2 py-2">Tier</th>
                <th className="px-2 py-2">Planned</th>
                <th className="px-2 py-2">Actual</th>
                <th className="px-2 py-2">% Complete</th>
                <th className="px-2 py-2">Late</th>
                <th className="px-2 py-2">Comments</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {visibleInstances.map((milestone) => {
                const isEditing = editingId === milestone.id;
                return (
                  <tr
                    key={milestone.id}
                    className={`border-b border-slate-100 ${milestone.isStageGate ? "bg-amber-50 font-semibold" : ""}`}
                    aria-label={`Milestone ${milestone.milestoneNumber}${milestone.isStageGate ? " (stage gate)" : ""}`}
                  >
                    <td className="px-2 py-2">
                      {milestone.milestoneNumber}
                      {milestone.isStageGate && <span className="ml-1 text-amber-700" title="Stage-gate review">●</span>}
                    </td>
                    {isEditing ? (
                      <>
                        <td className="px-2 py-2">
                          <input className={input} value={editDraft.description} onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))} />
                        </td>
                        <td className="px-2 py-2">
                          <input className={input} value={editDraft.responsibilityRole} onChange={(e) => setEditDraft((d) => ({ ...d, responsibilityRole: e.target.value }))} />
                        </td>
                        <td className="px-2 py-2">
                          <input className={input} value={editDraft.department} onChange={(e) => setEditDraft((d) => ({ ...d, department: e.target.value }))} />
                        </td>
                        <td className="px-2 py-2">{milestone.complexityTierSelected}</td>
                        <td className="px-2 py-2">
                          <input type="date" className={input} value={editDraft.plannedDate} onChange={(e) => setEditDraft((d) => ({ ...d, plannedDate: e.target.value }))} />
                        </td>
                        <td className="px-2 py-2">
                          <input type="date" className={input} value={editDraft.actualDate} onChange={(e) => setEditDraft((d) => ({ ...d, actualDate: e.target.value }))} />
                        </td>
                        <td className="px-2 py-2">
                          <input type="number" min="0" max="100" className={input} value={editDraft.percentComplete} onChange={(e) => setEditDraft((d) => ({ ...d, percentComplete: e.target.value }))} />
                        </td>
                        <td className="px-2 py-2">—</td>
                        <td className="px-2 py-2">
                          <input className={input} value={editDraft.comments} onChange={(e) => setEditDraft((d) => ({ ...d, comments: e.target.value }))} />
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex flex-col gap-1">
                            <input
                              className={input}
                              placeholder="Reason for this change"
                              value={editReason}
                              onChange={(e) => setEditReason(e.target.value)}
                            />
                            <div className="flex gap-1">
                              <button type="button" className={btnPrimary} disabled={busy} onClick={() => onSaveEdit(milestone)}>Save</button>
                              <button type="button" className={btnGhost} disabled={busy} onClick={() => { setEditingId(null); setEditDraft(null); }}>Cancel</button>
                            </div>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-2 py-2">{milestone.description}</td>
                        <td className="px-2 py-2">{milestone.responsibilityRole || "—"}</td>
                        <td className="px-2 py-2">{milestone.department || "—"}</td>
                        <td className="px-2 py-2">{milestone.complexityTierSelected}</td>
                        <td className="px-2 py-2">{formatDate(milestone.plannedDate)}</td>
                        <td className="px-2 py-2">{formatDate(milestone.actualDate)}</td>
                        <td className="px-2 py-2">{milestone.percentComplete}%</td>
                        <td className="px-2 py-2">
                          {milestone.late ? <span className="font-semibold text-red-700">Late</span> : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-2 py-2">{milestone.comments || "—"}</td>
                        <td className="px-2 py-2">
                          {!isTerminal && (
                            <div className="flex flex-col gap-1">
                              <button type="button" className={btnGhost} onClick={() => startEdit(milestone)}>Edit</button>
                              <input
                                className={input}
                                placeholder="Reason to retire"
                                value={retireReason[milestone.id] || ""}
                                onChange={(e) => setRetireReason((r) => ({ ...r, [milestone.id]: e.target.value }))}
                              />
                              <button type="button" className={btnGhost} disabled={busy} onClick={() => onRetire(milestone)}>Retire</button>
                            </div>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
