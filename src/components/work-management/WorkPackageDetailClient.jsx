"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WP_STATUS, WP_PACKAGE_TYPES, WP_PRIORITIES, allowedTransitionsFrom, findTransition, defaultGatesFor, inferEffectiveMode } from "@/domains/work-management/workPackage.js";
import WorkPackageLinks from "./WorkPackageLinks.jsx";
import WorkPackagePermitAnnotations from "./WorkPackagePermitAnnotations.jsx";
import WorkPackageDocuments from "./WorkPackageDocuments.jsx";
import WorkPackageDrawingReadiness from "./WorkPackageDrawingReadiness.jsx";
import WorkPackageCraftAssignments from "./WorkPackageCraftAssignments.jsx";
import WorkPackageSteps from "./WorkPackageSteps.jsx";
import WorkPackageManpowerCurve from "./WorkPackageManpowerCurve.jsx";
import WorkPackageBudgetPanel from "./WorkPackageBudgetPanel.jsx";
import WorkPackageChangeOrders from "./WorkPackageChangeOrders.jsx";
import { withWorkspaceQuery } from "./workspaceQuery.js";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const label = "block text-xs font-medium text-slate-600 mb-1";
const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const btnPrimary = `${btn} bg-slate-900 text-white hover:bg-slate-700`;
const btnGhost = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;

// UI-density redesign: 8 tabs (the Milestones tab is a placeholder until
// slice 9 builds it — see the tabset correction). Tab order: the schedule
// spine (Work steps, then Milestones) follows the package overview; Budget
// & Change Orders sits after the IFA→IFC redlines per the brief.
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "steps", label: "Work steps" },
  { id: "milestones", label: "Milestones" },
  { id: "permits", label: "Permits" },
  { id: "redlines", label: "IFA→IFC redlines" },
  { id: "budget", label: "Budget & Change Orders" },
  { id: "documents", label: "Documents" },
  { id: "activity", label: "Activity / Audit" },
];

// Friendly labels for the canonical gate keys (WP_GATES). The selector is
// driven by defaultGatesFor(package_type); labels are display-only.
const GATE_LABELS = {
  scope: "Scope", design: "Design / drawings", predecessor: "Predecessors",
  material: "Materials", crew: "Crew", permit: "Permits", site: "Site access",
  safety: "Safety", evidence: "Evidence", equipment_readiness: "Equipment readiness",
  inspection_prerequisite: "Inspection prerequisites", logistics: "Logistics",
};

function Field({ title, value }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{title}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value ?? "—"}</dd>
    </div>
  );
}

// Edit-form state derived from a persisted package row. The date input
// keeps its controlled "" for an empty date; serialization to null happens
// in onSaveEdit (and the service normalizes "" again as defense, D6).
function editFormFromPackage(p) {
  return {
    title: p.title, description: p.description || "",
    project_id: p.project_id || "",
    planned_finish: p.planned_finish || "", property_id: p.property_id || "",
    mode: inferEffectiveMode(p),
  };
}

