// Work Package Planner — Field verification for one work package:
// the dated, evidence-backed human attestation that a portion of
// planned work was physically checked against a named plan and the
// recorded actuals. One record per observation, primary target one
// work step, secondary one takeoff line; the source snapshot is
// taken server-side at create time and the submit/accept RPCs
// recompute the source fingerprint live and refuse when stale.
//
// READ AND ANNOTATE ONLY — nothing here locks, recalculates,
// corrects, voids, creates or changes slice-2 progress; never
// creates/closes/dispositions busts; never approves change orders
// or re-baselines; nothing is gated by this slice. A linked OPEN
// bust stays OPEN: linking never closes a bust.
//
// Every save shows its confirmation inline beside the action that
// produced it (the slice-7 placement rule); every label names its
// target in plain words (step title, drawing number + line
// quantity), never a raw id.
"use client";

import { useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { usePageQuery, usePackagePageContext } from "./packagePageContext.jsx";
import { scopedSWRKey } from "./workspaceQuery.js";
import { ActionConfirmation } from "./WorkPackageDrawingReadiness.jsx";
import {
  FIELD_VERIFICATION_PHYSICAL_COMPLETIONS,
  FIELD_VERIFICATION_STATUSES,
} from "@/domains/work-management/fieldVerifications";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const label = "block text-xs font-medium text-slate-600 mb-1";
const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const btnPrimary = `${btn} bg-slate-900 text-white hover:bg-slate-700`;
const btnGhost = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;
const btnDanger = `${btn} border border-red-300 text-red-700 hover:bg-red-50`;

const STATUS_LABELS = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  ACCEPTED: "Accepted",
  RETURNED: "Returned",
  REJECTED: "Rejected",
  RETIRED: "Retired",
};

const COMPLETION_LABELS = {
  NOT_COMPLETE: "Not complete",
  PARTIALLY_COMPLETE: "Partially complete",
  COMPLETE: "Complete",
  UNABLE_TO_VERIFY: "Unable to verify",
};

const SOURCE_STATUS_LABELS = {
  CURRENT: "Current",
  CHANGED_SINCE_REVIEW: "Changed since review",
  TARGET_RETIRED: "Target retired",
};

const LINK_KIND_LABELS = {
  BUST: "Bust",
  CHANGE_ORDER: "Change order",
  PROGRESS_ENTRY: "Progress entry",
  DRAWING: "Drawing",
};

const REVISION_ACTION_LABELS = {
  create: "Recorded",
  update: "Correction",
  submit: "Submitted",
  accept: "Accepted",
  return: "Returned",
  reject: "Rejected",
  retire: "Retired",
  link: "Link added",
  unlink: "Link retired",
};

const TERMINAL_PACKAGE_STATUSES = ["cancelled", "verified_closed"];

