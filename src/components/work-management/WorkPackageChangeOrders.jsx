// Work Package Planner slice 8 — the Change Orders Log for one work
// package: the living control estimate, the change-order grid, and the
// craft labor rates. The running figures (running contract price,
// contingency remaining, planned labor cost, total job cost) are
// computed server-side from one snapshot — never stored, never a
// second read.
//
// The grid is the Maximo-style editable grid from PR #759:
// double-click a cell, dropdown where the value is fixed, type where
// it isn't; blank rows fill the page so the next change order is
// typed in place, and the server assigns its number. Every mutation
// carries a reason — grid commits use the panel's reason box, and the
// expanded edit form, estimate form, rate form, retire confirms, and
// status moves each carry their own — because the revision audit
// requires one on every update, status change, and retire.
"use client";

import { Fragment, useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { withWorkspaceQuery } from "./workspaceQuery.js";
import EditableGridCell from "./EditableGridCell.jsx";
import {
  ALLOWED_TRANSITIONS,
  CHANGE_ORDER_STATUSES,
  CHANGE_ORDER_TYPES,
  DEFAULT_CRAFT_RATE_CENTS_PER_HOUR,
  changeOrderStatusLabel,
  changeOrderTypeLabel,
  formatRatePerHour,
  parseDollarsToCents,
} from "@/domains/work-management/changeOrders";
import { formatCents } from "@/domains/work-management/packageCosts.js";

const CO_GRID_COLS = "grid-cols-[3.5rem_minmax(9rem,1fr)_minmax(12rem,2fr)_8rem_7rem_7rem_7rem_12rem]";
const BLANK_ROWS = 10;
const HISTORY_PAGE_SIZE = 50;

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
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

function money(cents) {
  return formatCents(cents) || "$0.00";
}

function dollarsInputValue(cents) {
  return cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);
}

