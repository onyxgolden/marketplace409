// D2b budget allocation — the package entry/edit surface.
//
// The five-way split of a work package's ACTIVE CONTROL ESTIMATE.
// The editor keeps a local draft until the lines add up to the
// control estimate exactly; there is no endpoint for an unreconciled
// partial save. Every save and every delete carries a required
// reason, recorded in the revision audit.
//
// "Use planned labor estimate" copies the Slice 8 planned labor
// forecast into a DRAFT Labor line only — the user confirms it by
// saving; the forecast is never added to the five-way total on its
// own, and a later step/rate edit never rewrites a saved allocation.
"use client";

import { useEffect, useRef, useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { usePageQuery, usePackagePageContext } from "./packagePageContext.jsx";
import { scopedSWRKey } from "./workspaceQuery.js";
import {
  BUDGET_CATEGORIES,
  budgetCategoryLabel,
  computeLaborVariance,
  parseBudgetLineAmountToCents,
} from "@/domains/work-management/budgetAllocations";
import { formatCents } from "@/domains/work-management/packageCosts.js";
import { formatPackageCode } from "@/domains/work-management/workPackage.js";

const input = "min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const label = "block text-xs font-medium text-slate-600 mb-1";
// Fix round 1 P2: every action on this surface is a real ~44px touch
// target (min-h-11) — the old py-1.5 buttons measured ~32–34px.
const btn = "min-h-11 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const btnPrimary = `${btn} bg-slate-900 text-white hover:bg-slate-700`;
const btnGhost = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;

async function api(pageQuery, path, options) {
  const response = await fetch(pageQuery(path), {
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

let draftKeyCounter = 0;
function nextDraftKey() {
  draftKeyCounter += 1;
  return `draft-${draftKeyCounter}`;
}

function blankDraftLine(category = "labor") {
  return { key: nextDraftKey(), id: null, category, description: "", amount: "" };
}

function draftLineFromSaved(line) {
  return {
    key: line.id,
    id: line.id,
    category: line.category,
    description: line.description,
    amount: dollarsInputValue(line.amountCents),
  };
}

export default function WorkPackageBudgetAllocation({
  packageId,
  isTerminal = false,
  refreshKey = 0,
  onChanged = null,
  onRequestEstimateEdit = null,
  highlightCategory = null,
  onClearHighlight = null,
  onBackToDashboard = null,
}) {
  const pageQuery = usePageQuery();
  const pageContext = usePackagePageContext();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftLines, setDraftLines] = useState([]);
  const [draftReason, setDraftReason] = useState("");
  const [retiring, setRetiring] = useState(false);
  const [retireReason, setRetireReason] = useState("");

  const { data, error: loadError, isLoading, refresh } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "budget-allocation", refreshKey),
    () => api(pageQuery, `/api/work-packages/${packageId}/budget-allocation`),
    { ttlMs: 10_000 },
  );
  const estimate = data?.estimate || null;
  const allocation = data?.allocation || null;
  const packageCode = data?.packageCode || null;
  const packageTitle = data?.packageTitle || null;
  const packageName = (packageCode ? formatPackageCode(packageCode) : null) || packageTitle || packageId;
  const plannedLaborForecastCents = data?.plannedLaborForecastCents ?? null;
  const notApplied = Boolean(data?.notApplied);
  const estimateCents = estimate?.currentControlEstimateCents ?? null;
  // D4 drill: the dashboard lands here with a category to highlight.
  // "all" shows every line; a single category highlights its rows.
  const highlightedLines = highlightCategory && highlightCategory !== "all" && allocation
    ? allocation.lines.filter((line) => line.category === highlightCategory)
    : null;
  const highlightLabel = highlightCategory === "all"
    ? "all categories"
    : highlightCategory
      ? budgetCategoryLabel(highlightCategory)
      : null;
  const sectionRef = useRef(null);
  useEffect(() => {
    // Guarded for jsdom, which has no scrollIntoView.
    if (highlightCategory && sectionRef.current && typeof sectionRef.current.scrollIntoView === "function") {
      sectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [highlightCategory, allocation]);

  async function reload(message) {
    if (message) setConfirmation(message);
    await refresh();
    if (onChanged) onChanged();
  }

  function startCreate() {
    setDraftLines([blankDraftLine()]);
    setDraftReason("");
    setEditing(true);
    setError("");
    setConfirmation("");
  }

  function startEdit() {
    setDraftLines((allocation?.lines || []).map(draftLineFromSaved));
    setDraftReason("");
    setEditing(true);
    setError("");
    setConfirmation("");
  }

  function cancelEdit() {
    setEditing(false);
    setDraftLines([]);
    setDraftReason("");
    setError("");
  }

  function updateDraftLine(key, patch) {
    setDraftLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function usePlannedLabor() {
    if (plannedLaborForecastCents == null) return;
    setDraftLines((current) => [
      ...current,
      {
        ...blankDraftLine("labor"),
        description: "Planned labor",
        amount: (plannedLaborForecastCents / 100).toFixed(2),
      },
    ]);
    setConfirmation("");
    setError("");
  }

  // The draft's balance: every line parsed to exact cents, then
  // compared with the control estimate. The save button stays
  // disabled until the set is exact, with the precise gap shown.
  function draftBalance() {
    let total = 0;
    let allValid = draftLines.length > 0;
    for (const line of draftLines) {
      if (!line.description.trim()) allValid = false;
      const parsed = parseBudgetLineAmountToCents(line.amount);
      if (!parsed.ok) {
        allValid = false;
      } else {
        total += parsed.cents;
      }
    }
    return { total, allValid };
  }
  const { total: draftTotal, allValid: draftValid } = draftBalance();
  const draftGap = estimateCents == null ? null : estimateCents - draftTotal;
  const canSave = editing && draftValid && draftGap === 0 && draftReason.trim() !== "" && !busy;
  let saveHint = "";
  if (editing) {
    if (draftLines.length === 0) {
      saveHint = "Add at least one line — the lines must add up to the control estimate exactly.";
    } else if (!draftValid) {
      saveHint = "Fix the descriptions and amounts above first — every line needs a description and a dollar amount over $0.00.";
    } else if (draftGap !== 0 && estimateCents != null) {
      saveHint = draftGap > 0
        ? `Lines add up to ${money(draftTotal)} — the control estimate is ${money(estimateCents)}. Add ${money(draftGap)} more.`
        : `Lines add up to ${money(draftTotal)} — the control estimate is ${money(estimateCents)}. Remove ${money(-draftGap)}.`;
    } else if (draftReason.trim() === "") {
      saveHint = "Enter a reason for this change (required).";
    }
  }

  async function onSaveDraft(event) {
    event.preventDefault();
    if (!canSave) return;
    const lines = draftLines.map((line) => ({
      id: line.id,
      category: line.category,
      description: line.description.trim(),
      amountCents: parseBudgetLineAmountToCents(line.amount).cents,
    }));
    setBusy(true); setError(""); setConfirmation("");
    try {
      const saved = await api(pageQuery, `/api/work-packages/${packageId}/budget-allocation`, {
        method: "POST",
        body: JSON.stringify({
          expectedAllocationVersion: allocation?.version ?? 0,
          expectedEstimateId: estimate.id,
          expectedEstimateVersion: estimate.version,
          lines,
          reason: draftReason.trim(),
        }),
      });
      const totals = saved.categoryTotals || {};
      const parts = BUDGET_CATEGORIES
        .filter((c) => (totals[c.value] ?? 0) > 0)
        .map((c) => `${c.label.toLowerCase()} ${money(totals[c.value])}`);
      setEditing(false);
      setDraftLines([]);
      setDraftReason("");
      await reload(
        `Budget allocation saved for ${packageName} — ${parts.join(", ") || "no lines"}.`,
      );
    } catch (e) {
      // A stale version or a moved estimate lands here with the
      // server's plain-words reason; the draft stays so the user can
      // refresh and retry instead of retyping.
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmRetire() {
    if (!retireReason.trim()) {
      setError("Enter a reason for deleting this allocation (required).");
      return;
    }
    setBusy(true); setError(""); setConfirmation("");
    try {
      await api(pageQuery, `/api/work-packages/${packageId}/budget-allocation/retire`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: allocation.version, reason: retireReason.trim() }),
      });
      setRetiring(false);
      setRetireReason("");
      await reload(`Budget allocation deleted for ${packageName} — the package has no budget allocation now.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const laborVariance = computeLaborVariance({
    laborBudgetCents: allocation
      ? (allocation.lines || []).filter((l) => l.category === "labor").reduce((sum, l) => sum + (l.amountCents || 0), 0)
      : null,
    plannedLaborForecastCents,
  });

  return (
    <section ref={sectionRef} className="mt-5 border-t border-slate-200 pt-4" aria-label="Budget allocation">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Budget allocation</h3>
        {!editing && !notApplied && estimate && (
          <button
            className={btnGhost}
            disabled={busy || isTerminal}
            title={isTerminal ? "This package is closed — the budget allocation is read-only." : undefined}
            onClick={allocation ? startEdit : startCreate}
          >
            {allocation ? "Edit budget allocation" : "Add budget allocation"}
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        The control estimate split five ways — labor, material, equipment, external services, rental.
        The lines must add up to the control estimate exactly. Change orders get no budget lines here.
      </p>
      {highlightCategory && !isLoading && !loadError && !notApplied && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2" role="status" data-testid="budget-allocation-highlight-banner">
          <span className="text-sm text-blue-900">
            {allocation
              ? highlightCategory === "all"
                ? `Showing all budget categories — ${allocation.lines.length} lines.`
                : highlightedLines.length === 0
                  ? `No budget lines in ${highlightLabel} — ${allocation.lines.length} lines in total.`
                  : `Highlighting ${highlightLabel} — ${highlightedLines.length} of ${allocation.lines.length} lines.`
              : `No budget allocation yet — nothing to highlight in ${highlightLabel}.`}
          </span>
          {onClearHighlight && (
            <button type="button" className="min-h-11 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-900 hover:bg-blue-100" onClick={onClearHighlight}>Clear highlight</button>
          )}
          {onBackToDashboard && (
            <button type="button" className="min-h-11 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-900 hover:bg-blue-100" onClick={onBackToDashboard}>Back to dashboard</button>
          )}
        </div>
      )}

      {isTerminal && (
        <p className="mt-2 text-sm text-amber-700">
          This package is closed — the budget allocation is read-only.
        </p>
      )}
      {notApplied && (
        <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Budget allocation isn&apos;t available yet — the database change for this feature hasn&apos;t been applied.
        </p>
      )}
      {loadError && <p className="mt-2 text-sm text-red-600">{loadError}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {confirmation && <p className="mt-2 text-sm text-emerald-700">{confirmation}</p>}

      {isLoading ? (
        <p className="mt-3 text-xs text-slate-500">Loading budget allocation…</p>
      ) : loadError || notApplied ? null : !estimate ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-slate-600">No control estimate set — set the control estimate first, then split it five ways here.</p>
          {onRequestEstimateEdit && (
            <button
              className={btnGhost}
              disabled={busy || isTerminal}
              title={isTerminal ? "This package is closed — the budget allocation is read-only." : undefined}
              onClick={onRequestEstimateEdit}
            >
              Set control estimate
            </button>
          )}
        </div>
      ) : editing ? (
        <form onSubmit={onSaveDraft} className="mt-3 space-y-3">
          <p className="text-sm text-slate-700">
            Control estimate: <span className="font-medium">{money(estimateCents)}</span>
            {plannedLaborForecastCents != null && (
              <span className="text-slate-500"> · Planned labor: {money(plannedLaborForecastCents)}</span>
            )}
          </p>
          <div className="space-y-2">
            {draftLines.map((line) => (
              <div key={line.key} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 sm:flex-row sm:items-end">
                <div className="sm:w-44">
                  <label className={label} htmlFor={`alloc-category-${line.key}`}>Category</label>
                  <select id={`alloc-category-${line.key}`} className={input}
                    value={line.category}
                    onChange={(e) => updateDraftLine(line.key, { category: e.target.value })}>
                    {BUDGET_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className={label} htmlFor={`alloc-description-${line.key}`}>Description</label>
                  <input id={`alloc-description-${line.key}`} className={input} placeholder="What this line covers"
                    value={line.description} maxLength={200}
                    onChange={(e) => updateDraftLine(line.key, { description: e.target.value })} />
                </div>
                <div className="sm:w-36">
                  <label className={label} htmlFor={`alloc-amount-${line.key}`}>Amount (dollars)</label>
                  <input id={`alloc-amount-${line.key}`} className={input} inputMode="decimal" placeholder="0.00"
                    value={line.amount}
                    onChange={(e) => updateDraftLine(line.key, { amount: e.target.value })} />
                </div>
                <button type="button" className={btnGhost} disabled={busy}
                  onClick={() => setDraftLines((current) => current.filter((l) => l.key !== line.key))}>
                  Delete line
                </button>
              </div>
            ))}
          </div>
          {draftLines.length === 0 && (
            <p className="text-sm text-slate-500">No lines yet — add one below.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnGhost} disabled={busy}
              onClick={() => setDraftLines((current) => [...current, blankDraftLine()])}>
              Add line
            </button>
            {draftLines.length > 0 && (
              <button type="button" className={btnGhost} disabled={busy}
                onClick={() => setDraftLines([])}>
                Delete all lines
              </button>
            )}
            {plannedLaborForecastCents != null && (
              <button type="button" className={btnGhost} disabled={busy} onClick={usePlannedLabor}>
                Use planned labor estimate ({money(plannedLaborForecastCents)})
              </button>
            )}
          </div>
          <p className="text-sm text-slate-700">
            Lines add up to <span className="font-medium">{money(draftTotal)}</span>
            {" "}of the {money(estimateCents)} control estimate.
            {laborVariance.wording && allocation && (
              <span className="text-slate-500"> Labor is currently {laborVariance.wording}.</span>
            )}
          </p>
          <input className={input} aria-label="Reason for this budget allocation change"
            placeholder="Reason for this change (required)"
            value={draftReason} maxLength={1000}
            onChange={(e) => setDraftReason(e.target.value)} required />
          {saveHint && <p className="text-sm text-amber-700">{saveHint}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={btnPrimary} disabled={!canSave}>Save budget allocation</button>
            <button type="button" className={btnGhost} disabled={busy} onClick={cancelEdit}>Cancel</button>
          </div>
          <p className="text-xs text-slate-500">
            Saving replaces the whole set at once. Nothing is saved until the lines add up exactly —
            cancel to discard the draft.
          </p>
        </form>
      ) : !allocation ? (
        <p className="mt-3 text-sm text-slate-600">
          No budget allocation yet — split the {money(estimateCents)} control estimate five ways to see the cost split on the project dashboard.
        </p>
      ) : (
        <div className="mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-1 pr-2 font-semibold">Category</th>
                <th className="py-1 pr-2 font-semibold">Description</th>
                <th className="py-1 font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {allocation.lines.map((line) => (
                <tr key={line.id} data-category={line.category} className={`border-b border-slate-100 ${highlightCategory && highlightCategory !== "all" && line.category === highlightCategory ? "bg-blue-50" : ""}`}>
                  <td className="py-1 pr-2 font-medium text-slate-900">{budgetCategoryLabel(line.category)}</td>
                  <td className="py-1 pr-2 text-slate-700">{line.description}</td>
                  <td className="py-1 text-slate-700">{money(line.amountCents)}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="py-1 pr-2 text-slate-900">Total</td>
                <td className="py-1 pr-2 text-slate-500">Control estimate {money(estimateCents)}</td>
                <td className="py-1 text-slate-900">{money(allocation.allocatedTotalCents)}</td>
              </tr>
            </tbody>
          </table>
          {plannedLaborForecastCents != null && laborVariance.wording && (
            <p className="mt-2 text-xs text-slate-500">
              Labor budgeted {money(laborVariance.laborBudgetCents)} is {laborVariance.wording}
              {" "}(planned labor {money(plannedLaborForecastCents)}).
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className={btnGhost}
              disabled={busy || isTerminal}
              title={isTerminal ? "This package is closed — the budget allocation is read-only." : undefined}
              onClick={() => { setRetiring(true); setRetireReason(""); }}
            >
              Delete this allocation
            </button>
          </div>
          {retiring && (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-slate-700">
                Delete the budget allocation for {packageName}? The project dashboard cost split
                will remain incomplete until a replacement allocation is saved.
              </p>
              <input className={input} aria-label="Reason for deleting the budget allocation"
                placeholder="Reason for deleting (required)"
                value={retireReason} onChange={(e) => setRetireReason(e.target.value)}
                maxLength={1000} required />
              <div className="flex gap-2">
                <button className={btnPrimary} disabled={busy || !retireReason.trim()} onClick={onConfirmRetire}>
                  Delete this allocation
                </button>
                <button className={btnGhost} disabled={busy}
                  onClick={() => { setRetiring(false); setRetireReason(""); }}>
                  Keep it
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
