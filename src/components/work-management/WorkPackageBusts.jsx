// Work Package Planner slice 9 — Busts for one work package: the
// detected candidates (read-only proposals, never auto-confirmed),
// the recorded busts with their full history, and the disposition
// actions (confirm, transition, retire, link/unlink a change order).
// A bust never blocks work: status is informational only, and no
// action here touches steps, progress, assignments, the manpower
// curve, IFC releases, or change-order decisions.
//
// Every save shows its confirmation inline beside the action that
// produced it (the slice-7 placement rule); every label names its
// target in plain words (drawing number, step title, craft + date),
// never a raw id. Money is entered in dollars and sent as whole
// cents; quantities are never converted into labor cost.
"use client";

import { useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { usePageQuery, usePackagePageContext } from "./packagePageContext.jsx";
import { scopedSWRKey } from "./workspaceQuery.js";
import { ActionConfirmation } from "./WorkPackageDrawingReadiness.jsx";
import {
  BUST_TRANSITIONS,
  DIMENSION_SCOPES,
  DIMENSION_UNITS,
  formatVarianceLabel,
} from "@/domains/work-management/busts";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const label = "block text-xs font-medium text-slate-600 mb-1";
const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const btnPrimary = `${btn} bg-slate-900 text-white hover:bg-slate-700`;
const btnGhost = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;
const btnDanger = `${btn} border border-red-300 text-red-700 hover:bg-red-50`;

const DIMENSION_LABELS = {
  INSTALLED_QUANTITY: "Installed quantity",
  LABOR_HOURS: "Labor hours",
  LABOR_COST: "Labor cost",
  SCHEDULE_DAYS: "Schedule days",
  MANPOWER_SHORTFALL: "Manpower shortfall",
};

const STATUS_LABELS = {
  OPEN: "Open",
  UNDER_REVIEW: "Under review",
  ACCEPTED_OVERRUN: "Accepted overrun",
  RESOLVED_BY_CHANGE: "Resolved by change",
  INVALID_DATA: "Invalid data",
  RETIRED: "Retired",
};

const REVISION_ACTION_LABELS = {
  create: "Recorded",
  update: "Evidence edited",
  transition: "Status changed",
  reopen: "Reopened",
  retire: "Retired",
  link_change_order: "Change order linked",
  unlink_change_order: "Change order unlinked",
};

const TERMINAL_BUST_STATUSES = ["ACCEPTED_OVERRUN", "RESOLVED_BY_CHANGE", "INVALID_DATA"];

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

function statusBadge(status) {
  const tone = status === "OPEN"
    ? "bg-amber-100 text-amber-800"
    : status === "UNDER_REVIEW"
      ? "bg-blue-100 text-blue-800"
      : status === "ACCEPTED_OVERRUN"
        ? "bg-slate-100 text-slate-700"
        : status === "RESOLVED_BY_CHANGE"
          ? "bg-emerald-100 text-emerald-800"
          : status === "INVALID_DATA"
            ? "bg-red-100 text-red-800"
            : "bg-slate-100 text-slate-500";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${tone}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function dimensionBadge(dimension) {
  return (
    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
      {DIMENSION_LABELS[dimension] ?? dimension}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Read-only linked-bust badges for the step and manpower views.
// useBustBadges fetches the per-package badge map once (SWR-cached by
// key, so the steps view, the manpower view, and this panel share one
// fetch). BustBadge renders nothing when there is no active bust for
// the key — a badge is a flag, never a blocker.
// ---------------------------------------------------------------------------

export function useBustBadges(packageId) {
  const pageQuery = usePageQuery();
  const pageContext = usePackagePageContext();
  const { data } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "busts", "badges"),
    () => api(pageQuery, `/api/work-packages/${packageId}/busts/badges`),
    { ttlMs: 10_000 },
  );
  return data ?? { byTakeoffLine: {}, byWorkStep: {}, byCraftDay: {} };
}

export function BustBadge({ badge }) {
  if (!badge || badge.count < 1) return null;
  const dimensions = (badge.dimensions ?? []).map((d) => DIMENSION_LABELS[d] ?? d).join(", ");
  return (
    <span
      className="ml-2 inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
      title={dimensions ? `Active busts: ${dimensions}` : "Active busts"}
    >
      ⚠ {badge.count} bust{badge.count === 1 ? "" : "s"}
    </span>
  );
}

function revisionSummary(revision) {
  const oldValues = revision.oldValues || {};
  const newValues = revision.newValues || {};
  const parts = [];
  if (oldValues.status != null && newValues.status != null && oldValues.status !== newValues.status) {
    parts.push(`${STATUS_LABELS[oldValues.status] ?? oldValues.status} → ${STATUS_LABELS[newValues.status] ?? newValues.status}`);
  }
  if (newValues.change_order_id) parts.push("change order linked");
  if (newValues.retired_at != null && oldValues.retired_at == null) parts.push("retired");
  if (revision.action === "update") parts.push("evidence edited");
  return parts.length > 0 ? parts.join(" · ") : "—";
}

// One recorded bust, expanded: its evidence, its append-only history
// (actor ids are never shown — the audit trail keeps them in the
// database; the UI shows what changed, why, and when), its linked
// change orders, and the disposition actions.
function BustDetail({ packageId, bust, baseline, isTerminal, onChanged }) {
  const pageQuery = usePageQuery();
  const pageContext = usePackagePageContext();
  const [notices, setNotices] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [transitionTo, setTransitionTo] = useState("");
  const [dispositionReason, setDispositionReason] = useState("");
  const [reason, setReason] = useState("");
  const [retiring, setRetiring] = useState(false);
  const [retireReason, setRetireReason] = useState("");
  const [linkOrderId, setLinkOrderId] = useState("");
  const [linkReason, setLinkReason] = useState("");
  const [unlinkingId, setUnlinkingId] = useState(null);
  const [unlinkReason, setUnlinkReason] = useState("");

  const { data, error: loadError, isLoading, refresh } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "busts", bust.id, "detail"),
    () => api(pageQuery, `/api/work-packages/${packageId}/busts/${bust.id}`),
    { ttlMs: 10_000 },
  );
  const { data: ordersData } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "change-orders", "link-picker"),
    () => api(pageQuery, `/api/work-packages/${packageId}/change-orders`),
    { ttlMs: 10_000 },
  );
  const detail = data?.bust ?? bust;
  const revisions = data?.revisions ?? [];
  const links = data?.links ?? [];
  const activeLinks = data?.activeLinks ?? [];
  const changeOrders = ordersData?.changeOrders ?? [];
  const allowedTargets = BUST_TRANSITIONS[bust.status] ?? [];
  const needsDisposition = transitionTo && TERMINAL_BUST_STATUSES.includes(transitionTo);
  const needsBaseline = transitionTo === "RESOLVED_BY_CHANGE";

  async function run(actionKey, path, body, successMessage) {
    setBusy(true);
    setError("");
    try {
      const result = await api(pageQuery, path, { method: "POST", body: JSON.stringify(body) });
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

  async function submitTransition() {
    if (!transitionTo) return;
    await run(
      "transition",
      `/api/work-packages/${packageId}/busts/${bust.id}/transition`,
      {
        expectedVersion: detail.version,
        toStatus: transitionTo,
        dispositionReason: needsDisposition ? dispositionReason : null,
        // The updated baseline that fixes the plan is the current
        // frozen baseline — a fix is re-baselined before the bust is
        // resolved. The API accepts any valid baseline id; the UI
        // offers the current one.
        resolvedBaselineId: needsBaseline ? baseline?.id ?? null : null,
        reason,
      },
      () => `Bust moved to ${STATUS_LABELS[transitionTo]}.`,
    );
    setTransitionTo("");
    setDispositionReason("");
    setReason("");
  }

  async function submitRetire() {
    await run(
      "retire",
      `/api/work-packages/${packageId}/busts/${bust.id}/retire`,
      { expectedVersion: detail.version, reason: retireReason },
      () => "Bust retired — it stays on file for the audit trail.",
    );
    setRetiring(false);
    setRetireReason("");
  }

  async function submitLink() {
    if (!linkOrderId) return;
    await run(
      "link",
      `/api/work-packages/${packageId}/busts/${bust.id}/change-orders`,
      { changeOrderId: linkOrderId, reason: linkReason },
      () => "Change order linked — linking never closes a bust.",
    );
    setLinkOrderId("");
    setLinkReason("");
  }

  async function submitUnlink(link) {
    await run(
      "unlink",
      `/api/work-packages/${packageId}/busts/${bust.id}/change-orders/${link.id}/retire`,
      { expectedVersion: link.version, reason: unlinkReason },
      () => "Link retired — the bust itself is unchanged.",
    );
    setUnlinkingId(null);
    setUnlinkReason("");
  }

  if (isLoading) return <p className="mt-2 text-xs text-slate-500">Loading bust…</p>;
  if (loadError) return <p className="mt-2 text-xs text-red-600">{String(loadError)}</p>;

  return (
    <div className="mt-3 space-y-4 border-t border-slate-100 pt-3">
      <div className="grid gap-3 text-sm md:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-slate-500">Evidence</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{detail.evidenceSummary}</dd>
          {detail.evidenceRef && (
            <dd className="mt-1 text-xs text-slate-500">Ref: {detail.evidenceRef}</dd>
          )}
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-500">Compared as of</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{detail.comparisonAsOf ?? "—"}</dd>
          <dt className="mt-2 text-xs font-medium text-slate-500">Baseline</dt>
          <dd className="mt-0.5 text-sm text-slate-900">
            {detail.baselineVersion != null ? `Version ${detail.baselineVersion}` : "Takeoff line (no baseline)"}
          </dd>
          {detail.dispositionReason && (
            <>
              <dt className="mt-2 text-xs font-medium text-slate-500">Disposition</dt>
              <dd className="mt-0.5 text-sm text-slate-900">{detail.dispositionReason}</dd>
            </>
          )}
        </div>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-slate-900">Linked change orders</h4>
        {links.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">No change orders linked.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs text-slate-600">
            {links.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {link.changeOrderNumber ? `Change order ${link.changeOrderNumber}` : "Change order"}
                  {link.changeOrderStatus ? ` (${link.changeOrderStatus})` : ""}
                  {link.unlinkedAt ? " — link retired" : ""}
                </span>
                {!link.unlinkedAt && !isTerminal && (
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
        {!isTerminal && (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              <label className={label} htmlFor={`link-order-${bust.id}`}>Link a change order</label>
              <select
                id={`link-order-${bust.id}`}
                className={input}
                value={linkOrderId}
                onChange={(event) => setLinkOrderId(event.target.value)}
              >
                <option value="">Choose a change order…</option>
                {changeOrders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.changeOrderNumber ? `Change order ${order.changeOrderNumber}` : "Change order"}
                    {order.description ? ` — ${order.description}` : ""}
                    {` (${order.status})`}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-48 flex-1">
              <label className={label} htmlFor={`link-reason-${bust.id}`}>Reason</label>
              <input
                id={`link-reason-${bust.id}`}
                className={input}
                value={linkReason}
                onChange={(event) => setLinkReason(event.target.value)}
                placeholder="Why is this order linked to this bust?"
              />
            </div>
            <button className={btnPrimary} disabled={busy || !linkOrderId || !linkReason.trim()} onClick={submitLink}>
              Link change order
            </button>
            <ActionConfirmation message={notices.link} />
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

      {!isTerminal && (
        <div className="space-y-3 border-t border-slate-100 pt-3">
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              <label className={label} htmlFor={`transition-${bust.id}`}>Move bust to</label>
              <select
                id={`transition-${bust.id}`}
                className={input}
                value={transitionTo}
                onChange={(event) => setTransitionTo(event.target.value)}
              >
                <option value="">Choose a status…</option>
                {allowedTargets.map((target) => (
                  <option key={target} value={target}>{STATUS_LABELS[target]}</option>
                ))}
              </select>
            </div>
            {needsDisposition && (
              <div className="min-w-48 flex-1">
                <label className={label} htmlFor={`disposition-${bust.id}`}>Disposition reason</label>
                <input
                  id={`disposition-${bust.id}`}
                  className={input}
                  value={dispositionReason}
                  onChange={(event) => setDispositionReason(event.target.value)}
                  placeholder="Why is this bust closed this way?"
                />
              </div>
            )}
            {needsBaseline && (
              <p className="w-full text-xs text-slate-500">
                Resolving by change uses the current frozen baseline
                {baseline ? ` (version ${baseline.versionNumber})` : " — none frozen yet"} as the updated baseline,
                and needs a linked approved change order.
              </p>
            )}
            <div className="min-w-48 flex-1">
              <label className={label} htmlFor={`transition-reason-${bust.id}`}>Reason</label>
              <input
                id={`transition-reason-${bust.id}`}
                className={input}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Reason for this move"
              />
            </div>
            <button
              className={btnPrimary}
              disabled={busy || !transitionTo || !reason.trim() || (needsDisposition && !dispositionReason.trim()) || (needsBaseline && !baseline)}
              onClick={submitTransition}
            >
              Move bust
            </button>
            <ActionConfirmation message={notices.transition} />
          </div>
          {retiring ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1">
                <label className={label} htmlFor={`retire-reason-${bust.id}`}>Reason for retiring this bust</label>
                <input
                  id={`retire-reason-${bust.id}`}
                  className={input}
                  value={retireReason}
                  onChange={(event) => setRetireReason(event.target.value)}
                  placeholder="Why is this bust retired? It stays on file."
                />
              </div>
              <button className={btnDanger} disabled={busy || !retireReason.trim()} onClick={submitRetire}>
                Retire bust
              </button>
              <button className={btnGhost} onClick={() => { setRetiring(false); setRetireReason(""); }}>
                Cancel
              </button>
              <ActionConfirmation message={notices.retire} />
            </div>
          ) : (
            <button className={btnDanger} onClick={() => setRetiring(true)}>Retire bust</button>
          )}
        </div>
      )}
    </div>
  );
}

// Record a bust manually — for a variance the detector cannot see
// (a step finishing late, a shift-specific manpower shortfall, a
// line's labor figures from verified actuals). The figures are
// typed by a human with evidence; the server still validates the
// target, the baseline, the unit and the direction, and computes the
// variance itself. Costs are entered in dollars and sent as cents.
function ManualBustForm({ packageId, targets, baseline, onRecorded }) {
  const pageQuery = usePageQuery();
  const [open, setOpen] = useState(false);
  const [dimension, setDimension] = useState("LABOR_HOURS");
  const [scopeType, setScopeType] = useState("PACKAGE");
  const [takeoffLineId, setTakeoffLineId] = useState("");
  const [workStepId, setWorkStepId] = useState("");
  const [craft, setCraft] = useState("");
  const [workDate, setWorkDate] = useState("");
  const [shiftKey, setShiftKey] = useState("");
  const [planned, setPlanned] = useState("");
  const [observed, setObserved] = useState("");
  const [comparisonAsOf, setComparisonAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [evidenceSummary, setEvidenceSummary] = useState("");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const scopes = DIMENSION_SCOPES[dimension] ?? [];
  const selectedLine = (targets?.takeoffLines ?? []).find((line) => line.id === takeoffLineId) ?? null;
  const unit = dimension === "INSTALLED_QUANTITY" ? selectedLine?.unit ?? "" : DIMENSION_UNITS[dimension] ?? "";
  const isCost = dimension === "LABOR_COST";

  function changeDimension(next) {
    setDimension(next);
    const nextScopes = DIMENSION_SCOPES[next] ?? [];
    setScopeType(nextScopes[0] ?? "PACKAGE");
    setTakeoffLineId("");
    setWorkStepId("");
  }

  async function submit() {
    setBusy(true);
    setError("");
    setNotice("");
    const plannedValue = isCost ? Math.round(Number(planned) * 100) : Number(planned);
    const observedValue = isCost ? Math.round(Number(observed) * 100) : Number(observed);
    try {
      const result = await api(pageQuery, `/api/work-packages/${packageId}/busts`, {
        method: "POST",
        body: JSON.stringify({
          dimension,
          scopeType,
          takeoffLineId: scopeType === "TAKEOFF_LINE" ? takeoffLineId : null,
          workStepId: scopeType === "WORK_STEP" ? workStepId : null,
          craft: scopeType === "CRAFT_DAY" ? craft : null,
          workDate: scopeType === "CRAFT_DAY" ? workDate : null,
          shiftKey: scopeType === "CRAFT_DAY" && shiftKey ? shiftKey : null,
          baselineId: dimension === "INSTALLED_QUANTITY" ? null : baseline?.id ?? null,
          baselineVersion: dimension === "INSTALLED_QUANTITY" ? null : baseline?.versionNumber ?? null,
          plannedValue,
          observedValue,
          unit,
          evidenceSummary,
          evidenceRef: evidenceRef || null,
          comparisonAsOf,
          requestId: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `manual-${Date.now()}`,
        }),
      });
      setNotice(`Bust recorded — ${DIMENSION_LABELS[dimension]} is open for review.`);
      setPlanned("");
      setObserved("");
      setEvidenceSummary("");
      setEvidenceRef("");
      if (onRecorded) onRecorded(result.bust);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  const targetReady = scopeType === "PACKAGE"
    || (scopeType === "TAKEOFF_LINE" && takeoffLineId)
    || (scopeType === "WORK_STEP" && workStepId)
    || (scopeType === "CRAFT_DAY" && craft.trim() && workDate);
  const valuesReady = planned !== "" && observed !== "" && Number.isFinite(Number(planned)) && Number.isFinite(Number(observed));
  const canSubmit = targetReady && valuesReady && evidenceSummary.trim().length >= 10 && comparisonAsOf;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Record a bust manually</h3>
        <button className={btnGhost} onClick={() => setOpen((current) => !current)}>
          {open ? "Hide form" : "Record a bust"}
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        For a variance the detector cannot see — a step finishing late, a shift-specific manpower
        shortfall, or a line&apos;s labor figures from verified actuals. The figures are yours;
        the server checks them against the frozen plan before anything is recorded.
      </p>
      {open && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className={label} htmlFor="manual-dimension">What went over?</label>
              <select id="manual-dimension" className={input} value={dimension} onChange={(event) => changeDimension(event.target.value)}>
                {Object.keys(DIMENSION_LABELS).map((key) => (
                  <option key={key} value={key}>{DIMENSION_LABELS[key]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="manual-scope">Applies to</label>
              <select id="manual-scope" className={input} value={scopeType} onChange={(event) => setScopeType(event.target.value)}>
                {scopes.map((scope) => (
                  <option key={scope} value={scope}>
                    {scope === "PACKAGE" ? "Whole package" : scope === "TAKEOFF_LINE" ? "Takeoff line" : scope === "WORK_STEP" ? "Work step" : "Craft day"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {scopeType === "TAKEOFF_LINE" && (
            <div>
              <label className={label} htmlFor="manual-line">Takeoff line</label>
              <select id="manual-line" className={input} value={takeoffLineId} onChange={(event) => setTakeoffLineId(event.target.value)}>
                <option value="">Choose a takeoff line…</option>
                {(targets?.takeoffLines ?? []).map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.drawingNumber ? `Drawing ${line.drawingNumber} — ` : ""}{line.quantity} {line.unit} planned
                  </option>
                ))}
              </select>
            </div>
          )}
          {scopeType === "WORK_STEP" && (
            <div>
              <label className={label} htmlFor="manual-step">Work step</label>
              <select id="manual-step" className={input} value={workStepId} onChange={(event) => setWorkStepId(event.target.value)}>
                <option value="">Choose a work step…</option>
                {(targets?.steps ?? []).map((step) => (
                  <option key={step.id} value={step.id}>{step.title}</option>
                ))}
              </select>
            </div>
          )}
          {scopeType === "CRAFT_DAY" && (
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className={label} htmlFor="manual-craft">Craft</label>
                <input id="manual-craft" className={input} value={craft} onChange={(event) => setCraft(event.target.value)} placeholder="e.g. Pipefitters" />
              </div>
              <div>
                <label className={label} htmlFor="manual-work-date">Date</label>
                <input id="manual-work-date" className={input} type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="manual-shift">Shift (optional)</label>
                <input id="manual-shift" className={input} value={shiftKey} onChange={(event) => setShiftKey(event.target.value)} placeholder="e.g. day" />
              </div>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className={label} htmlFor="manual-planned">
                Planned {isCost ? "(dollars)" : unit ? `(${unit})` : ""}
              </label>
              <input id="manual-planned" className={input} type="number" step="any" min="0" value={planned} onChange={(event) => setPlanned(event.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="manual-observed">
                Observed {isCost ? "(dollars)" : unit ? `(${unit})` : ""}
              </label>
              <input id="manual-observed" className={input} type="number" step="any" min="0" value={observed} onChange={(event) => setObserved(event.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="manual-asof">Compared as of</label>
              <input id="manual-asof" className={input} type="date" value={comparisonAsOf} onChange={(event) => setComparisonAsOf(event.target.value)} />
            </div>
          </div>
          {dimension !== "INSTALLED_QUANTITY" && (
            <p className="text-xs text-slate-500">
              Allowance: {baseline ? `frozen baseline version ${baseline.versionNumber}` : "no frozen baseline — labor, cost, and schedule busts need one."}
            </p>
          )}
          <div>
            <label className={label} htmlFor="manual-evidence">Evidence (at least 10 characters)</label>
            <textarea
              id="manual-evidence"
              className={input}
              rows={3}
              value={evidenceSummary}
              onChange={(event) => setEvidenceSummary(event.target.value)}
              placeholder="What shows this went over? Name the source — a progress entry, a timesheet, a dated note."
            />
          </div>
          <div>
            <label className={label} htmlFor="manual-ref">Evidence reference (optional)</label>
            <input id="manual-ref" className={input} value={evidenceRef} onChange={(event) => setEvidenceRef(event.target.value)} placeholder="e.g. progress entry 2026-11-14, timesheet week 46" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button className={btnPrimary} disabled={busy || !canSubmit} onClick={submit}>
              Record bust
            </button>
            <ActionConfirmation message={notice} />
          </div>
        </div>
      )}
    </div>
  );
}

// The Busts panel: detected candidates first (proposals, never
// auto-confirmed), then the recorded busts with their history and
// disposition actions, then the manual-record form.
export default function WorkPackageBusts({ packageId }) {
  const pageQuery = usePageQuery();
  const pageContext = usePackagePageContext();
  const [statusFilter, setStatusFilter] = useState("");
  const [dimensionFilter, setDimensionFilter] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [confirmForms, setConfirmForms] = useState({});
  const [confirmNotices, setConfirmNotices] = useState({});
  const [confirmErrors, setConfirmErrors] = useState({});
  const [confirmBusy, setConfirmBusy] = useState({});

  const {
    data: candidatesData, error: candidatesError, isLoading: candidatesLoading, refresh: refreshCandidates,
  } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "busts", "candidates"),
    () => api(pageQuery, `/api/work-packages/${packageId}/busts/candidates`),
    { ttlMs: 10_000 },
  );
  const bustsQuery = [
    statusFilter ? `status=${statusFilter}` : "",
    dimensionFilter ? `dimension=${dimensionFilter}` : "",
    "limit=100",
  ].filter(Boolean).join("&");
  const {
    data: bustsData, error: bustsError, isLoading: bustsLoading, refresh: refreshBusts,
  } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "busts", "list", bustsQuery),
    () => api(pageQuery, `/api/work-packages/${packageId}/busts?${bustsQuery}`),
    { ttlMs: 10_000 },
  );

  const packageStatus = candidatesData?.packageStatus ?? "";
  const isTerminal = packageStatus === "cancelled" || packageStatus === "verified_closed";
  const candidates = candidatesData?.candidates ?? [];
  const insufficiencies = candidatesData?.insufficiencies ?? [];
  const baseline = candidatesData?.baseline ?? null;
  const targets = candidatesData?.targets ?? { takeoffLines: [], steps: [] };
  const busts = bustsData?.busts ?? [];
  const notApplied = candidatesData?.notApplied || bustsData?.notApplied;

  function refreshAll() {
    refreshCandidates();
    refreshBusts();
  }

  async function confirmCandidate(candidate) {
    const key = candidate.sourceFingerprint;
    const form = confirmForms[key] ?? {
      evidenceSummary: candidate.suggestedEvidenceSummary ?? "",
      evidenceRef: "",
    };
    setConfirmBusy((current) => ({ ...current, [key]: true }));
    setConfirmErrors((current) => ({ ...current, [key]: "" }));
    try {
      await api(pageQuery, `/api/work-packages/${packageId}/busts`, {
        method: "POST",
        body: JSON.stringify({
          dimension: candidate.dimension,
          scopeType: candidate.scopeType,
          takeoffLineId: candidate.takeoffLineId,
          workStepId: candidate.workStepId,
          craft: candidate.craft,
          workDate: candidate.workDate,
          shiftKey: candidate.shiftKey,
          baselineId: candidate.baselineId,
          baselineVersion: candidate.baselineVersion,
          plannedValue: candidate.plannedValue,
          observedValue: candidate.observedValue,
          unit: candidate.unit,
          evidenceSummary: form.evidenceSummary,
          evidenceRef: form.evidenceRef || null,
          comparisonAsOf: candidate.comparisonAsOf,
          sourceFingerprint: candidate.sourceFingerprint,
          requestId: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `confirm-${Date.now()}`,
        }),
      });
      setConfirmNotices((current) => ({
        ...current,
        [key]: `Bust recorded — ${DIMENSION_LABELS[candidate.dimension]} is open for review.`,
      }));
      refreshAll();
    } catch (caught) {
      setConfirmErrors((current) => ({ ...current, [key]: caught.message }));
    } finally {
      setConfirmBusy((current) => ({ ...current, [key]: false }));
    }
  }

  if (candidatesLoading && bustsLoading) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Busts</h2>
        <p className="mt-1 text-sm text-slate-600">Loading busts…</p>
      </section>
    );
  }
  if (notApplied) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Busts</h2>
        <p className="mt-1 text-sm text-slate-600">
          Busts aren&apos;t available yet — the database change for this feature hasn&apos;t been applied.
        </p>
      </section>
    );
  }
  if (candidatesError || bustsError) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Busts</h2>
        <p className="mt-1 text-sm text-red-600">{String(candidatesError || bustsError)}</p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Busts</h2>
        <p className="mt-1 text-sm text-slate-600">
          A bust is a recorded unfavorable variance against the frozen plan — labor hours, labor
          cost, schedule days, manpower, or installed quantity. Busts never block work: they
          record what went over so it can be reviewed, accepted, or resolved by a change order.
          The control estimate is never an allowance, and an installed quantity overrun is never
          turned into a labor cost.
        </p>
        {isTerminal && (
          <p className="mt-2 text-sm text-slate-600">
            This work package is closed — busts are read-only.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-900">Detected — needs review</h3>
        <p className="mt-1 text-xs text-slate-500">
          Checked against the frozen plan as of {candidatesData?.asOf ?? "today"}. Nothing here is
          recorded until a person confirms it with evidence.
        </p>
        {candidates.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No busts detected — nothing is over its frozen allowance.</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {candidates.map((candidate) => {
              const key = candidate.sourceFingerprint;
              const form = confirmForms[key] ?? {
                evidenceSummary: candidate.suggestedEvidenceSummary ?? "",
                evidenceRef: "",
              };
              return (
                <li key={key} className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {dimensionBadge(candidate.dimension)}
                    <span className="text-sm font-medium text-slate-900">{candidate.targetLabel}</span>
                    <span className="text-sm text-slate-700">{formatVarianceLabel(candidate)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Compared as of {candidate.comparisonAsOf}
                    {candidate.baselineVersion != null ? ` · baseline version ${candidate.baselineVersion}` : " · takeoff line allowance"}
                    {candidate.alreadyRecorded ? " · already recorded — see below" : ""}
                  </p>
                  {!isTerminal && !candidate.alreadyRecorded && (
                    <div className="mt-3 space-y-2">
                      <div>
                        <label className={label} htmlFor={`evidence-${key}`}>Evidence</label>
                        <textarea
                          id={`evidence-${key}`}
                          className={input}
                          rows={2}
                          value={form.evidenceSummary}
                          onChange={(event) => setConfirmForms((current) => ({
                            ...current,
                            [key]: { ...form, evidenceSummary: event.target.value },
                          }))}
                        />
                      </div>
                      <div>
                        <label className={label} htmlFor={`ref-${key}`}>Evidence reference (optional)</label>
                        <input
                          id={`ref-${key}`}
                          className={input}
                          value={form.evidenceRef}
                          onChange={(event) => setConfirmForms((current) => ({
                            ...current,
                            [key]: { ...form, evidenceRef: event.target.value },
                          }))}
                          placeholder="e.g. progress entry 2026-11-14"
                        />
                      </div>
                      {confirmErrors[key] && <p className="text-xs text-red-600">{confirmErrors[key]}</p>}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          className={btnPrimary}
                          disabled={confirmBusy[key] || form.evidenceSummary.trim().length < 10}
                          onClick={() => confirmCandidate(candidate)}
                        >
                          Confirm bust
                        </button>
                        <ActionConfirmation message={confirmNotices[key]} />
                      </div>
                    </div>
                  )}
                  {candidate.alreadyRecorded && (
                    <p className="mt-2 text-xs text-slate-600">
                      Already recorded as an open bust — confirming again would duplicate it.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {insufficiencies.length > 0 && (
          <div className="mt-4">
            <h4 className="text-xs font-semibold text-slate-900">Could not check</h4>
            <ul className="mt-1 space-y-1 text-xs text-slate-500">
              {insufficiencies.map((item, index) => (
                <li key={index}>
                  {item.dimension ? `${DIMENSION_LABELS[item.dimension] ?? item.dimension}: ` : ""}{item.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">
            Recorded busts{bustsData?.total != null ? ` (${bustsData.total})` : ""}
          </h3>
          <div className="flex flex-wrap gap-2">
            <select className={input} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
              <option value="">All statuses</option>
              {Object.keys(STATUS_LABELS).map((status) => (
                <option key={status} value={status}>{STATUS_LABELS[status]}</option>
              ))}
            </select>
            <select className={input} value={dimensionFilter} onChange={(event) => setDimensionFilter(event.target.value)} aria-label="Filter by dimension">
              <option value="">All dimensions</option>
              {Object.keys(DIMENSION_LABELS).map((dimension) => (
                <option key={dimension} value={dimension}>{DIMENSION_LABELS[dimension]}</option>
              ))}
            </select>
          </div>
        </div>
        {busts.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No busts recorded yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {busts.map((bust) => (
              <li key={bust.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {statusBadge(bust.status)}
                  {dimensionBadge(bust.dimension)}
                  <span className="text-sm font-medium text-slate-900">{bust.targetLabel ?? "—"}</span>
                  <span className="text-sm text-slate-700">{formatVarianceLabel(bust)}</span>
                  <button className={btnGhost} onClick={() => setExpandedId((current) => (current === bust.id ? null : bust.id))}>
                    {expandedId === bust.id ? "Hide detail" : "Detail"}
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Compared as of {bust.comparisonAsOf ?? "—"}
                  {bust.baselineVersion != null ? ` · baseline version ${bust.baselineVersion}` : ""}
                  {` · recorded ${formatWhen(bust.createdAt)}`}
                </p>
                <p className="mt-1 text-sm text-slate-700">{bust.evidenceSummary}</p>
                {expandedId === bust.id && (
                  <BustDetail
                    packageId={packageId}
                    bust={bust}
                    baseline={baseline}
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
        <ManualBustForm packageId={packageId} targets={targets} baseline={baseline} onRecorded={refreshAll} />
      )}
    </div>
  );
}