export default function WorkPackageDetailClient({ initial, initialLinks = [], initialTab = "overview", workspaceParam = null }) {
  const router = useRouter();
  const [pkg, setPkg] = useState(initial.package);
  const [transitions, setTransitions] = useState(initial.transitions);
  const [attestations, setAttestations] = useState(initial.attestations);
  const [baselines, setBaselines] = useState(initial.baselines);
  const [changes, setChanges] = useState(initial.scopeChanges);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(() => editFormFromPackage(initial.package));
  const [properties, setProperties] = useState(null);
  const [propertiesError, setPropertiesError] = useState("");
  const [transitionTarget, setTransitionTarget] = useState("");
  const [transitionCtx, setTransitionCtx] = useState("");
  const [attestation, setAttestation] = useState({ gate: "", statement: "" });
  const [baselineItems, setBaselineItems] = useState("");
  const [changeForm, setChangeForm] = useState({ changeType: "addition", description: "" });
  // D14: this used to reuse the shared, page-wide `error` state, so a
  // client-side "invalid JSON" message from Freeze baseline (on Overview)
  // kept showing on every other tab, with no dismiss control, until a full
  // reload. Scoped to its own section's local state, cleared on any new
  // attempt, so it can never outlive the section it belongs to.
  const [baselineError, setBaselineError] = useState("");
  // D1: the live audit found Freeze baseline producing no visible effect and
  // no message — root cause was an un-awaited refresh() racing the optimistic
  // setBaselines update (whichever resolved last silently won, with nothing
  // shown either way). freezeMessage is the plain-words confirmation the
  // Build Contract requires ("every save confirms... naming names, not raw
  // IDs"); refresh() is now awaited so the final state is deterministic.
  const [freezeMessage, setFreezeMessage] = useState("");
  const [costRefreshKey, setCostRefreshKey] = useState(0);
  // D7 delete affordance: server-derived eligibility (display only — the
  // delete RPC revalidates everything). Owner-only section; null hides it.
  const [deletionEligibility, setDeletionEligibility] = useState(initial.deletionEligibility ?? null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmCode, setDeleteConfirmCode] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deleteTriggerRef = useRef(null);
  const deleteBusyRef = useRef(false);
  // UI-density redesign: tab state, initialized from the server-resolved
  // ?tab= deep link (unknown values fall back to Overview). Switching tabs
  // updates the URL (router.replace, no refetch of the already-loaded
  // package data) and preserves the ?workspace= selection when one is active.
  const [activeTab, setActiveTab] = useState(
    TABS.some((tab) => tab.id === initialTab) ? initialTab : "overview",
  );

  function switchTab(tab) {
    setActiveTab(tab);
    const params = new URLSearchParams();
    if (tab !== "overview") params.set("tab", tab);
    if (workspaceParam) params.set("workspace", workspaceParam);
    const query = params.toString();
    router.replace(query ? `${window.location.pathname}?${query}` : window.location.pathname, { scroll: false });
  }

  const allowed = allowedTransitionsFrom(pkg);
  const target = transitionTarget ? findTransition(pkg, transitionTarget) : null;

  async function call(path, method, body) {
    setBusy(true);
    setError("");
    const response = await fetch(withWorkspaceQuery(path), {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) setError(data.error || "Request failed.");
    return { response, data };
  }

  // Property options for the read-only label and the edit picker. The
  // package stores only the canonical slug; the label comes from the
  // owner's property list. Failing to load never blocks viewing the
  // package — the slug itself is the fallback label.
  useEffect(() => {
    let cancelled = false;
    fetch(withWorkspaceQuery("/api/work-packages/property-options"))
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load properties.");
        return body.properties || [];
      })
      .then((options) => { if (!cancelled) setProperties(options); })
      .catch((caught) => { if (!cancelled) setPropertiesError(caught.message); });
    return () => { cancelled = true; };
  }, []);

  const propertyLabel = pkg.property_id
    ? (properties || []).find((property) => property.slug === pkg.property_id)?.label || pkg.property_id
    : null;

  async function refresh() {
    const { response, data } = await call(`/api/work-packages/${pkg.id}`, "GET");
    if (!response.ok) return;
    setPkg(data.package);
    setTransitions(data.transitions);
    setAttestations(data.attestations);
    setBaselines(data.baselines);
    setChanges(data.scopeChanges);
    setDeletionEligibility(data.deletionEligibility ?? null);
    setEditForm(editFormFromPackage(data.package));
    setEditing(false);
    setTransitionTarget("");
    setTransitionCtx("");
    router.refresh();
  }

  async function onSaveEdit(event) {
    event.preventDefault();
    // property_id always present in the patch: a chosen slug assigns, an
    // empty picker clears to null (server canonicalizes and validates).
    // planned_finish likewise: an empty date input serializes to null —
    // the raw "" must never reach the Postgres date column (D6).
    const { response } = await call(`/api/work-packages/${pkg.id}`, "PATCH", {
      ...editForm,
      // Project is free text (D3): blank clears to null, typed text is kept
      // verbatim after trimming. Independent of property_id.
      project_id: (editForm.project_id || "").trim() || null,
      planned_finish: editForm.planned_finish || null,
      property_id: editForm.property_id || null,
    });
    if (response.ok) refresh();
  }

  // Entering or abandoning the edit form starts from the persisted
  // package: unsaved changes are discarded and a stale error from a
  // previous failed save is cleared. A fresh failure sets a new error and
  // keeps the form open until the user retries or cancels.
  function onStartEdit() {
    setEditForm(editFormFromPackage(pkg));
    setError("");
    setEditing(true);
  }

  function onCancelEdit() {
    setEditForm(editFormFromPackage(pkg));
    setError("");
    setEditing(false);
  }

  // -- D7 delete ------------------------------------------------------------
  function openDeleteDialog() {
    setDeleteConfirmCode("");
    setDeleteError("");
    setDeleteOpen(true);
  }

  function closeDeleteDialog() {
    if (deleteBusyRef.current) return;
    setDeleteOpen(false);
    setDeleteConfirmCode("");
    setDeleteError("");
  }

  // Escape closes the dialog (never mid-delete); focus returns to the
  // Delete button when the dialog closes.
  useEffect(() => {
    if (!deleteOpen) return undefined;
    const trigger = deleteTriggerRef.current;
    function onKeyDown(event) {
      if (event.key === "Escape" && !deleteBusyRef.current) closeDeleteDialog();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [deleteOpen]);

  async function onConfirmDelete() {
    if (deleteBusyRef.current || deleteConfirmCode !== pkg.code) return;
    setDeleteBusy(true);
    deleteBusyRef.current = true;
    setDeleteError("");
    try {
      const response = await fetch(withWorkspaceQuery(`/api/work-packages/${pkg.id}`), {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmCode: deleteConfirmCode,
          expectedVersion: pkg.version,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        // Leave only after the server confirmed the delete.
        router.push("/forge/work");
        return;
      }
      if (response.status === 409) {
        // State changed under us (edit, dependency, status): close the
        // dialog, refresh detail + eligibility, and keep the package
        // visible with the fresh explanation.
        setDeleteOpen(false);
        setDeleteConfirmCode("");
        await refresh();
        setDeleteError(
          data.error || "This package changed and can't be deleted right now. The details above are up to date.",
        );
        return;
      }
      setDeleteError(data.error || "Delete failed. The package was not deleted.");
    } catch {
      setDeleteError("Delete didn't go through. Check your connection and try again — the package was not deleted.");
    } finally {
      setDeleteBusy(false);
      deleteBusyRef.current = false;
    }
  }

  async function onTransition() {
    if (!transitionTarget) return;
    const ctx = {};
    if (transitionCtx) {
      try {
        Object.assign(ctx, JSON.parse(transitionCtx));
      } catch {
        setError("Transition context must be valid JSON, e.g. {\"userConfirmedStart\": true}.");
        return;
      }
    }
    const { response } = await call(`/api/work-packages/${pkg.id}/transition`, "POST", { to: transitionTarget, ...ctx });
    if (response.ok) refresh();
  }

  async function onAttest(event) {
    event.preventDefault();
    const { response, data } = await call(`/api/work-packages/${pkg.id}/attestations`, "POST", attestation);
    if (response.ok) {
      setAttestations((prev) => [data.attestation, ...prev]);
      setAttestation({ gate: "", statement: "", notApplicable: false, naReason: "" });
    }
  }

  async function onFreeze() {
    setBaselineError("");
    setFreezeMessage("");
    let membership;
    try {
      membership = JSON.parse(baselineItems);
    } catch {
      setBaselineError("Scope items must be valid JSON: an array of {key, description, quantity, unit}.");
      return;
    }
    const { response, data } = await call(`/api/work-packages/${pkg.id}/scope`, "POST", { action: "freeze", membership });
    if (response.ok) {
      setBaselineItems("");
      // Awaited: refresh() must settle before this handler returns, so its
      // GET can never race the optimistic update and silently overwrite a
      // confirmed success with contradictory (e.g. stale) state. The
      // version number comes from the POST's own response, not from
      // whatever refresh() later finds, so the confirmation names the real
      // result even if a slow refresh is still in flight.
      await refresh();
      setFreezeMessage(`Froze baseline version ${data.baseline.version}.`);
    }
  }

  async function onPropose(event) {
    event.preventDefault();
    const current = baselines.length ? baselines[baselines.length - 1] : null;
    const { response } = await call(`/api/work-packages/${pkg.id}/scope`, "POST", {
      action: "propose", baselineVersion: current?.version, ...changeForm,
    });
    if (response.ok) {
      setChangeForm({ changeType: "addition", description: "" });
      refresh();
    }
  }

  async function onDecide(changeId, approve) {
    let newMembership = null;
    if (approve) {
      const raw = prompt("Paste the NEW full scope membership as JSON (array of {key, description, quantity, unit}):");
      if (!raw) return;
      try {
        newMembership = JSON.parse(raw);
      } catch {
        setError("New membership must be valid JSON.");
        return;
      }
    }
    const { response } = await call(`/api/work-packages/${pkg.id}/scope/${changeId}`, "POST", { approve, newMembership });
    if (response.ok) refresh();
  }

  const isTerminal = pkg.status === WP_STATUS.VERIFIED_CLOSED || pkg.status === WP_STATUS.CANCELLED;

  return (
    <div className="mt-6">
      {error && (
        <p role="alert" className="flex items-start justify-between gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label="Dismiss" className="shrink-0 font-bold">×</button>
        </p>
      )}

      <div role="tablist" aria-label="Work package sections" className="sticky top-0 z-20 -mx-4 border-b border-slate-200 bg-white px-4">
        <div className="flex flex-wrap gap-1 py-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => switchTab(tab.id)}
              className={
                activeTab === tab.id
                  ? "rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
                  : "rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "overview" && (
        <div className="mt-6 space-y-6">
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Package</h2>
              {!isTerminal && !editing && (
                <button className={btnGhost} onClick={onStartEdit} disabled={busy}>Edit</button>
              )}
            </div>
            {editing ? (
              <form onSubmit={onSaveEdit} className="mt-4 space-y-4">
                <div>
                  <label className={label}>Title</label>
                  <input className={input} value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} required />
                </div>
                <div>
                  <label className={label}>Scope description</label>
                  <textarea className={input} rows={3} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
                </div>
                <div>
                  <label className={label} htmlFor="edit_project_id">Project (optional)</label>
                  <input id="edit_project_id" className={input} value={editForm.project_id} onChange={(e) => setEditForm({ ...editForm, project_id: e.target.value })} />
                </div>
                <div>
                  <label className={label}>Planned finish</label>
                  <input type="date" className={input} value={editForm.planned_finish} onChange={(e) => setEditForm({ ...editForm, planned_finish: e.target.value })} />
                </div>
                <div>
                  <label className={label} htmlFor="edit_mode">Mode</label>
                  <select id="edit_mode" className={input} value={editForm.mode}
                    onChange={(e) => setEditForm({ ...editForm, mode: e.target.value })}>
                    <option value="industrial">Industrial</option>
                    <option value="commercial">Commercial</option>
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    Switches which optional fields this package shows (Unit/Area/System vs Property) — it never
                    changes the package's Scope/type, Unit/Area/System, or Property values themselves.
                  </p>
                </div>
                {editForm.mode === "commercial" && (
                  <div>
                    <label className={label} htmlFor="edit_property_id">Property (optional)</label>
                    <select id="edit_property_id" className={input} value={editForm.property_id}
                      onChange={(e) => setEditForm({ ...editForm, property_id: e.target.value })}
                      disabled={properties === null && !propertiesError}>
                      <option value="">No property assigned</option>
                      {editForm.property_id && !(properties || []).some((property) => property.slug === editForm.property_id) && (
                        <option value={editForm.property_id}>{editForm.property_id} (current)</option>
                      )}
                      {(properties || []).map((property) => (
                        <option key={property.slug} value={property.slug}>{property.label}</option>
                      ))}
                    </select>
                    {properties === null && !propertiesError && (
                      <p className="mt-1 text-xs text-slate-500">Loading properties…</p>
                    )}
                    {propertiesError && (
                      <p className="mt-1 text-xs text-red-700">
                        Properties could not be loaded ({propertiesError}) — the current assignment is shown by its saved name below.
                      </p>
                    )}
                  </div>
                )}
                <div className="flex gap-2">
                  <button type="submit" className={btnPrimary} disabled={busy}>Save</button>
                  <button type="button" className={btnGhost} onClick={onCancelEdit} disabled={busy}>Cancel</button>
                </div>
              </form>
            ) : (
              <dl className="mt-4 grid gap-4 sm:grid-cols-3">
                <Field title="Title" value={pkg.title} />
                <Field title="Type" value={pkg.package_type?.replace(/_/g, " ")} />
                <Field title="Priority" value={pkg.priority} />
                <Field title="Project" value={pkg.project_id} />
                <Field title="Responsible party" value={pkg.responsible_party?.display_name} />
                <Field title="Mode" value={inferEffectiveMode(pkg).replace(/^./, (c) => c.toUpperCase())} />
                {inferEffectiveMode(pkg) === "commercial" ? (
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Property</dt>
                    <dd className="mt-0.5 text-sm text-slate-900">
                      {pkg.property_id ? (
                        <Link
                          href={`/forge/rental?recordType=property&recordId=${encodeURIComponent(pkg.property_id)}&propertyId=${encodeURIComponent(pkg.property_id)}`}
                          className="font-medium text-blue-700 hover:underline"
                        >
                          {propertyLabel}
                        </Link>
                      ) : (
                        "No property assigned"
                      )}
                    </dd>
                  </div>
                ) : (
                  <Field title="Unit / Area / System" value={[pkg.unit, pkg.area, pkg.system].filter(Boolean).join(" / ") || null} />
                )}
                <Field title="Planned start" value={pkg.planned_start} />
                <Field title="Planned finish" value={pkg.planned_finish} />
                <Field title="Actual start" value={pkg.actual_start} />
                <Field title="Actual finish" value={pkg.actual_finish} />
                <Field title="Progress" value={pkg.percent_complete != null ? `${pkg.percent_complete}% (${pkg.progress_basis || "unknown basis"})` : "unknown"} />
                <Field title="Equipment tag" value={pkg.equipment_tag} />
                <Field title="Work order ref" value={pkg.work_order_ref} />
              </dl>
            )}
            {pkg.description && !editing && <p className="mt-4 text-sm text-slate-600">{pkg.description}</p>}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">Lifecycle</h2>
            <p className="mt-1 text-sm text-slate-600">
              Current status: <span className="font-semibold">{pkg.status.replace(/_/g, " ")}</span>
            </p>
            {pkg.blocked_reason && (
              <p className="mt-2 text-sm text-red-700">Blocked: {pkg.blocked_reason}</p>
            )}
            {allowed.length > 0 ? (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {allowed.map((to) => (
                    <button
                      key={to}
                      className={transitionTarget === to ? btnPrimary : btnGhost}
                      onClick={() => setTransitionTarget(transitionTarget === to ? "" : to)}
                      disabled={busy}
                    >
                      {to.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
                {target?.requires && (
                  <p className="text-xs text-slate-500">
                    Requires: {target.requires.join(", ")}
                  </p>
                )}
                {transitionTarget && (
                  <div className="flex gap-2">
                    <input
                      className={input}
                      placeholder='Context as JSON, e.g. {"userConfirmedStart": true}. Gates, verifier identity, and reopen/override authority are derived server-side.'
                      value={transitionCtx}
                      onChange={(e) => setTransitionCtx(e.target.value)}
                    />
                    <button className={btnPrimary} onClick={onTransition} disabled={busy}>
                      {busy ? "…" : "Confirm"}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-500">Terminal state — no further transitions.</p>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">Readiness attestations</h2>
            <p className="mt-1 text-xs text-slate-500">
              Human attestations feed the Readiness Review → Ready interim rule (Rung 1).
            </p>
            <form onSubmit={onAttest} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
              <div>
                <label className={label}>Gate</label>
                <select className={`${input} sm:w-44`} value={attestation.gate} onChange={(e) => setAttestation({ ...attestation, gate: e.target.value })} required>
                  <option value="">Gate…</option>
                  {defaultGatesFor(pkg.package_type).map((g) => (
                    <option key={g} value={g}>{GATE_LABELS[g] || g}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className={label}>Statement</label>
                <input className={input} placeholder="Statement" value={attestation.statement} onChange={(e) => setAttestation({ ...attestation, statement: e.target.value })} required />
              </div>
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input type="checkbox" checked={!!attestation.notApplicable} onChange={(e) => setAttestation({ ...attestation, notApplicable: e.target.checked })} />
                N/A
              </label>
              {attestation.notApplicable && (
                <div className="flex-1">
                  <label className={label}>N/A reason</label>
                  <input className={input} placeholder="Why not applicable" value={attestation.naReason || ""} onChange={(e) => setAttestation({ ...attestation, naReason: e.target.value })} required />
                </div>
              )}
              <button type="submit" className={btnPrimary} disabled={busy}>Attest</button>
            </form>
            {attestations.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-slate-500">
                {attestations.map((a) => (
                  <li key={a.id}>
                    {new Date(a.at).toLocaleString()} — <span className="font-medium">{GATE_LABELS[a.gate] || a.gate}</span>
                    {a.not_applicable ? " (N/A)" : ""} — {a.statement}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">Scope baseline</h2>
            {freezeMessage && <p className="mt-2 rounded-lg bg-green-50 p-2 text-xs text-green-700">{freezeMessage}</p>}
            {baselines.length === 0 ? (
              <div className="mt-3">
                <p className="text-xs text-slate-500">No frozen baseline yet. Freeze an immutable version:</p>
                <textarea className={`${input} mt-2`} rows={4}
                  placeholder='[{"key": "BUNDLE-01", "description": "Pull bundle", "quantity": 1, "unit": "each"}]'
                  value={baselineItems} onChange={(e) => { setBaselineItems(e.target.value); setBaselineError(""); }} />
                {baselineError && (
                  <p role="alert" className="mt-2 flex items-start justify-between gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                    <span>{baselineError}</span>
                    <button type="button" onClick={() => setBaselineError("")} aria-label="Dismiss" className="shrink-0 font-bold">×</button>
                  </p>
                )}
                <button className={`${btnPrimary} mt-2`} onClick={onFreeze} disabled={busy}>Freeze baseline</button>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                {baselines.map((b) => (
                  <div key={b.id} className="rounded border border-slate-100 p-3 text-xs text-slate-600">
                    <span className="font-semibold">Version {b.version}</span> — frozen {new Date(b.frozen_at).toLocaleString()} — {b.membership.length} items
                    <span className="ml-2 font-mono text-slate-400">{b.membership_hash}</span>
                    {b.supersedes_id && <span className="ml-2 text-slate-400">supersedes v{b.version - 1}</span>}
                  </div>
                ))}
                <form onSubmit={onPropose} className="mt-2 space-y-2 border-t border-slate-100 pt-3">
                  <p className="text-xs font-medium text-slate-600">Propose a post-freeze change</p>
                  <select className={input} value={changeForm.changeType} onChange={(e) => setChangeForm({ ...changeForm, changeType: e.target.value })}>
                    {["addition", "removal", "substitution"].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <textarea className={input} rows={2} placeholder="Describe the change" value={changeForm.description}
                    onChange={(e) => setChangeForm({ ...changeForm, description: e.target.value })} required />
                  <button type="submit" className={btnGhost} disabled={busy}>Propose change</button>
                </form>
                {changes.length > 0 && (
                  <ul className="space-y-2">
                    {changes.map((c) => (
                      <li key={c.id} className="flex items-center justify-between rounded border border-slate-100 p-2 text-xs">
                        <span><span className="font-medium">{c.change_type}</span> — {c.description} — {c.status}</span>
                        {c.status === "proposed" && (
                          <span className="flex gap-1">
                            <button className={btnGhost} onClick={() => onDecide(c.id, true)} disabled={busy}>Approve</button>
                            <button className={btnGhost} onClick={() => onDecide(c.id, false)} disabled={busy}>Reject</button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          <WorkPackageLinks
            packageId={pkg.id}
            initialLinks={initialLinks}
            onLinksChanged={() => setCostRefreshKey((key) => key + 1)}
          />
        </div>
      )}

      {activeTab === "steps" && (
        <div className="mt-6 space-y-6">
          <WorkPackageSteps packageId={pkg.id} />
          <WorkPackageManpowerCurve packageId={pkg.id} />
          <WorkPackageCraftAssignments packageId={pkg.id} />
        </div>
      )}

      {activeTab === "milestones" && (
        <div className="mt-6 space-y-6">
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">Milestones</h2>
            <p className="mt-1 text-sm text-slate-600">
              Milestone tracking arrives with slice 9: the 14-milestone timing backbone from the
              milestone tracker, per-package planned and actual dates, percent complete, and the
              ±7-day late flag. This tab is a placeholder until that slice lands — nothing to
              fill in here yet.
            </p>
          </section>
        </div>
      )}

      {activeTab === "permits" && (
        <div className="mt-6 space-y-6">
          <WorkPackagePermitAnnotations packageId={pkg.id} scope="package" />
        </div>
      )}

      {activeTab === "redlines" && (
        <div className="mt-6 space-y-6">
          <WorkPackageDrawingReadiness packageId={pkg.id} />
        </div>
      )}

      {activeTab === "budget" && (
        <div className="mt-6 space-y-6">
          <WorkPackageBudgetPanel
            packageId={pkg.id}
            isTerminal={isTerminal}
            refreshKey={costRefreshKey}
          />
          <WorkPackageChangeOrders
            packageId={pkg.id}
            refreshKey={costRefreshKey}
            onChanged={() => setCostRefreshKey((key) => key + 1)}
          />
        </div>
      )}

      {activeTab === "documents" && (
        <div className="mt-6 space-y-6">
          <WorkPackageDocuments packageId={pkg.id} initialLinks={initialLinks} />
        </div>
      )}

      {activeTab === "activity" && (
        <div className="mt-6 space-y-6">
          {/* D20: this tab previously showed only the Danger zone, with no
             activity or audit history at all despite the tab's own name.
             The status-transition history already existed (it used to
             render under Overview -> Lifecycle) — moved here since it is
             this package's real, already-tracked activity trail. A fuller
             field-level audit log (every edit, link, attestation) is a
             larger follow-up, recorded in KNOWN_GAPS.md, not attempted in
             this fix. */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">Status history</h2>
            {transitions.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-slate-500">
                {transitions.map((t) => (
                  <li key={t.id}>
                    {new Date(t.at).toLocaleString()} — {t.from_status} → {t.to_status}
                    {t.reason ? ` — ${t.reason}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-500">No status changes recorded yet.</p>
            )}
          </section>

          {deletionEligibility?.isOwner && (
            <section aria-label="Danger zone" className="rounded-lg border border-red-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-red-700">Danger zone</h2>
              <h3 className="mt-3 text-sm font-medium text-slate-900">Delete work package</h3>
              {deletionEligibility.canDelete ? (
                <>
                  <p className="mt-1 text-sm text-slate-600">
                    This draft package has no budget, links, or history yet, so it can be
                    deleted permanently. A short audit record of the deletion is kept.
                  </p>
                  <button
                    ref={deleteTriggerRef}
                    type="button"
                    className={`${btn} mt-3 bg-red-600 text-white hover:bg-red-500`}
                    onClick={openDeleteDialog}
                  >
                    Delete work package
                  </button>
                </>
              ) : (
                <div className="mt-1 text-sm text-slate-600">
                  <p>This package can&apos;t be deleted:</p>
                  {deletionEligibility.status !== WP_STATUS.DRAFT && (
                    <p className="mt-2">
                      Only draft packages can be deleted — this package is{" "}
                      <span className="font-medium">
                        {deletionEligibility.status.replace(/_/g, " ")}
                      </span>
                      . If it is no longer needed, cancel it instead of deleting it.
                    </p>
                  )}
                  {deletionEligibility.blockers.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {deletionEligibility.blockers.map((blocker) => (
                        <li key={blocker.type}>
                          <span className="font-medium">{blocker.label}</span> ({blocker.count})
                          {" — "}
                          {blocker.action}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {!deleteOpen && deleteError && (
                <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  {deleteError}
                </p>
              )}
            </section>
          )}

          {deleteOpen && deletionEligibility?.isOwner && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
              onClick={(event) => {
                if (event.target === event.currentTarget) closeDeleteDialog();
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-package-title"
                className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
              >
                <h2 id="delete-package-title" className="text-base font-semibold text-slate-900">
                  Delete work package
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Delete <span className="font-mono font-medium">{pkg.code}</span> — {pkg.title}?
                  This permanently deletes the draft package. A short audit record (code,
                  title, who deleted it, and when) is kept. This can&apos;t be undone.
                </p>
                <div className="mt-4">
                  <label className={label} htmlFor="delete_confirm_code">
                    Type the package code ({pkg.code}) to confirm
                  </label>
                  <input
                    id="delete_confirm_code"
                    className={input}
                    value={deleteConfirmCode}
                    onChange={(event) => setDeleteConfirmCode(event.target.value)}
                    disabled={deleteBusy}
                    autoComplete="off"
                  />
                </div>
                {deleteError && (
                  <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                    {deleteError}
                  </p>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className={btnGhost}
                    onClick={closeDeleteDialog}
                    disabled={deleteBusy}
                    autoFocus
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={`${btn} bg-red-600 text-white hover:bg-red-500`}
                    onClick={onConfirmDelete}
                    disabled={deleteBusy || deleteConfirmCode !== pkg.code}
                  >
                    {deleteBusy ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