function formatWhen(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

const ACTION_LABELS = {
  create: "Added",
  update: "Edited",
  status_change: "Status changed",
  retire: "Retired",
};

function revisionSummary(revision) {
  const oldValues = revision.oldValues || {};
  const newValues = revision.newValues || {};
  const parts = [];
  if (oldValues.status != null && newValues.status != null && oldValues.status !== newValues.status) {
    parts.push(`${changeOrderStatusLabel(oldValues.status)} → ${changeOrderStatusLabel(newValues.status)}`);
  }
  if (oldValues.type != null && newValues.type != null && oldValues.type !== newValues.type) {
    parts.push(`${changeOrderTypeLabel(oldValues.type)} → ${changeOrderTypeLabel(newValues.type)}`);
  }
  if (newValues.retired_at != null && oldValues.retired_at == null) parts.push("retired");
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function ChangeOrderHistory({ packageId, changeOrderId }) {
  const [pages, setPages] = useState(1);
  const { data, error, isLoading } = useStaleWhileRevalidate(
    `work-packages:${packageId}:change-orders:${changeOrderId}:revisions:pages:${pages}`,
    async () => {
      const rows = [];
      const seen = new Set();
      for (let page = 0; page < pages; page += 1) {
        const batch = await api(
          `/api/work-packages/${packageId}/change-orders/${changeOrderId}/revisions?limit=${HISTORY_PAGE_SIZE}&offset=${page * HISTORY_PAGE_SIZE}`,
        ).then((b) => b.revisions);
        for (const row of batch || []) {
          if (!seen.has(row.id)) {
            seen.add(row.id);
            rows.push(row);
          }
        }
        if ((batch || []).length < HISTORY_PAGE_SIZE) break;
      }
      return rows;
    },
    { ttlMs: 10_000 },
  );
  if (isLoading) return <p className="mt-2 text-xs text-slate-500">Loading history…</p>;
  if (error) return <p className="mt-2 text-xs text-red-600">{error}</p>;
  const revisions = data || [];
  if (revisions.length === 0) return <p className="mt-2 text-xs text-slate-500">No history yet.</p>;
  return (
    <>
      <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-xs text-slate-600">
        {revisions.map((revision) => (
          <li key={revision.id}>
            <span className="font-medium text-slate-900">{ACTION_LABELS[revision.action] || revision.action}</span>
            {` — version ${revision.version} · ${formatWhen(revision.recordedAt)}`}
            {revision.reason ? ` · “${revision.reason}”` : ""}
            <span className="block text-slate-500">{revisionSummary(revision)}</span>
          </li>
        ))}
      </ul>
      {revisions.length === pages * HISTORY_PAGE_SIZE && (
        <button className={btnGhost} onClick={() => setPages((current) => current + 1)}>
          Show more history
        </button>
      )}
    </>
  );
}

function statusBadge(status) {
  const tone = status === "denied"
    ? "bg-red-100 text-red-800"
    : status === "po_approved"
      ? "bg-emerald-100 text-emerald-800"
      : status === "estimated"
        ? "bg-slate-100 text-slate-700"
        : "bg-blue-100 text-blue-800";
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${tone}`}>{changeOrderStatusLabel(status)}</span>;
}

export default function WorkPackageChangeOrders({ packageId, refreshKey = 0, onChanged = null }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [panelReason, setPanelReason] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [retiringId, setRetiringId] = useState(null);
  const [retireReason, setRetireReason] = useState("");
  const [historyId, setHistoryId] = useState(null);
  const [estimateOpen, setEstimateOpen] = useState(false);
  const [estimateForm, setEstimateForm] = useState(null);
  const [retiringEstimate, setRetiringEstimate] = useState(false);
  const [estimateRetireReason, setEstimateRetireReason] = useState("");
  const [editingRateKey, setEditingRateKey] = useState(null);
  const [rateForm, setRateForm] = useState(null);
  const [retiringRateId, setRetiringRateId] = useState(null);
  const [rateRetireReason, setRateRetireReason] = useState("");
  // Blank add-rows: the grid always fills the page (minimum 10) when
  // the package is open, so the next change order is typed in place.
  // A blank row's draft lives here until it has a description; only
  // then does it become a change order (the server assigns its number).
  const [drafts, setDrafts] = useState(() => Array.from({ length: BLANK_ROWS }, () => ({
    type: "other", description: "", estimatedCostCents: "",
  })));

  const { data, error: loadError, isLoading, refresh } = useStaleWhileRevalidate(
    `work-packages:${packageId}:change-orders:${refreshKey}`,
    () => api(`/api/work-packages/${packageId}/change-orders`),
    { ttlMs: 10_000 },
  );
  const summary = data?.summary || null;
  const changeOrders = data?.changeOrders || [];
  const packageStatus = data?.packageStatus || "";
  const isTerminal = packageStatus === "cancelled" || packageStatus === "verified_closed";
  const notApplied = Boolean(summary?.notApplied);

  const { data: retiredData, refresh: refreshRetired } = useStaleWhileRevalidate(
    showRetired ? `work-packages:${packageId}:change-orders:retired` : null,
    () => api(`/api/work-packages/${packageId}/change-orders?retiredOnly=true&limit=100&offset=0`),
    { ttlMs: 10_000 },
  );
  const retiredOrders = retiredData?.changeOrders || [];

  async function reload(message) {
    if (message) setConfirmation(message);
    await refresh();
    if (showRetired) await refreshRetired();
    if (onChanged) onChanged();
  }

  function requirePanelReason() {
    if (!panelReason.trim()) {
      throw new Error("Enter a reason for changes above first — every change order edit records its reason.");
    }
    return panelReason.trim();
  }

  // A grid cell commit: one field through the existing PATCH, guarded
  // by the change order's version and the panel's reason box.
  async function onCommitCell(order, field, value) {
    const reason = requirePanelReason();
    const patch = { expectedVersion: order.version, reason };
    if (field === "estimatedCostCents" || field === "approvedCostCents") {
      const parsed = parseDollarsToCents(value);
      if (!parsed.ok) throw new Error(parsed.error);
      patch[field] = parsed.cents;
    } else {
      patch[field] = value === "" ? null : value;
    }
    const updated = await api(`/api/work-packages/${packageId}/change-orders/${order.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    await reload(`Change order #${updated.changeOrder.changeOrderNumber} saved — ${updated.changeOrder.description}.`);
  }

  function updateDraft(index, patch) {
    setDrafts((current) => current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
    return { ...drafts[index], ...patch };
  }

  // Typing into a blank row: the draft is kept even when the
  // description is missing, and the row only becomes a change order
  // once it has a description. The server assigns the number — never
  // the client. A blank row's type defaults to Other; change it in
  // the row before committing, or edit it after.
  async function commitBlank(index, field, value) {
    const draft = updateDraft(index, { [field]: value });
    if (!draft.description.trim()) {
      setError("Give the new change order a description first — the row stays as a draft until it has one.");
      return;
    }
    // D17: "Reason for grid changes" sits above this single shared grid
    // (existing rows AND blank add-rows together) and is labeled required
    // on every edit, but only onCommitCell (editing an existing row)
    // enforced it — adding a new row through a blank row did not. Gate
    // creation the same way, and actually send it: the create endpoint
    // accepts and persists `reason` (p_reason), it just was never included
    // in this POST body.
    let reason;
    try {
      reason = requirePanelReason();
    } catch (e) {
      setError(e.message);
      return;
    }
    let estimatedCents = null;
    if (draft.estimatedCostCents !== "") {
      const parsed = parseDollarsToCents(draft.estimatedCostCents);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      estimatedCents = parsed.cents;
    }
    setBusy(true); setError(""); setConfirmation("");
    try {
      const created = await api(`/api/work-packages/${packageId}/change-orders`, {
        method: "POST",
        body: JSON.stringify({
          type: draft.type,
          description: draft.description.trim(),
          reason,
          ...(estimatedCents !== null ? { estimatedCostCents: estimatedCents } : {}),
        }),
      });
      setDrafts((current) => current.map((d, i) => (i === index
        ? { type: "other", description: "", estimatedCostCents: "" }
        : d)));
      await reload(`Change order #${created.changeOrder.changeOrderNumber} added — ${created.changeOrder.description}.`);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  function startEdit(order) {
    setEditingId(order.id);
    setRetiringId(null);
    setEditForm({
      type: order.type,
      description: order.description,
      estimatedCostCents: dollarsInputValue(order.estimatedCostCents),
      approvedCostCents: dollarsInputValue(order.approvedCostCents),
      actualCostCents: dollarsInputValue(order.actualCostCents),
      costCode: order.costCode || "",
      afeNo: order.afeNo || "",
      referenceContractNo: order.referenceContractNo || "",
      referencePoNumber: order.referencePoNumber || "",
      initiatorName: order.initiatorName || "",
      scheduleImpactDays: order.scheduleImpactDays == null ? "" : String(order.scheduleImpactDays),
      scheduleImpactNote: order.scheduleImpactNote || "",
      poNumber: order.poNumber || "",
      denialReason: order.denialReason || "",
      linkedStepId: order.linkedStepId || "",
      linkedDrawingId: order.linkedDrawingId || "",
      linkedTakeoffLineId: order.linkedTakeoffLineId || "",
      moveTo: "",
      movePoNumber: order.poNumber || "",
      moveDenialReason: order.denialReason || "",
      moveApprovedCostCents: dollarsInputValue(order.approvedCostCents),
      reason: panelReason,
    });
    setError(""); setConfirmation("");
  }

  async function onSaveEdit(event, order) {
    event.preventDefault();
    const parsed = {};
    for (const [field, label] of [
      ["estimatedCostCents", "Estimated cost"],
      ["approvedCostCents", "Approved cost"],
      ["actualCostCents", "Actual cost"],
    ]) {
      if (editForm[field] === "") {
        parsed[field] = null;
      } else {
        const result = parseDollarsToCents(editForm[field]);
        if (!result.ok) {
          setError(`${label}: ${result.error}`);
          return;
        }
        parsed[field] = result.cents;
      }
    }
    setBusy(true); setError(""); setConfirmation("");
    try {
      const updated = await api(`/api/work-packages/${packageId}/change-orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: order.version,
          type: editForm.type,
          description: editForm.description,
          estimatedCostCents: parsed.estimatedCostCents,
          approvedCostCents: parsed.approvedCostCents,
          actualCostCents: parsed.actualCostCents,
          costCode: editForm.costCode.trim() ? editForm.costCode.trim() : null,
          afeNo: editForm.afeNo.trim() ? editForm.afeNo.trim() : null,
          referenceContractNo: editForm.referenceContractNo.trim() ? editForm.referenceContractNo.trim() : null,
          referencePoNumber: editForm.referencePoNumber.trim() ? editForm.referencePoNumber.trim() : null,
          initiatorName: editForm.initiatorName.trim() ? editForm.initiatorName.trim() : null,
          scheduleImpactDays: editForm.scheduleImpactDays === "" ? null : Number(editForm.scheduleImpactDays),
          scheduleImpactNote: editForm.scheduleImpactNote.trim() ? editForm.scheduleImpactNote.trim() : null,
          poNumber: editForm.poNumber.trim() ? editForm.poNumber.trim() : null,
          denialReason: editForm.denialReason.trim() ? editForm.denialReason.trim() : null,
          linkedStepId: editForm.linkedStepId.trim() ? editForm.linkedStepId.trim() : null,
          linkedDrawingId: editForm.linkedDrawingId.trim() ? editForm.linkedDrawingId.trim() : null,
          linkedTakeoffLineId: editForm.linkedTakeoffLineId.trim() ? editForm.linkedTakeoffLineId.trim() : null,
          reason: editForm.reason.trim(),
        }),
      });
      setEditingId(null);
      setEditForm(null);
      await reload(`Change order #${updated.changeOrder.changeOrderNumber} saved — ${updated.changeOrder.description}.`);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function onMove(order) {
    if (!editForm.moveTo) {
      setError("Pick the next status first.");
      return;
    }
    let approvedCents = null;
    if (editForm.moveTo === "approved" && editForm.moveApprovedCostCents !== "") {
      const parsed = parseDollarsToCents(editForm.moveApprovedCostCents);
      if (!parsed.ok) {
        setError(`Approved cost: ${parsed.error}`);
        return;
      }
      approvedCents = parsed.cents;
    }
    setBusy(true); setError(""); setConfirmation("");
    try {
      const moved = await api(`/api/work-packages/${packageId}/change-orders/${order.id}/transition`, {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: order.version,
          toStatus: editForm.moveTo,
          ...(editForm.moveTo === "approved" ? { approvedCostCents: approvedCents } : {}),
          ...((editForm.moveTo === "po_requested" || editForm.moveTo === "po_approved")
            ? { poNumber: editForm.movePoNumber.trim() } : {}),
          ...(editForm.moveTo === "denied" ? { denialReason: editForm.moveDenialReason.trim() } : {}),
          reason: editForm.reason.trim(),
        }),
      });
      setEditingId(null);
      setEditForm(null);
      await reload(`Change order #${moved.changeOrder.changeOrderNumber} moved to ${changeOrderStatusLabel(moved.changeOrder.status)} — ${moved.changeOrder.description}.`);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function onConfirmRetire(order) {
    setBusy(true); setError(""); setConfirmation("");
    try {
      const retired = await api(`/api/work-packages/${packageId}/change-orders/${order.id}/retire`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: order.version, reason: retireReason }),
      });
      setRetiringId(null);
      setRetireReason("");
      await reload(`Change order #${retired.changeOrder.changeOrderNumber} retired — ${retired.changeOrder.description}.`);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  function startEstimateEdit() {
    setEstimateOpen(true);
    setEstimateForm({
      originalCents: dollarsInputValue(summary?.originalControlEstimateCents ?? null),
      currentCents: dollarsInputValue(summary?.currentEstimateCents ?? null),
      contingencyCents: dollarsInputValue(summary?.contingencyCents ?? null),
      reason: "",
    });
    setError(""); setConfirmation("");
  }

  async function onSaveEstimate(event) {
    event.preventDefault();
    const parsed = {};
    for (const [field, label] of [
      ["originalCents", "Original control estimate"],
      ["currentCents", "Current estimate"],
      ["contingencyCents", "Contingency"],
    ]) {
      if (estimateForm[field] === "") {
        parsed[field] = null;
      } else {
        const result = parseDollarsToCents(estimateForm[field]);
        if (!result.ok) {
          setError(`${label}: ${result.error}`);
          return;
        }
        parsed[field] = result.cents;
      }
    }
    setBusy(true); setError(""); setConfirmation("");
    try {
      const saved = await api(`/api/work-packages/${packageId}/control-estimate`, {
        method: "PUT",
        body: JSON.stringify({
          originalCents: parsed.originalCents,
          currentCents: parsed.currentCents,
          contingencyCents: parsed.contingencyCents,
          expectedVersion: summary?.estimateVersion ?? null,
          reason: estimateForm.reason.trim(),
        }),
      });
      setEstimateOpen(false);
      setEstimateForm(null);
      await reload(`Control estimate saved — original ${money(saved.estimate.originalControlEstimateCents)}, current ${money(saved.estimate.currentControlEstimateCents)}.`);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function onConfirmRetireEstimate() {
    setBusy(true); setError(""); setConfirmation("");
    try {
      await api(`/api/work-packages/${packageId}/control-estimate/retire`, {
        method: "POST",
        body: JSON.stringify({
          estimateId: summary?.estimateId,
          expectedVersion: summary?.estimateVersion,
          reason: estimateRetireReason,
        }),
      });
      setRetiringEstimate(false);
      setEstimateRetireReason("");
      await reload("Control estimate retired — the package has no control estimate now.");
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  function startRateEdit(craft) {
    setEditingRateKey(craft.craftKey);
    setRateForm({
      craftKey: craft.craftKey,
      craftLabel: craft.craftLabel,
      rateDollars: (craft.rateCentsPerHour / 100).toFixed(2),
      expectedVersion: craft.rateVersion ?? null,
      reason: "",
    });
    setError(""); setConfirmation("");
  }

  async function onSaveRate(event, craft) {
    event.preventDefault();
    const parsed = parseDollarsToCents(rateForm.rateDollars);
    if (!parsed.ok) {
      setError(`Labor rate: ${parsed.error}`);
      return;
    }
    setBusy(true); setError(""); setConfirmation("");
    try {
      const saved = await api(`/api/work-packages/${packageId}/craft-rates`, {
        method: "PUT",
        body: JSON.stringify({
          craftKey: rateForm.craftKey,
          craftLabel: rateForm.craftLabel,
          rateCentsPerHour: parsed.cents,
          expectedVersion: rateForm.expectedVersion,
          reason: rateForm.reason.trim(),
        }),
      });
      setEditingRateKey(null);
      setRateForm(null);
      await reload(`Labor rate saved — ${saved.craftRate.craftLabel} at ${formatRatePerHour(saved.craftRate.rateCentsPerHour)}.`);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function onConfirmRetireRate(craft) {
    setBusy(true); setError(""); setConfirmation("");
    try {
      await api(`/api/work-packages/${packageId}/craft-rates/${craft.rateId}/retire`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: craft.rateVersion, reason: rateRetireReason }),
      });
      setRetiringRateId(null);
      setRateRetireReason("");
      await reload(`Labor rate reverted to the default — ${craft.craftLabel} is back at ${formatRatePerHour(DEFAULT_CRAFT_RATE_CENTS_PER_HOUR)}.`);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  const validateMoney = (next) => {
    if (next.trim() === "") return null;
    return parseDollarsToCents(next).ok ? null : "Enter a dollar amount with at most two decimal places.";
  };

  function renderOrderRow(order) {
    const cellError = (text) => setError(text);
    const nextStatuses = ALLOWED_TRANSITIONS[order.status] || [];
    return (
      <Fragment key={order.id}>
        <div role="row" data-change-order-id={order.id}
          onClick={() => setSelectedId(order.id)}
          className={`grid ${CO_GRID_COLS} items-center gap-x-2 border-b border-slate-200 px-3 py-2 text-sm ${selectedId === order.id ? "bg-blue-50" : "hover:bg-slate-50"}`}>
          <div role="cell" className="min-w-0 truncate font-medium text-slate-900" title={`Change order #${order.changeOrderNumber}, version ${order.version}`}>
            #{order.changeOrderNumber}
          </div>
          <EditableGridCell
            value={order.type}
            display={changeOrderTypeLabel(order.type)}
            editor="select"
            options={CHANGE_ORDER_TYPES.map((type) => ({ value: type.value, label: type.label }))}
            ariaLabel={`Type for change order ${order.changeOrderNumber}`}
            readOnly={isTerminal}
            onCommit={(next) => onCommitCell(order, "type", next)}
            onError={cellError}
            className="text-slate-700"
          />
          <EditableGridCell
            value={order.description}
            display={order.description}
            ariaLabel={`Description for change order ${order.changeOrderNumber}`}
            readOnly={isTerminal}
            validate={(next) => (next.trim() === "" ? "Description is required." : null)}
            onCommit={(next) => onCommitCell(order, "description", next)}
            onError={cellError}
            className="font-medium text-slate-900"
          />
          <div role="cell" className="min-w-0">{statusBadge(order.status)}</div>
          <EditableGridCell
            value={dollarsInputValue(order.estimatedCostCents)}
            display={order.estimatedCostCents == null ? "—" : money(order.estimatedCostCents)}
            editor="number" ariaLabel={`Estimated cost for change order ${order.changeOrderNumber}`}
            readOnly={isTerminal} validate={validateMoney}
            onCommit={(next) => onCommitCell(order, "estimatedCostCents", next)}
            onError={cellError}
            className="text-slate-700"
          />
          <EditableGridCell
            value={dollarsInputValue(order.approvedCostCents)}
            display={order.approvedCostCents == null ? "—" : money(order.approvedCostCents)}
            editor="number" ariaLabel={`Approved cost for change order ${order.changeOrderNumber}`}
            readOnly={isTerminal} validate={validateMoney}
            onCommit={(next) => onCommitCell(order, "approvedCostCents", next)}
            onError={cellError}
            className="text-slate-700"
          />
          <EditableGridCell
            value={order.poNumber || ""}
            display={order.poNumber || "—"}
            ariaLabel={`PO number for change order ${order.changeOrderNumber}`}
            readOnly={isTerminal}
            onCommit={(next) => onCommitCell(order, "poNumber", next)}
            onError={cellError}
            className="text-slate-700"
          />
          <div role="cell" className="flex min-w-0 flex-wrap gap-1">
            {!isTerminal && (
              <>
                <button className={btnGhost} disabled={busy} onClick={() => startEdit(order)}>Edit</button>
                <button className={btnGhost} disabled={busy}
                  onClick={() => { setRetiringId(order.id); setRetireReason(""); setEditingId(null); }}>
                  Retire
                </button>
              </>
            )}
            <button className={btnGhost} disabled={busy}
              onClick={() => setHistoryId((current) => (current === order.id ? null : order.id))}>
              {historyId === order.id ? "Hide history" : "History"}
            </button>
          </div>
        </div>
        {editingId === order.id && editForm && (
          <div role="row" className={`grid ${CO_GRID_COLS} border-b border-slate-200 bg-slate-50 px-3 py-3`}>
            <div role="cell" className="col-span-8">
              <form onSubmit={(e) => onSaveEdit(e, order)} className="space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="flex-1">
                    <label className={label} htmlFor={`co-type-${order.id}`}>Type</label>
                    <select id={`co-type-${order.id}`} className={input} value={editForm.type}
                      onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value }))}>
                      {CHANGE_ORDER_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>{type.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-[2]">
                    <label className={label} htmlFor={`co-desc-${order.id}`}>Description</label>
                    <input id={`co-desc-${order.id}`} className={input} value={editForm.description}
                      onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                      required maxLength={4000} />
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="flex-1">
                    <label className={label} htmlFor={`co-est-${order.id}`}>Estimated cost (dollars)</label>
                    <input id={`co-est-${order.id}`} className={input} inputMode="decimal" placeholder="0.00"
                      value={editForm.estimatedCostCents}
                      onChange={(e) => setEditForm((f) => ({ ...f, estimatedCostCents: e.target.value }))} />
                  </div>
                  <div className="flex-1">
                    <label className={label} htmlFor={`co-app-${order.id}`}>Approved cost (dollars)</label>
                    <input id={`co-app-${order.id}`} className={input} inputMode="decimal" placeholder="0.00"
                      value={editForm.approvedCostCents}
                      onChange={(e) => setEditForm((f) => ({ ...f, approvedCostCents: e.target.value }))} />
                  </div>
                  <div className="flex-1">
                    <label className={label} htmlFor={`co-act-${order.id}`}>Actual cost (dollars)</label>
                    <input id={`co-act-${order.id}`} className={input} inputMode="decimal" placeholder="0.00"
                      value={editForm.actualCostCents}
                      onChange={(e) => setEditForm((f) => ({ ...f, actualCostCents: e.target.value }))} />
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="flex-1">
                    <label className={label} htmlFor={`co-code-${order.id}`}>Cost code</label>
                    <input id={`co-code-${order.id}`} className={input} value={editForm.costCode}
                      onChange={(e) => setEditForm((f) => ({ ...f, costCode: e.target.value }))} maxLength={80} />
                  </div>
                  <div className="flex-1">
                    <label className={label} htmlFor={`co-afe-${order.id}`}>AFE number</label>
                    <input id={`co-afe-${order.id}`} className={input} value={editForm.afeNo}
                      onChange={(e) => setEditForm((f) => ({ ...f, afeNo: e.target.value }))} maxLength={80} />
                  </div>
                  <div className="flex-1">
                    <label className={label} htmlFor={`co-ref-${order.id}`}>Reference contract</label>
                    <input id={`co-ref-${order.id}`} className={input} value={editForm.referenceContractNo}
                      onChange={(e) => setEditForm((f) => ({ ...f, referenceContractNo: e.target.value }))} maxLength={80} />
                  </div>
                  <div className="flex-1">
                    <label className={label} htmlFor={`co-refpo-${order.id}`}>Reference PO</label>
                    <input id={`co-refpo-${order.id}`} className={input} value={editForm.referencePoNumber}
                      onChange={(e) => setEditForm((f) => ({ ...f, referencePoNumber: e.target.value }))} maxLength={80} />
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="flex-1">
                    <label className={label} htmlFor={`co-init-${order.id}`}>Initiator</label>
                    <input id={`co-init-${order.id}`} className={input} value={editForm.initiatorName}
                      onChange={(e) => setEditForm((f) => ({ ...f, initiatorName: e.target.value }))} maxLength={120} />
                  </div>
                  <div>
                    <label className={label} htmlFor={`co-days-${order.id}`}>Schedule impact (days)</label>
                    <input id={`co-days-${order.id}`} className={input} type="number" min="-366" max="366" step="1"
                      value={editForm.scheduleImpactDays}
                      onChange={(e) => setEditForm((f) => ({ ...f, scheduleImpactDays: e.target.value }))} />
                  </div>
                  <div className="flex-1">
                    <label className={label} htmlFor={`co-note-${order.id}`}>Schedule impact note</label>
                    <input id={`co-note-${order.id}`} className={input} value={editForm.scheduleImpactNote}
                      onChange={(e) => setEditForm((f) => ({ ...f, scheduleImpactNote: e.target.value }))} maxLength={1000} />
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="flex-1">
                    <label className={label} htmlFor={`co-po-${order.id}`}>PO number</label>
                    <input id={`co-po-${order.id}`} className={input} value={editForm.poNumber}
                      onChange={(e) => setEditForm((f) => ({ ...f, poNumber: e.target.value }))} maxLength={80} />
                  </div>
                  <div className="flex-1">
                    <label className={label} htmlFor={`co-deny-${order.id}`}>Denial reason</label>
                    <input id={`co-deny-${order.id}`} className={input} value={editForm.denialReason}
                      onChange={(e) => setEditForm((f) => ({ ...f, denialReason: e.target.value }))} maxLength={1000} />
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="flex-1">
                    <label className={label} htmlFor={`co-step-${order.id}`}>Linked step (optional row id)</label>
                    <input id={`co-step-${order.id}`} className={input} value={editForm.linkedStepId}
                      onChange={(e) => setEditForm((f) => ({ ...f, linkedStepId: e.target.value }))} />
                  </div>
                  <div className="flex-1">
                    <label className={label} htmlFor={`co-dwg-${order.id}`}>Linked drawing (optional row id)</label>
                    <input id={`co-dwg-${order.id}`} className={input} value={editForm.linkedDrawingId}
                      onChange={(e) => setEditForm((f) => ({ ...f, linkedDrawingId: e.target.value }))} />
                  </div>
                  <div className="flex-1">
                    <label className={label} htmlFor={`co-tl-${order.id}`}>Linked takeoff line (optional row id)</label>
                    <input id={`co-tl-${order.id}`} className={input} value={editForm.linkedTakeoffLineId}
                      onChange={(e) => setEditForm((f) => ({ ...f, linkedTakeoffLineId: e.target.value }))} />
                  </div>
                </div>
                <input className={input} aria-label="Reason for this change"
                  placeholder="Reason for this change (required)"
                  value={editForm.reason}
                  onChange={(e) => setEditForm((f) => ({ ...f, reason: e.target.value }))}
                  maxLength={1000} required />
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className={btnPrimary} disabled={busy}>Save changes</button>
                  <button type="button" className={btnGhost} disabled={busy}
                    onClick={() => { setEditingId(null); setEditForm(null); }}>Cancel</button>
                </div>
                {nextStatuses.length > 0 && (
                  <div className="flex flex-col gap-2 border-t border-slate-200 pt-3 sm:flex-row sm:items-end">
                    <div className="flex-1">
                      <label className={label} htmlFor={`co-move-${order.id}`}>Move to</label>
                      <select id={`co-move-${order.id}`} className={input} value={editForm.moveTo}
                        onChange={(e) => setEditForm((f) => ({ ...f, moveTo: e.target.value }))}>
                        <option value="">Move to…</option>
                        {nextStatuses.map((status) => (
                          <option key={status} value={status}>{changeOrderStatusLabel(status)}</option>
                        ))}
                      </select>
                    </div>
                    {editForm.moveTo === "approved" && (
                      <div className="flex-1">
                        <label className={label} htmlFor={`co-move-app-${order.id}`}>Approved cost (dollars, optional)</label>
                        <input id={`co-move-app-${order.id}`} className={input} inputMode="decimal" placeholder="0.00"
                          value={editForm.moveApprovedCostCents}
                          onChange={(e) => setEditForm((f) => ({ ...f, moveApprovedCostCents: e.target.value }))} />
                      </div>
                    )}
                    {(editForm.moveTo === "po_requested" || editForm.moveTo === "po_approved") && (
                      <div className="flex-1">
                        <label className={label} htmlFor={`co-move-po-${order.id}`}>PO number (required)</label>
                        <input id={`co-move-po-${order.id}`} className={input} value={editForm.movePoNumber}
                          onChange={(e) => setEditForm((f) => ({ ...f, movePoNumber: e.target.value }))} maxLength={80} required />
                      </div>
                    )}
                    {editForm.moveTo === "denied" && (
                      <div className="flex-1">
                        <label className={label} htmlFor={`co-move-deny-${order.id}`}>Denial reason (required)</label>
                        <input id={`co-move-deny-${order.id}`} className={input} value={editForm.moveDenialReason}
                          onChange={(e) => setEditForm((f) => ({ ...f, moveDenialReason: e.target.value }))} maxLength={1000} required />
                      </div>
                    )}
                    <button type="button" className={btnPrimary} disabled={busy || !editForm.moveTo}
                      onClick={() => onMove(order)}>
                      Move status
                    </button>
                  </div>
                )}
              </form>
            </div>
          </div>
        )}
        {retiringId === order.id && (
          <div role="row" className={`grid ${CO_GRID_COLS} border-b border-slate-200 bg-slate-50 px-3 py-3`}>
            <div role="cell" className="col-span-8 space-y-2">
              <input className={input} aria-label="Reason for retiring" placeholder="Reason for retiring (required)"
                value={retireReason} onChange={(e) => setRetireReason(e.target.value)} maxLength={1000} required />
              <div className="flex gap-2">
                <button className={btnPrimary} disabled={busy || !retireReason.trim()}
                  onClick={() => onConfirmRetire(order)}>
                  Retire this change order
                </button>
                <button className={btnGhost} disabled={busy}
                  onClick={() => { setRetiringId(null); setRetireReason(""); }}>
                  Keep it
                </button>
              </div>
            </div>
          </div>
        )}
        {historyId === order.id && (
          <div role="row" className={`grid ${CO_GRID_COLS} border-b border-slate-200 bg-slate-50 px-3 py-3`}>
            <div role="cell" className="col-span-8">
              <ChangeOrderHistory packageId={packageId} changeOrderId={order.id} />
            </div>
          </div>
        )}
      </Fragment>
    );
  }

  function renderBlankRow(draft, index) {
    const cellError = (text) => setError(text);
    return (
      <div role="row" key={`blank-${index}`}
        className={`grid ${CO_GRID_COLS} items-center gap-x-2 border-b border-slate-200 px-3 py-2 text-sm hover:bg-slate-50`}>
        <div role="cell" className="min-w-0 truncate text-slate-400">—</div>
        <EditableGridCell
          value={draft.type}
          display={changeOrderTypeLabel(draft.type)}
          editor="select"
          options={CHANGE_ORDER_TYPES.map((type) => ({ value: type.value, label: type.label }))}
          ariaLabel={`Type for new change order ${index + 1}`}
          onCommit={(next) => commitBlank(index, "type", next)}
          onError={cellError}
          className="text-slate-700"
        />
        <EditableGridCell
          value={draft.description}
          display={draft.description || "New change order description…"}
          placeholder="New change order description…"
          ariaLabel={`Description for new change order ${index + 1}`}
          onCommit={(next) => commitBlank(index, "description", next)}
          onError={cellError}
          className="text-slate-500"
        />
        <div role="cell" className="min-w-0 text-slate-400">—</div>
        <EditableGridCell
          value={draft.estimatedCostCents}
          display={draft.estimatedCostCents || "—"}
          editor="number" ariaLabel={`Estimated cost for new change order ${index + 1}`}
          validate={validateMoney}
          onCommit={(next) => commitBlank(index, "estimatedCostCents", next)}
          onError={cellError}
          className="text-slate-700"
        />
        <div role="cell" className="min-w-0 text-slate-400">—</div>
        <div role="cell" className="min-w-0 text-slate-400">—</div>
        <div role="cell" className="min-w-0 text-xs text-slate-400">Type a description to add it</div>
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5" aria-label="Change Orders Log">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Change Orders Log</h2>
        {!isTerminal && !notApplied && (
          <button className={btnGhost} disabled={busy} onClick={startEstimateEdit}>
            {summary?.hasEstimate ? "Edit control estimate" : "Set control estimate"}
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Every change order on this package — busts are one type among all of them. A Deviation draws
        from contingency and never touches the contract price; every other counted type rolls into
        it. Labor cost is the planned step hours at each craft&apos;s rate.
      </p>

      {isTerminal && (
        <p className="mt-2 text-sm text-amber-700">
          This package is closed — the Change Orders Log is read-only.
        </p>
      )}
      {notApplied && (
        <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          The Change Orders Log isn&apos;t available yet — the database change for this feature hasn&apos;t been applied.
        </p>
      )}
      {loadError && <p className="mt-2 text-sm text-red-600">{loadError}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {confirmation && <p className="mt-2 text-sm text-emerald-700">{confirmation}</p>}

      {isLoading ? (
        <p className="mt-3 text-xs text-slate-500">Loading Change Orders Log…</p>
      ) : loadError || notApplied ? null : summary && (
        <>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <dt className="text-xs font-medium text-slate-500">Original control estimate</dt>
              <dd className="mt-0.5 text-sm font-medium text-slate-900">
                {summary.hasEstimate ? money(summary.originalControlEstimateCents) : "No estimate set"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Running contract price</dt>
              <dd className="mt-0.5 text-sm font-medium text-slate-900">
                {summary.runningContractPriceCents == null ? "—" : money(summary.runningContractPriceCents)}
              </dd>
              <dd className="mt-0.5 text-xs text-slate-500">
                {summary.countedNonDeviationCents > 0
                  ? `${money(summary.countedNonDeviationCents)} in counted change orders`
                  : "No counted change orders yet."}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Planned labor cost</dt>
              <dd className="mt-0.5 text-sm font-medium text-slate-900">
                {summary.laborCostCents == null ? "Unavailable" : money(summary.laborCostCents)}
              </dd>
              <dd className="mt-0.5 text-xs text-slate-500">
                Planned step hours at each craft&apos;s rate.
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Current total job estimate</dt>
              <dd className="mt-0.5 text-sm font-medium text-slate-900">
                {summary.totalJobCostCents == null ? "—" : money(summary.totalJobCostCents)}
              </dd>
              <dd className="mt-0.5 text-xs text-slate-500">Contract price + planned labor.</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Contingency remaining</dt>
              <dd className={`mt-0.5 text-sm font-medium ${summary.contingencyRemainingCents != null && summary.contingencyRemainingCents < 0 ? "text-red-700" : "text-slate-900"}`}>
                {summary.contingencyCents == null
                  ? "No contingency pool"
                  : money(summary.contingencyRemainingCents)}
              </dd>
              <dd className="mt-0.5 text-xs text-slate-500">
                {summary.countedDeviationCents > 0
                  ? `${money(summary.countedDeviationCents)} drawn by counted Deviations`
                  : "No counted Deviations yet."}
              </dd>
            </div>
          </dl>

          <div className="mt-3 flex flex-wrap gap-2">
            {CHANGE_ORDER_STATUSES.map((status) => (
              <span key={status.value} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                {status.label}: {summary.countsByStatus?.[status.value] ?? 0}
              </span>
            ))}
          </div>

          {summary.warnings?.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-800">
              {summary.warnings.map((warning) => (
                <li key={warning.code}>{warning.message}</li>
              ))}
            </ul>
          )}

          {estimateOpen && estimateForm && !isTerminal && (
            <form onSubmit={onSaveEstimate} className="mt-5 space-y-2 border-t border-slate-100 pt-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex-1">
                  <label className={label} htmlFor="estimate-original">Original control estimate (dollars)</label>
                  <input id="estimate-original" className={input} inputMode="decimal" placeholder="0.00"
                    value={estimateForm.originalCents}
                    onChange={(e) => setEstimateForm((f) => ({ ...f, originalCents: e.target.value }))} required />
                </div>
                <div className="flex-1">
                  <label className={label} htmlFor="estimate-current">Current estimate (dollars)</label>
                  <input id="estimate-current" className={input} inputMode="decimal" placeholder="Same as original"
                    value={estimateForm.currentCents}
                    onChange={(e) => setEstimateForm((f) => ({ ...f, currentCents: e.target.value }))} />
                  <p className="mt-1 text-xs text-slate-500">Leave blank to keep the current estimate unchanged.</p>
                </div>
                <div className="flex-1">
                  <label className={label} htmlFor="estimate-contingency">Contingency pool (dollars)</label>
                  <input id="estimate-contingency" className={input} inputMode="decimal" placeholder="0.00"
                    value={estimateForm.contingencyCents}
                    onChange={(e) => setEstimateForm((f) => ({ ...f, contingencyCents: e.target.value }))} />
                  <p className="mt-1 text-xs text-slate-500">Leave blank for no contingency pool.</p>
                </div>
              </div>
              <input className={input} aria-label="Reason for this estimate change"
                placeholder="Reason for this change (required)"
                value={estimateForm.reason}
                onChange={(e) => setEstimateForm((f) => ({ ...f, reason: e.target.value }))}
                maxLength={1000} required />
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={btnPrimary} disabled={busy}>Save control estimate</button>
                <button type="button" className={btnGhost} disabled={busy}
                  onClick={() => { setEstimateOpen(false); setEstimateForm(null); }}>Cancel</button>
                {summary.hasEstimate && (
                  <button type="button" className={btnGhost} disabled={busy}
                    onClick={() => { setRetiringEstimate(true); setEstimateRetireReason(""); }}>
                    Retire this estimate
                  </button>
                )}
              </div>
            </form>
          )}
          {retiringEstimate && (
            <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
              <input className={input} aria-label="Reason for retiring the control estimate"
                placeholder="Reason for retiring (required)"
                value={estimateRetireReason} onChange={(e) => setEstimateRetireReason(e.target.value)}
                maxLength={1000} required />
              <div className="flex gap-2">
                <button className={btnPrimary} disabled={busy || !estimateRetireReason.trim()}
                  onClick={onConfirmRetireEstimate}>
                  Retire this estimate
                </button>
                <button className={btnGhost} disabled={busy}
                  onClick={() => { setRetiringEstimate(false); setEstimateRetireReason(""); }}>
                  Keep it
                </button>
              </div>
            </div>
          )}

          {summary.laborByCraft?.length > 0 && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <h3 className="text-xs font-semibold text-slate-900">Labor rates by craft</h3>
              <p className="mt-1 text-xs text-slate-500">
                Planned step hours at each craft&apos;s rate. A craft with no stored rate uses the
                $89.00/hr default.
              </p>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-1 pr-2 font-semibold">Craft</th>
                    <th className="py-1 pr-2 font-semibold">Planned hours</th>
                    <th className="py-1 pr-2 font-semibold">Rate</th>
                    <th className="py-1 pr-2 font-semibold">Labor cost</th>
                    <th className="py-1 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.laborByCraft.map((craft) => (
                    <Fragment key={craft.craftKey}>
                      <tr className="border-b border-slate-100">
                        <td className="py-1 pr-2 font-medium text-slate-900">{craft.craftLabel}</td>
                        <td className="py-1 pr-2 text-slate-700">{craft.plannedHours}</td>
                        <td className="py-1 pr-2 text-slate-700">
                          {formatRatePerHour(craft.rateCentsPerHour)}
                          {craft.isDefaultRate && (
                            <span className="ml-2 rounded bg-slate-100 px-1 text-xs text-slate-600">default</span>
                          )}
                        </td>
                        <td className="py-1 pr-2 text-slate-700">{money(craft.laborCostCents)}</td>
                        <td className="py-1">
                          {!isTerminal && (
                            <button className={btnGhost} disabled={busy} onClick={() => startRateEdit(craft)}>
                              Edit rate
                            </button>
                          )}
                        </td>
                      </tr>
                      {editingRateKey === craft.craftKey && rateForm && (
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <td colSpan={5} className="px-3 py-3">
                            <form onSubmit={(e) => onSaveRate(e, craft)} className="space-y-2">
                              <div className="flex flex-col gap-2 sm:flex-row">
                                <div className="flex-1">
                                  <label className={label} htmlFor={`rate-${craft.craftKey}`}>Rate for {craft.craftLabel} (dollars per hour)</label>
                                  <input id={`rate-${craft.craftKey}`} className={input} inputMode="decimal"
                                    value={rateForm.rateDollars}
                                    onChange={(e) => setRateForm((f) => ({ ...f, rateDollars: e.target.value }))}
                                    required />
                                </div>
                                <div className="flex-1">
                                  <label className={label} htmlFor={`rate-reason-${craft.craftKey}`}>Reason (required)</label>
                                  <input id={`rate-reason-${craft.craftKey}`} className={input}
                                    value={rateForm.reason}
                                    onChange={(e) => setRateForm((f) => ({ ...f, reason: e.target.value }))}
                                    maxLength={1000} required />
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button type="submit" className={btnPrimary} disabled={busy}>Save rate</button>
                                <button type="button" className={btnGhost} disabled={busy}
                                  onClick={() => { setEditingRateKey(null); setRateForm(null); }}>Cancel</button>
                                {!craft.isDefaultRate && (
                                  <button type="button" className={btnGhost} disabled={busy}
                                    onClick={() => { setRetiringRateId(craft.rateId); setRateRetireReason(""); }}>
                                    Revert to default
                                  </button>
                                )}
                              </div>
                            </form>
                            {retiringRateId === craft.rateId && (
                              <div className="mt-2 space-y-2">
                                <input className={input} aria-label="Reason for reverting the rate"
                                  placeholder="Reason for reverting (required)"
                                  value={rateRetireReason} onChange={(e) => setRateRetireReason(e.target.value)}
                                  maxLength={1000} required />
                                <div className="flex gap-2">
                                  <button className={btnPrimary} disabled={busy || !rateRetireReason.trim()}
                                    onClick={() => onConfirmRetireRate(craft)}>
                                    Revert to default
                                  </button>
                                  <button className={btnGhost} disabled={busy}
                                    onClick={() => { setRetiringRateId(null); setRateRetireReason(""); }}>
                                    Keep it
                                  </button>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!isTerminal && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <label className={label} htmlFor="co-panel-reason">Reason for grid changes</label>
              <input id="co-panel-reason" className={input} placeholder="Why these change order edits (required — recorded on every edit)"
                value={panelReason} onChange={(e) => setPanelReason(e.target.value)} maxLength={1000} />
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
              Show retired
            </label>
          </div>

          <div role="table" aria-label="Change orders" className="mt-4 border-t border-slate-300">
            <div role="row" className={`grid ${CO_GRID_COLS} items-center gap-x-2 border-b-2 border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500`}>
              <div role="columnheader">#</div>
              <div role="columnheader">Type</div>
              <div role="columnheader">Description</div>
              <div role="columnheader">Status</div>
              <div role="columnheader">Estimated</div>
              <div role="columnheader">Approved</div>
              <div role="columnheader">PO #</div>
              <div role="columnheader">Actions</div>
            </div>
            {changeOrders.map((order) => renderOrderRow(order))}
            {!isTerminal && drafts.map((draft, index) => renderBlankRow(draft, index))}
            {isTerminal && changeOrders.length === 0 && (
              <p className="px-3 py-3 text-sm text-slate-500">This package is closed — no change orders were added.</p>
            )}
            {!isTerminal && changeOrders.length === 0 && (
              <p className="px-3 py-3 text-sm text-slate-500">No change orders yet — type the first one in a blank row above.</p>
            )}
          </div>

          {showRetired && retiredOrders.length > 0 && (
            <div className="mt-4 border-t border-slate-200 pt-3">
              <h3 className="text-xs font-semibold text-slate-900">Retired change orders</h3>
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                {retiredOrders.map((order) => (
                  <li key={order.id}>
                    #{order.changeOrderNumber} — {changeOrderTypeLabel(order.type)} — {order.description}
                    <span className="text-slate-400"> (retired)</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