async function api(pageQuery, path, options) {
  const response = await fetch(pageQuery(path), {
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

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return String(value);
  }
}

function formatNumber(value) {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : String(value);
}

function statusBadge(status) {
  const tone = status === "DRAFT"
    ? "bg-slate-100 text-slate-700"
    : status === "SUBMITTED"
      ? "bg-blue-100 text-blue-800"
      : status === "ACCEPTED"
        ? "bg-emerald-100 text-emerald-800"
        : status === "RETURNED"
          ? "bg-amber-100 text-amber-800"
          : status === "REJECTED"
            ? "bg-red-100 text-red-800"
            : "bg-slate-100 text-slate-500";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${tone}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function sourceStatusBadge(sourceStatus) {
  if (!sourceStatus) return null;
  const tone = sourceStatus === "CURRENT"
    ? "bg-emerald-100 text-emerald-800"
    : sourceStatus === "CHANGED_SINCE_REVIEW"
      ? "bg-amber-100 text-amber-800"
      : "bg-slate-100 text-slate-500";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${tone}`}>
      {SOURCE_STATUS_LABELS[sourceStatus] ?? sourceStatus}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Read-only verification badges for the step rows and the takeoff
// progress lines. useFieldVerificationBadges fetches the per-package
// badge map once (SWR-cached by key, so the steps view, the takeoff
// view, and this panel share one fetch). FieldVerificationBadge
// renders nothing when there is no active verification for the key —
// a badge is a flag, never a blocker.
// ---------------------------------------------------------------------------

export function useFieldVerificationBadges(packageId) {
  const pageQuery = usePageQuery();
  const pageContext = usePackagePageContext();
  const { data } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "field-verifications", "badges"),
    () => api(pageQuery, `/api/work-packages/${packageId}/field-verifications/badges`),
    { ttlMs: 10_000 },
  );
  return data ?? { byWorkStep: {}, byTakeoffLine: {} };
}

export function FieldVerificationBadge({ badge }) {
  if (!badge || badge.count < 1) return null;
  const statuses = (badge.statuses ?? []).map((s) => STATUS_LABELS[s] ?? s).join(", ");
  return (
    <span
      className="ml-2 inline-flex items-center rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800"
      title={statuses ? `Field verifications: ${statuses}` : "Field verifications"}
    >
      ✓ {badge.count} verification{badge.count === 1 ? "" : "s"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Package-header summary counts: Submitted / Accepted / Returned /
// Rejected and Changed since review. The counts come from the list
// endpoint's package-wide summary (the same SWR key the panel uses
// with default filters, so the header and the panel share one
// fetch). The counts never imply a "percent verified" — a package
// is not verified by counting steps.
// ---------------------------------------------------------------------------

export function FieldVerificationSummary({ packageId, onNavigate }) {
  const pageQuery = usePageQuery();
  const pageContext = usePackagePageContext();
  const { data } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "field-verifications", "list", "limit=100"),
    () => api(pageQuery, `/api/work-packages/${packageId}/field-verifications?limit=100`),
    { ttlMs: 10_000 },
  );
  const summary = data?.summary ?? null;
  if (!summary) return null;
  const parts = [
    `Submitted ${summary.submitted ?? 0}`,
    `Accepted ${summary.accepted ?? 0}`,
    `Returned ${summary.returned ?? 0}`,
    `Rejected ${summary.rejected ?? 0}`,
  ];
  if (summary.changedSinceReview > 0) {
    parts.push(`Changed since review ${summary.changedSinceReview}`);
  }
  return (
    <p className="mt-2 text-xs text-slate-600">
      Field verification — {parts.join(" · ")}
      {onNavigate && summary.total > 0 && (
        <>
          {" · "}
          <button type="button" className="font-medium text-slate-900 underline" onClick={onNavigate}>
            View verifications
          </button>
        </>
      )}
    </p>
  );
}

function revisionSummary(revision) {
  const oldValues = revision.oldValues || {};
  const newValues = revision.newValues || {};
  const parts = [];
  if (oldValues.status != null && newValues.status != null && oldValues.status !== newValues.status) {
    parts.push(`${STATUS_LABELS[oldValues.status] ?? oldValues.status} → ${STATUS_LABELS[newValues.status] ?? newValues.status}`);
  }
  if (newValues.linkId) parts.push(`link ${newValues.targetKind ?? ""} ${newValues.targetId ?? ""}`.trim());
  if (revision.action === "update") parts.push("observation corrected");
  if (revision.action === "link") parts.push("link added");
  if (revision.action === "unlink") parts.push("link retired");
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function VarianceLine({ verification }) {
  if (verification.targetType === "TAKEOFF_LINE" && verification.variances) {
    const { varianceVsPlan, varianceVsRecorded } = verification.variances;
    if (varianceVsPlan === null && varianceVsRecorded === null) return null;
    return (
      <span>
        {varianceVsPlan !== null && <>vs plan {varianceVsPlan > 0 ? "+" : ""}{varianceVsPlan}</>}
        {varianceVsPlan !== null && varianceVsRecorded !== null && " · "}
        {varianceVsRecorded !== null && <>vs recorded {varianceVsRecorded > 0 ? "+" : ""}{varianceVsRecorded}</>}
      </span>
    );
  }
  if (verification.targetType === "WORK_STEP" && verification.hoursDifference) {
    const { hoursVsPlan, label } = verification.hoursDifference;
    return <span>{hoursVsPlan > 0 ? "+" : ""}{hoursVsPlan} hours vs plan ({label})</span>;
  }
  return null;
}

function hasDifference(verification) {
  if (verification.targetType === "TAKEOFF_LINE" && verification.variances) {
    const vsPlan = verification.variances.varianceVsPlan;
    const vsRecorded = verification.variances.varianceVsRecorded;
    return (vsPlan !== null && vsPlan !== 0) || (vsRecorded !== null && vsRecorded !== 0);
  }
  if (verification.targetType === "WORK_STEP" && verification.hoursDifference) {
    return verification.hoursDifference.hoursVsPlan !== 0;
  }
  return false;
}

// One recorded verification, expanded: its observation, its planned
// vs recorded vs observed figures, its append-only history (actor
// ids are never shown — the audit trail keeps them in the database;
// the UI shows what changed, why, and when), its links, and the
// review actions. Accepted facts cannot be quietly overwritten: a
// correction is a reasoned, versioned update on a DRAFT or RETURNED
// record, never an edit to an ACCEPTED one.
function FieldVerificationDetail({ packageId, verification, isTerminal, onChanged }) {
  const pageQuery = usePageQuery();
  const pageContext = usePackagePageContext();
  const [notices, setNotices] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [decisionAction, setDecisionAction] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [updating, setUpdating] = useState(false);
  const [updateForm, setUpdateForm] = useState(null);
  const [updateReason, setUpdateReason] = useState("");
  const [retiring, setRetiring] = useState(false);
  const [retireReason, setRetireReason] = useState("");
  const [linkKind, setLinkKind] = useState("BUST");
  const [linkTargetId, setLinkTargetId] = useState("");
  const [linkReason, setLinkReason] = useState("");
  const [unlinkingId, setUnlinkingId] = useState(null);
  const [unlinkReason, setUnlinkReason] = useState("");

  const { data, error: loadError, isLoading, refresh } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "field-verifications", verification.id, "detail"),
    () => api(pageQuery, `/api/work-packages/${packageId}/field-verifications/${verification.id}`),
    { ttlMs: 10_000 },
  );
  const { data: bustsData } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "busts", "list", "limit=100"),
    () => api(pageQuery, `/api/work-packages/${packageId}/busts?limit=100`),
    { ttlMs: 10_000 },
  );
  const { data: ordersData } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "change-orders", "link-picker"),
    () => api(pageQuery, `/api/work-packages/${packageId}/change-orders`),
    { ttlMs: 10_000 },
  );
  const { data: drawingsData } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "drawings", "link-picker"),
    () => api(pageQuery, `/api/work-packages/${packageId}/drawings`),
    { ttlMs: 10_000 },
  );

  const detail = data?.verification ?? verification;
  const revisions = data?.revisions ?? [];
  const links = data?.links ?? [];
  const changeOrders = ordersData?.changeOrders ?? [];
  const busts = bustsData?.busts ?? [];
  const drawings = drawingsData?.drawings ?? [];
  const isDraft = detail.status === "DRAFT" || detail.status === "RETURNED";
  const isSubmitted = detail.status === "SUBMITTED";
  const isAccepted = detail.status === "ACCEPTED";
  const isRetired = detail.status === "RETIRED";
  const sourceStale = detail.sourceStatus === "CHANGED_SINCE_REVIEW";
  const targetRetired = detail.targetRetired === true;

  const linkTargets = linkKind === "BUST"
    ? busts.map((b) => ({ id: b.id, label: `${b.targetLabel ?? "Bust"} — ${STATUS_LABELS[b.status] ?? b.status}` }))
    : linkKind === "CHANGE_ORDER"
      ? changeOrders.map((o) => ({ id: o.id, label: `Change order ${o.changeOrderNumber ?? ""} (${o.status})`.trim() }))
      : linkKind === "DRAWING"
        ? drawings.map((d) => ({ id: d.id, label: `Drawing ${d.drawingNumber ?? d.id}` }))
        : (detail.sourceProgressEntryIds ?? []).map((id) => ({ id, label: `Progress entry ${id}` }));

  async function run(actionKey, path, options, successMessage) {
    setBusy(true);
    setError("");
    try {
      const result = await api(pageQuery, path, options);
      setNotices((current) => ({ ...current, [actionKey]: successMessage(result) }));
      await refresh();
      if (onChanged) onChanged();
      return result;
    } catch (caught) {
      setError(caught.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submitDecision() {
    if (!decisionAction) return;
    const needsReviewNote = decisionAction === "accept";
    const needsReason = decisionAction === "return" || decisionAction === "reject";
    await run(
      "decision",
      `/api/work-packages/${packageId}/field-verifications/${verification.id}/decision`,
      {
        method: "POST",
        body: JSON.stringify({
          action: decisionAction,
          expectedVersion: detail.version,
          sourceFingerprint: detail.sourceFingerprint,
          reason: needsReason ? decisionReason : null,
          reviewNote: needsReviewNote ? reviewNote : null,
          requestId: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `decision-${Date.now()}`,
        }),
      },
      () => {
        if (decisionAction === "submit") return "Verification submitted for independent review.";
        if (decisionAction === "accept") return "Verification accepted — the observation stands as reviewed.";
        if (decisionAction === "return") return "Verification returned — it can be corrected and resubmitted.";
        return "Verification rejected — the observation does not stand.";
      },
    );
    setDecisionAction("");
    setDecisionReason("");
    setReviewNote("");
  }

  function startUpdate() {
    setUpdateForm({
      workLocation: detail.workLocation,
      inspectionDate: detail.inspectionDate ? String(detail.inspectionDate).slice(0, 10) : "",
      observedInstalledQuantity: detail.observedInstalledQuantity ?? "",
      observedBasis: detail.observedBasis ?? "",
      physicalCompletion: detail.physicalCompletion ?? "",
      acceptanceCriteriaChecked: detail.acceptanceCriteriaChecked ?? "",
      fieldReportedHours: detail.fieldReportedHours ?? "",
      fieldHoursSource: detail.fieldHoursSource ?? "",
      observationNote: detail.observationNote ?? "",
      evidenceRef: detail.evidenceRef ?? "",
      evidenceSummary: detail.evidenceSummary ?? "",
    });
    setUpdateReason("");
    setUpdating(true);
  }

  async function submitUpdate() {
    if (!updateForm) return;
    const setIfChanged = (key, current) => {
      const next = updateForm[key];
      const changed = String(next ?? "") !== String(current ?? "");
      return { set: changed, value: next === "" ? null : next };
    };
    const workLocation = setIfChanged("workLocation", detail.workLocation);
    const inspectionDate = setIfChanged("inspectionDate", detail.inspectionDate ? String(detail.inspectionDate).slice(0, 10) : "");
    const observedQty = setIfChanged("observedInstalledQuantity", detail.observedInstalledQuantity);
    const observedBasis = setIfChanged("observedBasis", detail.observedBasis);
    const completion = setIfChanged("physicalCompletion", detail.physicalCompletion);
    const criteria = setIfChanged("acceptanceCriteriaChecked", detail.acceptanceCriteriaChecked);
    const hours = setIfChanged("fieldReportedHours", detail.fieldReportedHours);
    const hoursSource = setIfChanged("fieldHoursSource", detail.fieldHoursSource);
    const note = setIfChanged("observationNote", detail.observationNote);
    const evidenceRef = setIfChanged("evidenceRef", detail.evidenceRef);
    const evidenceSummary = setIfChanged("evidenceSummary", detail.evidenceSummary);
    await run(
      "update",
      `/api/work-packages/${packageId}/field-verifications/${verification.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: detail.version,
          reason: updateReason,
          workLocation: workLocation.value, setWorkLocation: workLocation.set,
          inspectionDate: inspectionDate.value, setInspectionDate: inspectionDate.set,
          observedInstalledQuantity: observedQty.value === null ? null : Number(observedQty.value),
          setObservedInstalledQuantity: observedQty.set,
          observedBasis: observedBasis.value, setObservedBasis: observedBasis.set,
          physicalCompletion: completion.value || null, setPhysicalCompletion: completion.set,
          acceptanceCriteriaChecked: criteria.value, setAcceptanceCriteriaChecked: criteria.set,
          fieldReportedHours: hours.value === null ? null : Number(hours.value),
          setFieldReportedHours: hours.set,
          fieldHoursSource: hoursSource.value, setFieldHoursSource: hoursSource.set,
          observationNote: note.value, setObservationNote: note.set,
          evidenceRef: evidenceRef.value, setEvidenceRef: evidenceRef.set,
          evidenceSummary: evidenceSummary.value, setEvidenceSummary: evidenceSummary.set,
        }),
      },
      () => "Correction recorded — the version moved and the history kept the old observation.",
    );
    setUpdating(false);
    setUpdateForm(null);
    setUpdateReason("");
  }

  async function submitRetire() {
    await run(
      "retire",
      `/api/work-packages/${packageId}/field-verifications/${verification.id}/retire`,
      {
        method: "POST",
        body: JSON.stringify({ expectedVersion: detail.version, reason: retireReason }),
      },
      () => "Verification retired — it stays on file for the audit trail.",
    );
    setRetiring(false);
    setRetireReason("");
  }

  async function submitLink() {
    if (!linkTargetId) return;
    await run(
      "link",
      `/api/work-packages/${packageId}/field-verifications/${verification.id}/links`,
      {
        method: "POST",
        body: JSON.stringify({
          targetKind: linkKind,
          targetId: linkTargetId,
          reason: linkReason || null,
          requestId: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `link-${Date.now()}`,
        }),
      },
      () => "Link added — linking never changes the linked record.",
    );
    setLinkTargetId("");
    setLinkReason("");
  }

  async function submitUnlink(link) {
    await run(
      "unlink",
      `/api/work-packages/${packageId}/field-verifications/${verification.id}/links/${link.id}/retire`,
      {
        method: "POST",
        body: JSON.stringify({ expectedVersion: link.version, reason: unlinkReason }),
      },
      () => "Link retired — the verification itself is unchanged.",
    );
    setUnlinkingId(null);
    setUnlinkReason("");
  }

  if (isLoading) return <p className="mt-2 text-xs text-slate-500">Loading verification…</p>;
  if (loadError) return <p className="mt-2 text-xs text-red-600">{String(loadError)}</p>;

  const decisionReady = decisionAction === "submit"
    || (decisionAction === "accept" && reviewNote.trim())
    || ((decisionAction === "return" || decisionAction === "reject") && decisionReason.trim());

  return (
    <div className="mt-3 space-y-4 border-t border-slate-100 pt-3">
      <div className="grid gap-3 text-sm md:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-slate-500">Target</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{detail.targetLabel ?? "—"}</dd>
          <dt className="mt-2 text-xs font-medium text-slate-500">Inspected</dt>
          <dd className="mt-0.5 text-sm text-slate-900">
            {formatDate(detail.inspectionDate)} · {detail.workLocation === "SHOP" ? "Shop" : "Field"}
          </dd>
          <dt className="mt-2 text-xs font-medium text-slate-500">Source checked</dt>
          <dd className="mt-0.5 text-sm text-slate-900">
            {detail.targetType === "WORK_STEP"
              ? `Step version ${detail.sourceStepVersion ?? "—"} · planned ${formatNumber(detail.plannedStepHours)} hours`
              : `Line planned ${formatNumber(detail.plannedLineQuantity)} ${detail.unit ?? ""} · installed as of ${formatDate(detail.progressAsOf)}: ${formatNumber(detail.sourceProgressTotalQuantity)}`}
          </dd>
          {detail.targetType === "TAKEOFF_LINE" && detail.sourceDrawingRevisionId && (
            <dd className="mt-1 text-xs text-slate-500">
              Drawing revision on file
            </dd>
          )}
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-500">Recorded / Observed</dt>
          <dd className="mt-0.5 text-sm text-slate-900">
            {detail.targetType === "WORK_STEP" ? (
              <>
                {detail.physicalCompletion ? COMPLETION_LABELS[detail.physicalCompletion] ?? detail.physicalCompletion : "—"}
                {detail.fieldReportedHours != null && ` · field reported ${formatNumber(detail.fieldReportedHours)} hours`}
              </>
            ) : (
              <>Observed {formatNumber(detail.observedInstalledQuantity)} {detail.unit ?? ""} · recorded {formatNumber(detail.sourceProgressTotalQuantity)}</>
            )}
          </dd>
          <dd className="mt-1 text-sm text-slate-700">
            <VarianceLine verification={detail} />
          </dd>
          <dt className="mt-2 text-xs font-medium text-slate-500">Evidence</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{detail.observationNote || "—"}</dd>
          {detail.evidenceRef && (
            <dd className="mt-1 text-xs text-slate-500">Ref: {detail.evidenceRef}</dd>
          )}
          {detail.evidenceSummary && (
            <dd className="mt-1 text-xs text-slate-500">{detail.evidenceSummary}</dd>
          )}
          <dt className="mt-2 text-xs font-medium text-slate-500">Inspector / Reviewer</dt>
          <dd className="mt-0.5 text-sm text-slate-900">
            {detail.submittedBy ? `Submitted ${formatWhen(detail.submittedAt)}` : "Not submitted yet"}
            {detail.reviewedBy ? ` · Reviewed ${formatWhen(detail.reviewedAt)}` : ""}
          </dd>
          {detail.reviewNote && (
            <dd className="mt-1 text-xs text-slate-500">Review: {detail.reviewNote}</dd>
          )}
        </div>
      </div>

      {hasDifference(detail) && (
        <p className="text-xs text-amber-800">
          Recorded progress differs from the field observation. Review the progress entry separately.
        </p>
      )}
      {sourceStale && (
        <p className="text-xs text-amber-800">
          This observation was checked against an earlier version. Review the updated source before confirming current work.
          {" "}A newer record is required to confirm changes made after this review.
        </p>
      )}
      {targetRetired && (
        <p className="text-xs text-slate-600">
          This step has been retired. Verification history is retained.
        </p>
      )}

      <div>
        <h4 className="text-xs font-semibold text-slate-900">Links</h4>
        {links.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">Nothing linked.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs text-slate-600">
            {links.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {link.targetLabel ?? `${LINK_KIND_LABELS[link.targetKind] ?? link.targetKind}`}
                  {link.retiredAt ? " — link retired" : ""}
                </span>
                {!link.retiredAt && isDraft && !isTerminal && (
                  unlinkingId === link.id ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <input
                        className={input}
                        value={unlinkReason}
                        onChange={(event) => setUnlinkReason(event.target.value)}
                        placeholder="Reason for retiring this link"
                        aria-label="Reason for retiring this link"
                      />
                      <button className={btnDanger} disabled={busy || !unlinkReason.trim()} onClick={() => submitUnlink(link)}>
                        Retire link
                      </button>
                      <button className={btnGhost} onClick={() => { setUnlinkingId(null); setUnlinkReason(""); }}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button className={btnGhost} onClick={() => setUnlinkingId(link.id)}>Retire link</button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
        <ActionConfirmation message={notices.unlink} />
        {isDraft && !isTerminal && (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-40 flex-1">
                <label className={label} htmlFor={`link-kind-${verification.id}`}>Link a record</label>
                <select
                  id={`link-kind-${verification.id}`}
                  className={input}
                  value={linkKind}
                  onChange={(event) => { setLinkKind(event.target.value); setLinkTargetId(""); }}
                >
                  {Object.keys(LINK_KIND_LABELS).map((kind) => (
                    <option key={kind} value={kind}>{LINK_KIND_LABELS[kind]}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-48 flex-1">
                <label className={label} htmlFor={`link-target-${verification.id}`}>{LINK_KIND_LABELS[linkKind]}</label>
                <select
                  id={`link-target-${verification.id}`}
                  className={input}
                  value={linkTargetId}
                  onChange={(event) => setLinkTargetId(event.target.value)}
                >
                  <option value="">Choose…</option>
                  {linkTargets.map((target) => (
                    <option key={target.id} value={target.id}>{target.label}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-48 flex-1">
                <label className={label} htmlFor={`link-reason-${verification.id}`}>Reason (optional)</label>
                <input
                  id={`link-reason-${verification.id}`}
                  className={input}
                  value={linkReason}
                  onChange={(event) => setLinkReason(event.target.value)}
                  placeholder="Why is this record linked?"
                />
              </div>
              <button className={btnPrimary} disabled={busy || !linkTargetId} onClick={submitLink}>
                Add link
              </button>
              <ActionConfirmation message={notices.link} />
            </div>
            {linkKind === "BUST" && (
              <p className="text-xs text-slate-500">
                A bust remains open or under review until separately dispositioned.
              </p>
            )}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold text-slate-900">History</h4>
        {revisions.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">No history yet.</p>
        ) : (
          <ul className="mt-1 space-y-1 border-t border-slate-100 pt-2 text-xs text-slate-600">
            {revisions.map((revision) => (
              <li key={revision.id}>
                <span className="font-medium text-slate-900">{REVISION_ACTION_LABELS[revision.action] || revision.action}</span>
                {` — version ${revision.version} · ${formatWhen(revision.recordedAt)}`}
                {revision.reason ? ` · “${revision.reason}”` : ""}
                <span className="block text-slate-500">{revisionSummary(revision)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!isTerminal && !isRetired && (
        <div className="space-y-3 border-t border-slate-100 pt-3">
          {error && <p className="text-xs text-red-600">{error}</p>}
          {(isDraft || isSubmitted) && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                  <label className={label} htmlFor={`decision-${verification.id}`}>Review decision</label>
                  <select
                    id={`decision-${verification.id}`}
                    className={input}
                    value={decisionAction}
                    onChange={(event) => setDecisionAction(event.target.value)}
                  >
                    <option value="">Choose a decision…</option>
                    {isDraft && <option value="submit">Submit for review</option>}
                    {isSubmitted && <option value="accept">Accept</option>}
                    {isSubmitted && <option value="return">Return for correction</option>}
                    {isSubmitted && <option value="reject">Reject</option>}
                  </select>
                </div>
                {decisionAction === "accept" && (
                  <div className="min-w-48 flex-1">
                    <label className={label} htmlFor={`review-note-${verification.id}`}>Review statement (required)</label>
                    <input
                      id={`review-note-${verification.id}`}
                      className={input}
                      value={reviewNote}
                      onChange={(event) => setReviewNote(event.target.value)}
                      placeholder="What did you check before accepting?"
                    />
                  </div>
                )}
                {(decisionAction === "return" || decisionAction === "reject") && (
                  <div className="min-w-48 flex-1">
                    <label className={label} htmlFor={`decision-reason-${verification.id}`}>Reason (required)</label>
                    <input
                      id={`decision-reason-${verification.id}`}
                      className={input}
                      value={decisionReason}
                      onChange={(event) => setDecisionReason(event.target.value)}
                      placeholder="Why is this being sent back?"
                    />
                  </div>
                )}
                <button className={btnPrimary} disabled={busy || !decisionAction || !decisionReady} onClick={submitDecision}>
                  Record decision
                </button>
                <ActionConfirmation message={notices.decision} />
              </div>
              {isSubmitted && (
                <p className="text-xs text-slate-500">
                  The reviewer must be a different person than the submitter — the server enforces
                  two-person review.
                </p>
              )}
              {isDraft && sourceStale && (
                <p className="text-xs text-amber-800">
                  The source changed since this observation was recorded. Correct the inspection
                  date below to re-base the snapshot on the current source, then submit.
                </p>
              )}
            </div>
          )}
          {isDraft && (
            updating && updateForm ? (
              <div className="space-y-3 rounded-lg border border-slate-200 p-4">
                <h4 className="text-xs font-semibold text-slate-900">Correct this observation</h4>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className={label} htmlFor={`update-location-${verification.id}`}>Where was the work?</label>
                    <select
                      id={`update-location-${verification.id}`}
                      className={input}
                      value={updateForm.workLocation}
                      onChange={(event) => setUpdateForm({ ...updateForm, workLocation: event.target.value })}
                    >
                      <option value="SHOP">Shop</option>
                      <option value="FIELD">Field</option>
                    </select>
                  </div>
                  <div>
                    <label className={label} htmlFor={`update-date-${verification.id}`}>Inspection date</label>
                    <input
                      id={`update-date-${verification.id}`}
                      className={input}
                      type="date"
                      value={updateForm.inspectionDate}
                      onChange={(event) => setUpdateForm({ ...updateForm, inspectionDate: event.target.value })}
                    />
                    <p className="mt-1 text-xs text-slate-500">Changing the date re-bases the snapshot on that day&apos;s source.</p>
                  </div>
                </div>
                {detail.targetType === "TAKEOFF_LINE" ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className={label} htmlFor={`update-qty-${verification.id}`}>Observed installed quantity ({detail.unit ?? ""})</label>
                      <input
                        id={`update-qty-${verification.id}`}
                        className={input}
                        type="number"
                        step="any"
                        min="0"
                        value={updateForm.observedInstalledQuantity}
                        onChange={(event) => setUpdateForm({ ...updateForm, observedInstalledQuantity: event.target.value })}
                      />
                    </div>
                    <div>
                      <label className={label} htmlFor={`update-basis-${verification.id}`}>Observed basis</label>
                      <input
                        id={`update-basis-${verification.id}`}
                        className={input}
                        value={updateForm.observedBasis}
                        onChange={(event) => setUpdateForm({ ...updateForm, observedBasis: event.target.value })}
                        placeholder="How was the quantity counted?"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className={label} htmlFor={`update-completion-${verification.id}`}>Physical completion</label>
                      <select
                        id={`update-completion-${verification.id}`}
                        className={input}
                        value={updateForm.physicalCompletion}
                        onChange={(event) => setUpdateForm({ ...updateForm, physicalCompletion: event.target.value })}
                      >
                        {FIELD_VERIFICATION_PHYSICAL_COMPLETIONS.map((key) => (
                          <option key={key} value={key}>{COMPLETION_LABELS[key]}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={label} htmlFor={`update-criteria-${verification.id}`}>Acceptance criteria checked</label>
                      <input
                        id={`update-criteria-${verification.id}`}
                        className={input}
                        value={updateForm.acceptanceCriteriaChecked}
                        onChange={(event) => setUpdateForm({ ...updateForm, acceptanceCriteriaChecked: event.target.value })}
                        placeholder="Required when the step is complete"
                      />
                    </div>
                    <div>
                      <label className={label} htmlFor={`update-hours-${verification.id}`}>Field reported hours</label>
                      <input
                        id={`update-hours-${verification.id}`}
                        className={input}
                        type="number"
                        step="any"
                        min="0"
                        value={updateForm.fieldReportedHours}
                        onChange={(event) => setUpdateForm({ ...updateForm, fieldReportedHours: event.target.value })}
                      />
                    </div>
                    <div>
                      <label className={label} htmlFor={`update-hours-source-${verification.id}`}>Hours source</label>
                      <input
                        id={`update-hours-source-${verification.id}`}
                        className={input}
                        value={updateForm.fieldHoursSource}
                        onChange={(event) => setUpdateForm({ ...updateForm, fieldHoursSource: event.target.value })}
                        placeholder="Required when hours are reported"
                      />
                    </div>
                  </div>
                )}
                <div>
                  <label className={label} htmlFor={`update-note-${verification.id}`}>Observation note</label>
                  <textarea
                    id={`update-note-${verification.id}`}
                    className={input}
                    rows={2}
                    value={updateForm.observationNote}
                    onChange={(event) => setUpdateForm({ ...updateForm, observationNote: event.target.value })}
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className={label} htmlFor={`update-ref-${verification.id}`}>Evidence reference</label>
                    <input
                      id={`update-ref-${verification.id}`}
                      className={input}
                      value={updateForm.evidenceRef}
                      onChange={(event) => setUpdateForm({ ...updateForm, evidenceRef: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className={label} htmlFor={`update-summary-${verification.id}`}>Evidence summary</label>
                    <input
                      id={`update-summary-${verification.id}`}
                      className={input}
                      value={updateForm.evidenceSummary}
                      onChange={(event) => setUpdateForm({ ...updateForm, evidenceSummary: event.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <label className={label} htmlFor={`update-reason-${verification.id}`}>Reason for this correction (required)</label>
                  <input
                    id={`update-reason-${verification.id}`}
                    className={input}
                    value={updateReason}
                    onChange={(event) => setUpdateReason(event.target.value)}
                    placeholder="What was wrong, and what is right now?"
                  />
                </div>
                {error && <p className="text-xs text-red-600">{error}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <button className={btnPrimary} disabled={busy || !updateReason.trim()} onClick={submitUpdate}>
                    Record correction
                  </button>
                  <button className={btnGhost} onClick={() => { setUpdating(false); setUpdateForm(null); setUpdateReason(""); }}>
                    Cancel
                  </button>
                  <ActionConfirmation message={notices.update} />
                </div>
              </div>
            ) : (
              <button className={btnGhost} onClick={startUpdate}>Correct this observation</button>
            )
          )}
          {isAccepted && (
            <p className="text-xs text-slate-500">
              Accepted — the observation stands as reviewed. It can be retired, but not edited.
            </p>
          )}
          {retiring ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1">
                <label className={label} htmlFor={`retire-reason-${verification.id}`}>Reason for retiring this verification</label>
                <input
                  id={`retire-reason-${verification.id}`}
                  className={input}
                  value={retireReason}
                  onChange={(event) => setRetireReason(event.target.value)}
                  placeholder="Why is this verification retired? It stays on file."
                />
              </div>
              <button className={btnDanger} disabled={busy || !retireReason.trim()} onClick={submitRetire}>
                Retire verification
              </button>
              <button className={btnGhost} onClick={() => { setRetiring(false); setRetireReason(""); }}>
                Cancel
              </button>
              <ActionConfirmation message={notices.retire} />
            </div>
          ) : (
            <button className={btnDanger} onClick={() => setRetiring(true)}>Retire verification</button>
          )}
        </div>
      )}
      {isRetired && (
        <p className="text-xs text-slate-500">
          Retired — this verification stays on file for the audit trail and cannot be changed.
        </p>
      )}
    </div>
  );
}

// Record a new observation. The target picker is a step or a
// takeoff line; the sources endpoint previews the exact source the
// observation will be checked against (step version + planned hours,
// or line planned quantity + installed-as-of + latest drawing
// revision) and returns the fingerprint the create call must pass
// back — the client never computes a fingerprint. The server takes
// the snapshot itself, so the form's figures are the human's
// observation, never authoritative plan math.
function RecordFieldVerificationForm({ packageId, preset, onRecorded }) {
  const pageQuery = usePageQuery();
  const pageContext = usePackagePageContext();
  const [open, setOpen] = useState(false);
  const [targetType, setTargetType] = useState(preset?.targetType ?? "WORK_STEP");
  const [targetId, setTargetId] = useState(preset?.targetId ?? "");
  const [workLocation, setWorkLocation] = useState("FIELD");
  const [inspectionDate, setInspectionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sourceCheckedAt, setSourceCheckedAt] = useState(() => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  });
  const [observedInstalledQuantity, setObservedInstalledQuantity] = useState("");
  const [observedBasis, setObservedBasis] = useState("");
  const [physicalCompletion, setPhysicalCompletion] = useState("PARTIALLY_COMPLETE");
  const [acceptanceCriteriaChecked, setAcceptanceCriteriaChecked] = useState("");
  const [fieldReportedHours, setFieldReportedHours] = useState("");
  const [fieldHoursSource, setFieldHoursSource] = useState("");
  const [observationNote, setObservationNote] = useState("");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [evidenceSummary, setEvidenceSummary] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  // A deep-link from a step row or a takeoff line re-targets the
  // form; the same prev-pattern the panel uses for initialFilter.
  const [prevPreset, setPrevPreset] = useState(preset);
  if (preset !== prevPreset) {
    setPrevPreset(preset);
    if (preset?.targetType) setTargetType(preset.targetType);
    setTargetId(preset?.targetId ?? "");
  }

  const { data: stepsData } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "work-steps", "list", "limit=100"),
    () => api(pageQuery, `/api/work-packages/${packageId}/work-steps?includeRetired=false&limit=100`),
    { ttlMs: 10_000 },
  );
  const { data: progressData } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "progress", "summary"),
    () => api(pageQuery, `/api/work-packages/${packageId}/progress/summary`).then((b) => b.summary),
    { ttlMs: 10_000 },
  );
  const steps = stepsData?.steps ?? [];
  const lines = progressData?.lines ?? [];

  const sourcesReady = targetId !== "" && inspectionDate !== "";
  const { data: sourcesData, error: sourcesError } = useStaleWhileRevalidate(
    sourcesReady
      ? scopedSWRKey(pageContext, "work-packages", packageId, "field-verifications", "sources", targetType, targetId, inspectionDate)
      : null,
    () => api(pageQuery, `/api/work-packages/${packageId}/field-verifications/sources?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}&asOf=${inspectionDate}`),
    { ttlMs: 10_000 },
  );
  const sources = sourcesData ?? null;

  function changeTargetType(next) {
    setTargetType(next);
    setTargetId("");
  }

  const isStep = targetType === "WORK_STEP";
  const needsCriteria = isStep && physicalCompletion === "COMPLETE";
  const canSubmit = sourcesReady && sources && !sourcesError
    && !sources.targetRetired
    && observationNote.trim() !== ""
    && sourceCheckedAt !== ""
    && (!isStep || (physicalCompletion !== "" && (!needsCriteria || acceptanceCriteriaChecked.trim() !== "")
      && (fieldReportedHours === "" || fieldHoursSource.trim() !== "")))
    && (isStep || (observedInstalledQuantity !== "" && Number.isFinite(Number(observedInstalledQuantity))));

  async function submit() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api(pageQuery, `/api/work-packages/${packageId}/field-verifications`, {
        method: "POST",
        body: JSON.stringify({
          targetType,
          stepId: isStep ? targetId : null,
          takeoffLineId: isStep ? null : targetId,
          workLocation,
          inspectionDate,
          sourceCheckedAt: new Date(sourceCheckedAt).toISOString(),
          sourceDrawingRevisionId: !isStep ? sources?.latestRevision?.id ?? null : null,
          scopeBaselineId: null,
          scopeBaselineVersion: null,
          observedInstalledQuantity: isStep ? null : Number(observedInstalledQuantity),
          observedBasis: isStep ? null : (observedBasis || null),
          physicalCompletion: isStep ? physicalCompletion : null,
          acceptanceCriteriaChecked: isStep ? (acceptanceCriteriaChecked || null) : null,
          fieldReportedHours: isStep && fieldReportedHours !== "" ? Number(fieldReportedHours) : null,
          fieldHoursSource: isStep ? (fieldHoursSource || null) : null,
          observationNote,
          evidenceRef: evidenceRef || null,
          evidenceSummary: evidenceSummary || null,
          sourceFingerprint: sources.sourceFingerprint,
          requestId: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `create-${Date.now()}`,
        }),
      });
      setNotice("Verification recorded as a draft — submit it for independent review when ready.");
      setObservedInstalledQuantity("");
      setObservedBasis("");
      setAcceptanceCriteriaChecked("");
      setFieldReportedHours("");
      setFieldHoursSource("");
      setObservationNote("");
      setEvidenceRef("");
      setEvidenceSummary("");
      if (onRecorded) onRecorded(result.verification);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Record a field verification</h3>
        <button className={btnGhost} onClick={() => setOpen((current) => !current)}>
          {open ? "Hide form" : "Record a verification"}
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        What was physically checked, against which plan, and what was actually found. The server
        takes the plan snapshot itself — your figures are the observation, never the plan.
      </p>
      {open && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className={label} htmlFor="fv-target-type">Verify a</label>
              <select id="fv-target-type" className={input} value={targetType} onChange={(event) => changeTargetType(event.target.value)}>
                <option value="WORK_STEP">Work step</option>
                <option value="TAKEOFF_LINE">Takeoff line</option>
              </select>
            </div>
            <div>
              <label className={label} htmlFor="fv-target">{isStep ? "Work step" : "Takeoff line"}</label>
              <select id="fv-target" className={input} value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                <option value="">Choose…</option>
                {isStep
                  ? steps.map((step) => (
                    <option key={step.id} value={step.id}>{step.title}</option>
                  ))
                  : lines.map((line) => (
                    <option key={line.lineId} value={line.lineId}>
                      {line.description ? `${line.description} — ` : ""}{line.baselineQuantity} {line.baselineUnit}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="fv-location">Where was the work?</label>
              <select id="fv-location" className={input} value={workLocation} onChange={(event) => setWorkLocation(event.target.value)}>
                <option value="FIELD">Field</option>
                <option value="SHOP">Shop</option>
              </select>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className={label} htmlFor="fv-inspection-date">Inspection date</label>
              <input id="fv-inspection-date" className={input} type="date" value={inspectionDate} onChange={(event) => setInspectionDate(event.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="fv-checked-at">Source checked at</label>
              <input id="fv-checked-at" className={input} type="datetime-local" value={sourceCheckedAt} onChange={(event) => setSourceCheckedAt(event.target.value)} />
            </div>
          </div>
          {sourcesReady && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              {sourcesError ? (
                <p className="text-red-600">{String(sourcesError)}</p>
              ) : !sources ? (
                <p>Loading the source preview…</p>
              ) : (
                <>
                  <p className="font-medium text-slate-900">
                    Checking against: {sources.targetLabel ?? "—"}
                    {sources.targetRetired ? " (retired — history only, cannot record a new observation)" : ""}
                  </p>
                  {isStep ? (
                    <p className="mt-1">
                      Step version {sources.stepVersion ?? "—"} · planned {formatNumber(sources.plannedStepHours)} hours
                      {sources.craftLabel ? ` · ${sources.craftLabel}` : ""}
                    </p>
                  ) : (
                    <p className="mt-1">
                      Planned {formatNumber(sources.plannedLineQuantity)} {sources.unit ?? ""} · installed as of {formatDate(sources.progressAsOf)}: {formatNumber(sources.installedAsOf)}
                      {sources.latestRevision ? ` · latest revision ${sources.latestRevision.revisionCode} (${sources.latestRevision.issuedAs})` : " · no drawing revision on file"}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          {isStep ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className={label} htmlFor="fv-completion">Physical completion</label>
                <select id="fv-completion" className={input} value={physicalCompletion} onChange={(event) => setPhysicalCompletion(event.target.value)}>
                  {FIELD_VERIFICATION_PHYSICAL_COMPLETIONS.map((key) => (
                    <option key={key} value={key}>{COMPLETION_LABELS[key]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="fv-criteria">Acceptance criteria checked{needsCriteria ? " (required)" : ""}</label>
                <input
                  id="fv-criteria"
                  className={input}
                  value={acceptanceCriteriaChecked}
                  onChange={(event) => setAcceptanceCriteriaChecked(event.target.value)}
                  placeholder="Which criteria did you check?"
                />
              </div>
              <div>
                <label className={label} htmlFor="fv-hours">Field reported hours (optional)</label>
                <input id="fv-hours" className={input} type="number" step="any" min="0" value={fieldReportedHours} onChange={(event) => setFieldReportedHours(event.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="fv-hours-source">Hours source</label>
                <input
                  id="fv-hours-source"
                  className={input}
                  value={fieldHoursSource}
                  onChange={(event) => setFieldHoursSource(event.target.value)}
                  placeholder="Required when hours are reported"
                />
              </div>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className={label} htmlFor="fv-observed-qty">Observed installed quantity ({sources?.unit ?? ""})</label>
                <input id="fv-observed-qty" className={input} type="number" step="any" min="0" value={observedInstalledQuantity} onChange={(event) => setObservedInstalledQuantity(event.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="fv-observed-basis">Observed basis</label>
                <input
                  id="fv-observed-basis"
                  className={input}
                  value={observedBasis}
                  onChange={(event) => setObservedBasis(event.target.value)}
                  placeholder="How was the quantity counted?"
                />
              </div>
            </div>
          )}
          <div>
            <label className={label} htmlFor="fv-note">Observation note</label>
            <textarea
              id="fv-note"
              className={input}
              rows={3}
              value={observationNote}
              onChange={(event) => setObservationNote(event.target.value)}
              placeholder="What did you check, and what did you find? Name the source — a drawing revision, a progress entry, a dated note."
            />
            <p className="mt-1 text-xs text-slate-500">
              To submit for review you will need an evidence reference or a note of at least 40 characters.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className={label} htmlFor="fv-ref">Evidence reference (optional)</label>
              <input id="fv-ref" className={input} value={evidenceRef} onChange={(event) => setEvidenceRef(event.target.value)} placeholder="e.g. field photo 2026-11-15-01.jpg" />
            </div>
            <div>
              <label className={label} htmlFor="fv-summary">Evidence summary (optional)</label>
              <input id="fv-summary" className={input} value={evidenceSummary} onChange={(event) => setEvidenceSummary(event.target.value)} placeholder="What shows this was checked?" />
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button className={btnPrimary} disabled={busy || !canSubmit} onClick={submit}>
              Record verification
            </button>
            <ActionConfirmation message={notice} />
          </div>
        </div>
      )}
    </div>
  );
}

// The Field verification panel: summary counts, filters, the
// readable list (Target, Planned, Recorded/Observed, Difference,
// Evidence, Inspector, Reviewer, Status), and the record form.
export default function WorkPackageFieldVerification({ packageId, initialFilter = null }) {
  const pageQuery = usePageQuery();
  const pageContext = usePackagePageContext();
  const [statusFilter, setStatusFilter] = useState("");
  const [targetTypeFilter, setTargetTypeFilter] = useState("");
  const [workLocationFilter, setWorkLocationFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [includeRetired, setIncludeRetired] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [targetFilter, setTargetFilter] = useState(initialFilter);
  const [prevInitialFilter, setPrevInitialFilter] = useState(initialFilter);
  if (initialFilter !== prevInitialFilter) {
    setPrevInitialFilter(initialFilter);
    setTargetFilter(initialFilter);
    setTargetTypeFilter(initialFilter?.targetType ?? "");
  }

  const listQuery = [
    statusFilter ? `status=${statusFilter}` : "",
    targetTypeFilter ? `targetType=${targetTypeFilter}` : "",
    workLocationFilter ? `workLocation=${workLocationFilter}` : "",
    includeRetired ? "includeRetired=true" : "",
    "limit=100",
  ].filter(Boolean).join("&");
  const {
    data: listData, error: listError, isLoading: listLoading, refresh: refreshList,
  } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "field-verifications", "list", listQuery),
    () => api(pageQuery, `/api/work-packages/${packageId}/field-verifications?${listQuery}`),
    { ttlMs: 10_000 },
  );

  const verifications = listData?.verifications ?? [];
  const summary = listData?.summary ?? null;
  const notApplied = listData?.notApplied;
  // The list endpoint carries no package status; the work-steps
  // endpoint does — same SWR key the create form uses, so this is
  // one shared fetch, not a second request.
  const { data: stepsData } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "work-steps", "list", "limit=100"),
    () => api(pageQuery, `/api/work-packages/${packageId}/work-steps?includeRetired=false&limit=100`),
    { ttlMs: 10_000 },
  );
  const isTerminal = TERMINAL_PACKAGE_STATUSES.includes(stepsData?.packageStatus ?? "");
  // The list endpoint has no inspection-date filter, so the date
  // filter applies client-side to the fetched page (limit 100 is
  // the whole package in practice).
  const visible = verifications.filter((v) => {
    if (targetFilter?.targetId) {
      if (v.stepId !== targetFilter.targetId && v.takeoffLineId !== targetFilter.targetId) return false;
    }
    if (dateFilter && String(v.inspectionDate ?? "").slice(0, 10) !== dateFilter) return false;
    return true;
  });

  function refreshAll() {
    refreshList();
  }

  function clearTargetFilter() {
    setTargetFilter(null);
    setTargetTypeFilter("");
  }

  if (listLoading) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Field verification</h2>
        <p className="mt-1 text-sm text-slate-600">Loading verifications…</p>
      </section>
    );
  }
  if (notApplied) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Field verification</h2>
        <p className="mt-1 text-sm text-slate-600">
          Field verification isn&apos;t available yet — the database change for this feature hasn&apos;t been applied.
        </p>
      </section>
    );
  }
  if (listError) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Field verification</h2>
        <p className="mt-1 text-sm text-red-600">{String(listError)}</p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Field verification</h2>
        <p className="mt-1 text-sm text-slate-600">
          Field verification records what was checked. It does not change recorded progress or the
          approved plan.
        </p>
        {summary && (
          <p className="mt-2 text-xs text-slate-600">
            Submitted {summary.submitted ?? 0} · Accepted {summary.accepted ?? 0} · Returned {summary.returned ?? 0} · Rejected {summary.rejected ?? 0}
            {summary.changedSinceReview > 0 && ` · Changed since review ${summary.changedSinceReview}`}
            {summary.total > 0 && ` · ${summary.total} total`}
          </p>
        )}
        {isTerminal && (
          <p className="mt-2 text-sm text-slate-600">
            This work package is closed — field verifications are read-only.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">
            Recorded verifications{summary?.total != null ? ` (${summary.total})` : ""}
          </h3>
          <div className="flex flex-wrap gap-2">
            <select className={input} value={workLocationFilter} onChange={(event) => setWorkLocationFilter(event.target.value)} aria-label="Filter by location">
              <option value="">Shop &amp; Field</option>
              <option value="SHOP">Shop</option>
              <option value="FIELD">Field</option>
            </select>
            <select className={input} value={targetTypeFilter} onChange={(event) => setTargetTypeFilter(event.target.value)} aria-label="Filter by target">
              <option value="">Steps &amp; Takeoff</option>
              <option value="WORK_STEP">Steps</option>
              <option value="TAKEOFF_LINE">Takeoff</option>
            </select>
            <select className={input} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
              <option value="">All statuses</option>
              {FIELD_VERIFICATION_STATUSES.map((status) => (
                <option key={status} value={status}>{STATUS_LABELS[status]}</option>
              ))}
            </select>
            <input
              className={input}
              type="date"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
              aria-label="Filter by inspection date"
            />
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={includeRetired} onChange={(event) => setIncludeRetired(event.target.checked)} />
              Show retired
            </label>
          </div>
        </div>
        {targetFilter?.targetId && (
          <p className="mt-2 text-xs text-slate-600">
            Showing verifications for one target.{" "}
            <button type="button" className="font-medium text-slate-900 underline" onClick={clearTargetFilter}>
              Show all
            </button>
          </p>
        )}
        {visible.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No verifications recorded yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {visible.map((verification) => (
              <li key={verification.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {statusBadge(verification.status)}
                  {sourceStatusBadge(verification.sourceStatus)}
                  <span className="text-sm font-medium text-slate-900">{verification.targetLabel ?? "—"}</span>
                  <span className="text-sm text-slate-700">
                    {verification.targetType === "WORK_STEP"
                      ? `Planned ${formatNumber(verification.plannedStepHours)} hours`
                      : `Planned ${formatNumber(verification.plannedLineQuantity)} ${verification.unit ?? ""}`}
                  </span>
                  <button className={btnGhost} onClick={() => setExpandedId((current) => (current === verification.id ? null : verification.id))}>
                    {expandedId === verification.id ? "Hide detail" : "Detail"}
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Inspected {formatDate(verification.inspectionDate)} · {verification.workLocation === "SHOP" ? "Shop" : "Field"}
                  {` · recorded ${formatWhen(verification.createdAt)}`}
                </p>
                <p className="mt-1 text-sm text-slate-700">
                  {verification.targetType === "WORK_STEP" ? (
                    <>
                      {verification.physicalCompletion ? COMPLETION_LABELS[verification.physicalCompletion] ?? verification.physicalCompletion : "—"}
                      {verification.fieldReportedHours != null && ` · field reported ${formatNumber(verification.fieldReportedHours)} hours`}
                    </>
                  ) : (
                    <>
                      Observed {formatNumber(verification.observedInstalledQuantity)} {verification.unit ?? ""} · recorded {formatNumber(verification.sourceProgressTotalQuantity)}
                    </>
                  )}
                  {" · "}
                  <VarianceLine verification={verification} />
                </p>
                <p className="mt-1 text-sm text-slate-700">{verification.observationNote}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {verification.evidenceRef ? `Evidence: ${verification.evidenceRef} · ` : ""}
                  {verification.submittedBy ? "Submitted" : "Not submitted yet"}
                  {verification.reviewedBy ? " · Reviewed" : ""}
                </p>
                {expandedId === verification.id && (
                  <FieldVerificationDetail
                    packageId={packageId}
                    verification={verification}
                    isTerminal={isTerminal}
                    onChanged={refreshAll}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!isTerminal && (
        <RecordFieldVerificationForm
          packageId={packageId}
          preset={targetFilter}
          onRecorded={refreshAll}
        />
      )}
    </div>
  );
}
