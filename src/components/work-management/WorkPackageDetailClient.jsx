"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WP_STATUS, WP_PACKAGE_TYPES, WP_PRIORITIES, allowedTransitionsFrom, findTransition, defaultGatesFor } from "@/domains/work-management/workPackage.js";
import WorkPackageLinks from "./WorkPackageLinks.jsx";
import WorkPackageDocuments from "./WorkPackageDocuments.jsx";
import WorkPackageBudgetPanel from "./WorkPackageBudgetPanel.jsx";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const label = "block text-xs font-medium text-slate-600 mb-1";
const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const btnPrimary = `${btn} bg-slate-900 text-white hover:bg-slate-700`;
const btnGhost = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;

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
  };
}

export default function WorkPackageDetailClient({ initial, initialLinks = [] }) {
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
  const [costRefreshKey, setCostRefreshKey] = useState(0);

  const allowed = allowedTransitionsFrom(pkg);
  const target = transitionTarget ? findTransition(pkg, transitionTarget) : null;

  async function call(path, method, body) {
    setBusy(true);
    setError("");
    const response = await fetch(path, {
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
    fetch("/api/work-packages/property-options")
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
    let membership;
    try {
      membership = JSON.parse(baselineItems);
    } catch {
      setError("Scope items must be valid JSON: an array of {key, description, quantity, unit}.");
      return;
    }
    const { response, data } = await call(`/api/work-packages/${pkg.id}/scope`, "POST", { action: "freeze", membership });
    if (response.ok) {
      setBaselines((prev) => [...prev, data.baseline].sort((a, b) => a.version - b.version));
      setBaselineItems("");
      refresh();
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
    <div className="mt-6 space-y-6">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

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
            <Field title="Planned start" value={pkg.planned_start} />
            <Field title="Planned finish" value={pkg.planned_finish} />
            <Field title="Actual start" value={pkg.actual_start} />
            <Field title="Actual finish" value={pkg.actual_finish} />
            <Field title="Progress" value={pkg.percent_complete != null ? `${pkg.percent_complete}% (${pkg.progress_basis || "unknown basis"})` : "unknown"} />
            <Field title="Equipment tag" value={pkg.equipment_tag} />
            <Field title="Unit / Area / System" value={[pkg.unit, pkg.area, pkg.system].filter(Boolean).join(" / ") || null} />
            <Field title="Work order ref" value={pkg.work_order_ref} />
          </dl>
        )}
        {pkg.description && !editing && <p className="mt-4 text-sm text-slate-600">{pkg.description}</p>}
      </section>

      <WorkPackageBudgetPanel
        packageId={pkg.id}
        isTerminal={isTerminal}
        refreshKey={costRefreshKey}
      />

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
        {transitions.length > 0 && (
          <ul className="mt-4 space-y-1 text-xs text-slate-500">
            {transitions.map((t) => (
              <li key={t.id}>
                {new Date(t.at).toLocaleString()} — {t.from_status} → {t.to_status}
                {t.reason ? ` — ${t.reason}` : ""}
              </li>
            ))}
          </ul>
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

      <WorkPackageLinks
        packageId={pkg.id}
        initialLinks={initialLinks}
        onLinksChanged={() => setCostRefreshKey((key) => key + 1)}
      />

      <WorkPackageDocuments packageId={pkg.id} initialLinks={initialLinks} />

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Scope baseline</h2>
        {baselines.length === 0 ? (
          <div className="mt-3">
            <p className="text-xs text-slate-500">No frozen baseline yet. Freeze an immutable version:</p>
            <textarea className={`${input} mt-2`} rows={4}
              placeholder='[{"key": "BUNDLE-01", "description": "Pull bundle", "quantity": 1, "unit": "each"}]'
              value={baselineItems} onChange={(e) => setBaselineItems(e.target.value)} />
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
    </div>
  );
}
