// Work Package Planner — planning-process steps (Josh's Packaged
// Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20).
//
// The 22-step build checklist for one work package, in PDF order: 11
// weighted steps earning progress (credits sum 100%, 40 MHRS standard)
// and 11 reporting-only steps (0% / 0h, labeled "Reporting only").
// Percent complete is computed server-side from the earned steps
// (weighted sum against the fixed denominator 100) — never typed in.
// Reviewed, N/A and Needs Revision require the reviewer capability;
// In-Progress and Complete require the update capability. A reviewer
// without update can still send a step back; a planner without
// review cannot mark a step Reviewed, N/A or Needs Revision. The
// existing free-form execution steps live on the Work steps tab;
// this tab is the *build* checklist.
//
// F2: a status change is confirmed in an inline panel, never on the
// bare dropdown — the panel collects what the transition needs
// (reason for N/A / Needs Revision; evidence link or completion
// attestation for Complete; fresh evidence on a return from Needs
// Revision; an optional reason for Reviewed, which an owner override
// needs when reviewing their own submission). The change is sent with
// the row's expected version and a fresh request ID, and the success
// message appears only after the checklist is re-read — never before
// the committed write.
//
// F1: planning percent is planning progress ONLY. The header shows
// "Planning 100% — construction readiness not established" at 100%,
// and the standing note that planning percent never authorizes
// construction or releases an IFC drawing. A Complete on the IFC
// step is planning progress only.
//
// Status history sits behind a button, closed by default (secondary
// panels default closed) and is only fetched when opened.

"use client";

import { useEffect, useState } from "react";
import { withWorkspaceQuery } from "./workspaceQuery.js";
import {
  PLANNING_PROCESS_STATUSES,
  complexityLabel,
  scaledMhrs,
  validatePlanningStatusChange,
} from "@/domains/work-management/planningProcess.js";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
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

