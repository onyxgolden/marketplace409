"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WP_STATUS, WP_PACKAGE_TYPES, WP_PRIORITIES, allowedTransitionsFrom, findTransition } from "@/domains/work-management/workPackage.js";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const label = "block text-xs font-medium text-slate-600 mb-1";
const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const btnPrimary = `${btn} bg-slate-900 text-white hover:bg-slate-700`;
const btnGhost = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;

function Field({ title, value }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{title}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value ?? "—"}</dd>
    </div>
  );
}

export default function WorkPackageDetailClient({ initial }) {
  const router = useRouter();
  const [pkg, setPkg] = useState(initial.package);
  const [transitions, setTransitions] = useState(initial.transitions);
  const [attestations, setAttestations] = useState(initial.attestations);
  const [baselines, setBaselines] = useState(initial.baselines);
  const [changes, setChanges] = useState(initial.scopeChanges);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: pkg.title, description: pkg.description || "", planned_finish: pkg.planned_finish || "" });
  const [transitionTarget, setTransitionTarget] = useState("");
  const [transitionCtx, setTransitionCtx] = useState("");
  const [attestation, setAttestation] = useState({ gate: "", statement: "" });
  const [baselineItems, setBaselineItems] = useState("");
  const [changeForm, setChangeForm] = useState({ changeType: "addition", description: "" });

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

  async function refresh() {
    const { response, data } = await call(`/api/work-packages/${pkg.id}`, "GET");
    if (!response.ok) return;
    setPkg(data.package);
    setTransitions(data.transitions);
    setAttestations(data.attestations);
    setBaselines(data.baselines);
    setChanges(data.scopeChanges);
    setEditForm({ title: data.package.title, description: data.package.description || "", planned_finish: data.package.planned_finish || "" });
    setEditing(false);
    setTransitionTarget("");
    setTransitionCtx("");
    router.refresh();
  }

  async function onSaveEdit(event) {
    event.preventDefault();
    const { response } = await call(`/api/work-packages/${pkg.id}`, "PATCH", editForm);
    if (response.ok) refresh();
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
      setAttestation({ gate: "", statement: "" });
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
            <button className={btnGhost} onClick={() => setEditing(true)} disabled={busy}>Edit</button>
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
              <label className={label}>Planned finish</label>
              <input type="date" className={input} value={editForm.planned_finish} onChange={(e) => setEditForm({ ...editForm, planned_finish: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <button type="submit" className={btnPrimary} disabled={busy}>Save</button>
              <button type="button" className={btnGhost} onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field title="Title" value={pkg.title} />
            <Field title="Type" value={pkg.package_type?.replace(/_/g, " ")} />
            <Field title="Priority" value={pkg.priority} />
            <Field title="Responsible party" value={pkg.responsible_party?.display_name} />
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
                  placeholder='Context as JSON, e.g. {"userConfirmedStart": true}'
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
        <form onSubmit={onAttest} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select className={`${input} sm:w-40`} value={attestation.gate} onChange={(e) => setAttestation({ ...attestation, gate: e.target.value })} required>
            <option value="">Gate…</option>
            {["scope_frozen", "drawings", "materials", "permits", "crew", "equipment", "access", "safety", "quality", "logistics", "stakeholders", "schedule"].map((g) => (
              <option key={g} value={g}>{g.replace(/_/g, " ")}</option>
            ))}
          </select>
          <input className={`${input} flex-1`} placeholder="Statement" value={attestation.statement} onChange={(e) => setAttestation({ ...attestation, statement: e.target.value })} required />
          <button type="submit" className={btnPrimary} disabled={busy}>Attest</button>
        </form>
        {attestations.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-slate-500">
            {attestations.map((a) => (
              <li key={a.id}>
                {new Date(a.at).toLocaleString()} — <span className="font-medium">{a.gate.replace(/_/g, " ")}</span>
                {a.not_applicable ? " (N/A)" : ""} — {a.statement}
              </li>
            ))}
          </ul>
        )}
      </section>

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