function formatWhen(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

// Event times are UTC (F2: the audit carries UTC time).
function formatWhenUtc(value) {
  if (!value) return "—";
  try {
    return `${new Date(value).toISOString().replace("T", " ").slice(0, 19)} UTC`;
  } catch {
    return String(value);
  }
}

function StepHistory({ packageId, checklist }) {
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState(1);
  const [revisions, setRevisions] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const PAGE_SIZE = 50;

  const templateByKey = new Map((checklist?.template || []).map((t) => [t.stepKey, t]));
  function stepNameFor(revision) {
    if (revision.action === "complexity_change") return "Planning complexity";
    if (revision.action === "complexity_noop") return "Planning complexity (confirmed, no change)";
    if (revision.templateStepId) {
      return templateByKey.get(revision.templateStepId)?.name || revision.templateStepId;
    }
    return "Unknown step";
  }

  async function load(pageCount) {
    setLoading(true);
    setError("");
    try {
      const all = [];
      for (let page = 0; page < pageCount; page += 1) {
        const body = await api(
          `/api/work-packages/${packageId}/planning-process/revisions?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
        );
        all.push(...(body.revisions || []));
        if ((body.revisions || []).length < PAGE_SIZE) break;
      }
      setRevisions(all);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && revisions === null) load(pages);
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Status history</h2>
        <button type="button" className={btnGhost} onClick={toggle} aria-expanded={open}>
          {open ? "Hide history" : "Show history"}
        </button>
      </div>
      {open && (
        <div className="mt-3">
          {loading && revisions === null && <p className="text-xs text-slate-500">Loading history…</p>}
          {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
          {revisions !== null && revisions.length === 0 && (
            <p className="text-xs text-slate-500">No status changes recorded yet.</p>
          )}
          {revisions !== null && revisions.length > 0 && (
            <>
              <ul className="space-y-2 text-xs text-slate-600">
                {revisions.map((revision) => (
                  <li key={revision.id}>
                    <span className="font-medium text-slate-800">{formatWhenUtc(revision.recordedAt)} — {stepNameFor(revision)}</span>
                    {revision.action === "complexity_change" || revision.action === "complexity_noop" ? (
                      <>
                        {": planning complexity "}
                        {revision.oldValues?.planning_complexity || "—"} → {revision.newValues?.planning_complexity || "—"}
                      </>
                    ) : (
                      <>
                        {": "}{revision.oldStatus || "—"} → {revision.newStatus || "—"}
                        {revision.isOverride ? " (owner override)" : ""}
                        {revision.reason ? ` — reason: ${revision.reason}` : ""}
                        {revision.evidenceReference ? ` — evidence: ${revision.evidenceReference}` : ""}
                        {revision.attestation ? ` — attestation: ${revision.attestation}` : ""}
                      </>
                    )}
                    <span className="text-slate-400"> (by {revision.actorId || "—"})</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={`${btnGhost} mt-3`}
                onClick={() => { const next = pages + 1; setPages(next); load(next); }}
                disabled={loading}
              >
                Show more
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export default function WorkPackagePlanningProcess({ packageId }) {
  const [checklist, setChecklist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [evidenceDrafts, setEvidenceDrafts] = useState({});
  // The pending change panel: { stepKey, status, reason, attestation,
  // evidenceLink }. Opened by picking a status in a row's dropdown;
  // nothing is written until Confirm.
  const [pending, setPending] = useState(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const body = await api(`/api/work-packages/${packageId}/planning-process`);
      if (body.notApplied) {
        setChecklist({ notApplied: true });
        return;
      }
      setChecklist(body.checklist);
      setEvidenceDrafts(Object.fromEntries(
        (body.checklist.instances || []).map((i) => [i.templateStepId, i.evidenceLink || ""]),
      ));
    } catch (caught) {
      setError(caught.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [packageId]);

  function openChange(step, newStatus) {
    const instance = (checklist?.instances || []).find((i) => i.templateStepId === step.stepKey);
    if (!instance || instance.status === newStatus) return;
    // Returning from Needs Revision needs FRESH evidence supplied in
    // this request: start the field empty so the stored link cannot
    // be re-confirmed without the user actively supplying it.
    // A review decision takes NO new evidence (it judges what is
    // already on the step), so a Reviewed change also starts empty —
    // an owner override types a link in deliberately.
    const needsFresh = (instance.status === "Needs Revision"
      && (newStatus === "Complete" || newStatus === "Reviewed"))
      || newStatus === "Reviewed";
    setPending({
      stepKey: step.stepKey,
      status: newStatus,
      reason: "",
      attestation: "",
      evidenceLink: needsFresh ? "" : (instance.evidenceLink || ""),
    });
    setError("");
    setMessage("");
  }

  async function confirmChange() {
    if (!pending) return;
    const step = (checklist?.template || []).find((t) => t.stepKey === pending.stepKey);
    const instance = (checklist?.instances || []).find((i) => i.templateStepId === pending.stepKey);
    if (!step || !instance) return;
    setSavingId(step.stepKey);
    setError("");
    setMessage("");
    try {
      await api(`/api/work-packages/${packageId}/planning-process`, {
        method: "PATCH",
        body: JSON.stringify({
          templateStepId: step.stepKey,
          status: pending.status,
          // An empty evidence field means "unchanged" — never "clear".
          // Clearing a link is done in the row's own evidence input.
          evidenceLink: pending.evidenceLink || undefined,
          reason: pending.reason || undefined,
          attestation: pending.attestation || undefined,
          expectedVersion: instance.version,
          requestId: crypto.randomUUID(),
        }),
      });
      const body = await api(`/api/work-packages/${packageId}/planning-process`);
      setChecklist(body.checklist);
      setPending(null);
      setMessage(
        `Step "${step.name}" marked ${pending.status} — planning progress is now ${body.checklist.progress.percentComplete}%.`,
      );
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSavingId(null);
    }
  }

  async function saveEvidence(step) {
    const draft = (evidenceDrafts[step.stepKey] || "").trim();
    const instance = (checklist?.instances || []).find((i) => i.templateStepId === step.stepKey);
    if (!instance || draft === (instance.evidenceLink || "")) return;
    setSavingId(step.stepKey);
    setError("");
    setMessage("");
    try {
      await api(`/api/work-packages/${packageId}/planning-process`, {
        method: "PATCH",
        body: JSON.stringify({
          templateStepId: step.stepKey,
          status: instance.status,
          evidenceLink: draft,
          expectedVersion: instance.version,
          requestId: crypto.randomUUID(),
        }),
      });
      const body = await api(`/api/work-packages/${packageId}/planning-process`);
      setChecklist(body.checklist);
      setEvidenceDrafts((prev) => ({ ...prev, [step.stepKey]: draft }));
      setMessage(`Evidence link saved for "${step.name}".`);
    } catch (caught) {
      setError(caught.message);
      setEvidenceDrafts((prev) => ({ ...prev, [step.stepKey]: instance.evidenceLink || "" }));
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <p className="text-sm text-slate-500">Loading planning-process checklist…</p>
      </section>
    );
  }

  if (error && !checklist) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
        <button type="button" className={`${btnPrimary} mt-3`} onClick={load}>Try again</button>
      </section>
    );
  }

  if (!checklist || checklist.notApplied) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Planning Checklist</h2>
        <p className="mt-1 text-sm text-slate-600">
          Planning-process steps aren&apos;t available yet — the database change for this feature hasn&apos;t been applied.
        </p>
      </section>
    );
  }

  const { template, instances, progress, complexity, canUpdate, canReview, isOwner, constructionReadiness, templateVersion } = checklist;
  const instanceByStep = new Map(instances.map((i) => [i.templateStepId, i]));
  const steps = [...template].sort((a, b) => a.sortOrder - b.sortOrder);

  function panelError() {
    if (!pending) return null;
    const instance = instanceByStep.get(pending.stepKey);
    if (!instance) return "Step not found.";
    return validatePlanningStatusChange({
      status: pending.status,
      canUpdate,
      canReview,
      oldStatus: instance.status,
      storedEvidenceLink: instance.evidenceLink,
      newEvidenceLink: pending.evidenceLink,
      reason: pending.reason,
      attestation: pending.attestation,
      isOwner: isOwner ?? false,
    });
  }

  // Per-option gating (fix round 1, F3): In-Progress/Complete need
  // the update capability; N/A, Reviewed and Needs Revision need
  // the review capability. The dropdown itself is enabled when the
  // caller has either.
  function optionDisabled(statusValue) {
    if (statusValue === "Reviewed" || statusValue === "N/A" || statusValue === "Needs Revision") {
      return !canReview;
    }
    return !canUpdate;
  }

  function renderRows() {
    return steps.map((step) => {
      const instance = instanceByStep.get(step.stepKey);
      const mhrs = scaledMhrs(step.mhrsStandard, complexity);
      const isPending = pending?.stepKey === step.stepKey;
      const err = isPending ? panelError() : null;
      return (
        <tr key={step.stepKey} className="border-t border-slate-100 align-top">
          <td className="px-3 py-2 text-sm text-slate-500">{step.stepNumber}</td>
          <td className="px-3 py-2">
            <p className="text-sm font-medium text-slate-900">
              {step.name}
              {step.creditPct === 0 && (
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">Reporting only</span>
              )}
            </p>
            <p className="text-xs text-slate-500">{step.description}</p>
          </td>
          <td className="px-3 py-2 text-sm text-slate-600">{step.role || "—"}</td>
          <td className="px-3 py-2 text-sm text-slate-600">{step.creditPct === 0 ? "—" : `${step.creditPct}%`}</td>
          <td className="px-3 py-2 text-sm text-slate-600">{mhrs == null ? "—" : `${mhrs}`}</td>
          <td className="px-3 py-2">
            <select
              className={input}
              aria-label={`Status for ${step.name}`}
              value={instance?.status || "In-Progress"}
              disabled={(!canUpdate && !canReview) || savingId === step.stepKey}
              onChange={(e) => openChange(step, e.target.value)}
            >
              {PLANNING_PROCESS_STATUSES.map((s) => (
                <option
                  key={s.value}
                  value={s.value}
                  disabled={optionDisabled(s.value)}
                  title={optionDisabled(s.value)
                    ? (s.value === "Reviewed" || s.value === "N/A" || s.value === "Needs Revision"
                      ? "Only a reviewer can record this change."
                      : "Only a planner can record this change.")
                    : undefined}
                >
                  {s.label}
                </option>
              ))}
            </select>
            {isPending && (
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid={`change-panel-${step.stepKey}`}>
                <p className="text-xs font-medium text-slate-800">
                  Change to {pending.status}
                  {instance.status === "Needs Revision" && pending.status === "Complete" && (
                    <> — fresh evidence is needed after a send-back</>
                  )}
                </p>
                {(pending.status === "N/A" || pending.status === "Needs Revision") && (
                  <label className="mt-2 block text-xs text-slate-600">
                    Reason (required)
                    <input
                      className={`${input} mt-1`}
                      aria-label={`Reason for ${step.name}`}
                      placeholder={pending.status === "N/A" ? "Why does this step not apply?" : "What needs to change?"}
                      value={pending.reason}
                      onChange={(e) => setPending({ ...pending, reason: e.target.value })}
                    />
                  </label>
                )}
                {(pending.status === "Complete" || pending.status === "Reviewed") && (
                  <>
                    {pending.status === "Complete" && (
                      <>
                        <label className="mt-2 block text-xs text-slate-600">
                          Evidence link (or an attestation below)
                          <input
                            className={`${input} mt-1`}
                            aria-label={`Change evidence link for ${step.name}`}
                            placeholder="Link to the evidence"
                            value={pending.evidenceLink}
                            onChange={(e) => setPending({ ...pending, evidenceLink: e.target.value })}
                          />
                        </label>
                        <label className="mt-2 block text-xs text-slate-600">
                          Completion attestation (instead of a link)
                          <input
                            className={`${input} mt-1`}
                            aria-label={`Attestation for ${step.name}`}
                            placeholder="What was completed, in your own words"
                            value={pending.attestation}
                            onChange={(e) => setPending({ ...pending, attestation: e.target.value })}
                          />
                        </label>
                      </>
                    )}
                    {pending.status === "Reviewed" && isOwner && (
                      <>
                        <label className="mt-2 block text-xs text-slate-600">
                          Evidence link (owner override — replaces the stored link)
                          <input
                            className={`${input} mt-1`}
                            aria-label={`Change evidence link for ${step.name}`}
                            placeholder="Link to the evidence"
                            value={pending.evidenceLink}
                            onChange={(e) => setPending({ ...pending, evidenceLink: e.target.value })}
                          />
                        </label>
                        <label className="mt-2 block text-xs text-slate-600">
                          Completion attestation (owner override)
                          <input
                            className={`${input} mt-1`}
                            aria-label={`Attestation for ${step.name}`}
                            placeholder="What was completed, in your own words"
                            value={pending.attestation}
                            onChange={(e) => setPending({ ...pending, attestation: e.target.value })}
                          />
                        </label>
                      </>
                    )}
                    {pending.status === "Reviewed" && !isOwner && (
                      <p className="mt-2 text-xs text-slate-500">
                        The review uses the evidence already on this step — a review cannot add new evidence.
                        {instance.evidenceLink ? ` Stored evidence: ${instance.evidenceLink}` : " No evidence is stored on this step yet."}
                      </p>
                    )}
                  </>
                )}
                {pending.status === "Reviewed" && (
                  <label className="mt-2 block text-xs text-slate-600">
                    Reason (optional — needed only for an owner override of your own submission)
                    <input
                      className={`${input} mt-1`}
                      aria-label={`Review reason for ${step.name}`}
                      placeholder="Why you are reviewing this step"
                      value={pending.reason}
                      onChange={(e) => setPending({ ...pending, reason: e.target.value })}
                    />
                  </label>
                )}
                {err && <p role="alert" className="mt-2 text-xs text-red-700">{err}</p>}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={!!err || savingId === step.stepKey}
                    onClick={confirmChange}
                  >
                    {savingId === step.stepKey ? "Saving…" : "Confirm change"}
                  </button>
                  <button type="button" className={btnGhost} onClick={() => setPending(null)} disabled={savingId === step.stepKey}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </td>
          <td className="px-3 py-2">
            <input
              className={input}
              aria-label={`Evidence link for ${step.name}`}
              placeholder="Link (optional)"
              value={evidenceDrafts[step.stepKey] ?? ""}
              disabled={!canUpdate || savingId === step.stepKey}
              onChange={(e) => setEvidenceDrafts((prev) => ({ ...prev, [step.stepKey]: e.target.value }))}
              onBlur={() => saveEvidence(step)}
              onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
            />
          </td>
          <td className="px-3 py-2 text-xs text-slate-600">
            {instance?.reviewedAt ? `Reviewed ${formatWhen(instance.reviewedAt)}` : "—"}
          </td>
        </tr>
      );
    });
  }

  return (
    <div className="space-y-6">
      {message && (
        <p role="status" className="flex items-start justify-between gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700">
          <span>{message}</span>
          <button type="button" onClick={() => setMessage("")} aria-label="Dismiss" className="shrink-0 font-bold">×</button>
        </p>
      )}
      {error && checklist && (
        <p role="alert" className="flex items-start justify-between gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label="Dismiss" className="shrink-0 font-bold">×</button>
        </p>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-5" aria-label="Planning progress">
        <h2 className="text-sm font-semibold text-slate-900">Planning progress</h2>
        <p className="mt-2 text-3xl font-bold text-slate-900">{progress.percentComplete}%</p>
        <p className="mt-1 text-sm text-slate-600">
          Earned {progress.earnedMhrs} of {progress.totalMhrs} planning hours
          {" "}({progress.earnedCreditPct}% of 100% credit).
        </p>
        {progress.percentComplete === 100 ? (
          <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm font-medium text-amber-800">
            Planning 100% — construction readiness not established.
          </p>
        ) : (
          <p className="mt-2 text-xs text-slate-500">
            Planning percent is planning progress only — it never authorizes construction or releases an IFC drawing.
          </p>
        )}
        <p className="mt-1 text-xs text-slate-500">
          Complexity: {complexityLabel(complexity)} ({progress.totalMhrs} planning hours) — change it under Overview → Edit.
          {" "}Template version {templateVersion}.
          {" "}N/A {progress.stepsByStatus["N/A"] || 0} · Complete {progress.stepsByStatus.Complete || 0} · Reviewed {progress.stepsByStatus.Reviewed || 0} · In-Progress {progress.stepsByStatus["In-Progress"] || 0} · Needs Revision {progress.stepsByStatus["Needs Revision"] || 0}.
        </p>
        {constructionReadiness && constructionReadiness.status === "not_established" && progress.percentComplete !== 100 && (
          <p className="mt-1 text-xs text-slate-500">{constructionReadiness.detail}</p>
        )}
        {!canUpdate && !canReview && (
          <p className="mt-2 text-xs text-slate-500">
            You can view this checklist but not change it — your role doesn&apos;t include changing planning-process steps.
          </p>
        )}
        {canUpdate && !canReview && (
          <p className="mt-2 text-xs text-slate-500">
            You can change statuses, but only a reviewer can mark a step Reviewed, N/A, or Needs Revision.
          </p>
        )}
        {canReview && !canUpdate && (
          <p className="mt-2 text-xs text-slate-500">
            You can review steps, but only a planner can mark a step In-Progress or Complete.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Planning Checklist — Detailed Work Package Planning</h2>
        <p className="mt-1 text-xs text-slate-500">
          The 22 steps from the Packaged Planning Process, in order. Percent complete is the weighted sum of
          the steps in N/A, Complete, or Reviewed — In-Progress and Needs Revision earn nothing.
          Steps labeled “Reporting only” carry 0% credit and 0 planning hours.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[56rem] text-left">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Step</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Credit</th>
                <th className="px-3 py-2 font-medium">Hours</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Evidence link</th>
                <th className="px-3 py-2 font-medium">Reviewed</th>
              </tr>
            </thead>
            <tbody>{renderRows()}</tbody>
          </table>
        </div>
      </section>

      <StepHistory packageId={packageId} checklist={checklist} />
    </div>
  );
}
