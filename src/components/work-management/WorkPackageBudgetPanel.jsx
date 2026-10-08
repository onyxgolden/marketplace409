"use client";

import { useCallback, useEffect, useState } from "react";
import {
  formatCents,
  parsePlannedBudgetToCents,
} from "@/domains/work-management/packageCosts.js";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const label = "block text-xs font-medium text-slate-600 mb-1";
const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const btnPrimary = `${btn} bg-slate-900 text-white hover:bg-slate-700`;
const btnGhost = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;

function dollarsInputValue(cents) {
  return cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);
}

function money(cents) {
  return formatCents(cents) || "$0.00";
}

export default function WorkPackageBudgetPanel({
  packageId,
  isTerminal = false,
  refreshKey = 0,
  onBudgetSaved = null,
}) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [budgetInput, setBudgetInput] = useState("");
  const [budgetReason, setBudgetReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const fetchSummary = useCallback(async () => {
    const response = await fetch(`/api/work-packages/${encodeURIComponent(packageId)}/cost-summary`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load budget and spending.");
    return data.summary;
  }, [packageId]);

  const applySummary = useCallback((nextSummary) => {
    setSummary(nextSummary);
    setBudgetInput(dollarsInputValue(nextSummary.plannedCostCents));
  }, []);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      applySummary(await fetchSummary());
    } catch (caught) {
      setError(caught.message);
    } finally {
      setLoading(false);
    }
  }, [applySummary, fetchSummary]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const nextSummary = await fetchSummary();
        if (!cancelled) {
          applySummary(nextSummary);
          setError("");
          setLoading(false);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught.message);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [applySummary, fetchSummary, refreshKey]);

  async function onSaveBudget(event) {
    event.preventDefault();
    if (!summary) return;
    const parsed = parsePlannedBudgetToCents(budgetInput);
    if (!parsed.ok) {
      setSaveError(parsed.error);
      return;
    }
    if (parsed.cents === summary.plannedCostCents) {
      setSaveError("Enter a different planned budget, or leave the current budget unchanged.");
      return;
    }
    if (!confirmed) {
      setSaveError("Confirm the budget change before saving.");
      return;
    }
    if (!budgetReason.trim()) {
      setSaveError("A reason is required for a budget change.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch(`/api/work-packages/${encodeURIComponent(packageId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planned_budget: budgetInput.trim() === "" ? null : budgetInput.trim(),
          budget_reason: budgetReason.trim(),
          expected_version: summary.packageVersion,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save the planned budget.");
      setBudgetReason("");
      setConfirmed(false);
      if (onBudgetSaved) await onBudgetSaved();
      await loadSummary();
    } catch (caught) {
      setSaveError(caught.message);
    } finally {
      setSaving(false);
    }
  }

  const variance = summary?.varianceCents;
  const totalsUnavailable = Boolean(summary?.totalsError);
  const varianceText = !summary
    ? "No budget set"
    : totalsUnavailable
      ? "Unavailable"
      : !summary.hasPlan
        ? "No budget set"
        : variance > 0
          ? `Over budget by ${money(variance)}`
          : variance < 0
            ? `Under budget by ${money(Math.abs(variance))}`
            : "On budget";

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5" aria-label="Budget and spending">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Budget and spending</h2>
        <a href="#work-package-links" className="text-sm font-medium text-blue-700 hover:underline">
          Review linked records
        </a>
      </div>

      {loading && <p className="mt-3 text-sm text-slate-500">Loading budget and spending…</p>}
      {!loading && error && (
        <div className="mt-3">
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            Budget and spending could not be loaded ({error})
          </p>
          <button type="button" className={`${btnGhost} mt-2`} onClick={loadSummary}>Retry</button>
        </div>
      )}

      {!loading && !error && summary && (
        <>
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-slate-500">Planned budget</dt>
              <dd className="mt-0.5 text-sm font-medium text-slate-900">
                {summary.hasPlan ? money(summary.plannedCostCents) : "No budget set"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Recorded spending</dt>
              <dd className="mt-0.5 text-sm font-medium text-slate-900">
                {totalsUnavailable ? "Unavailable" : `${money(summary.actualCostCents)} recorded`}
              </dd>
              <dd className="mt-0.5 text-xs text-slate-500">
                {summary.includedEventCount === 0
                  ? "No eligible linked financial events yet."
                  : `${summary.includedEventCount} linked financial ${summary.includedEventCount === 1 ? "event" : "events"} included.`}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Budget status</dt>
              <dd className="mt-0.5 text-sm font-medium text-slate-900">{varianceText}</dd>
            </div>
          </dl>

          {summary.scope === "unassigned" && (
            <p className="mt-3 text-xs text-slate-500">
              This package has no assigned property. Only linked events without a property association are included.
            </p>
          )}
          {(summary.excludedEventCount > 0 || summary.ambiguousEventCount > 0) && (
            <p className="mt-3 text-sm text-amber-800">
              {summary.excludedEventCount} linked {summary.excludedEventCount === 1 ? "event was" : "events were"} excluded
              {summary.ambiguousEventCount > 0
                ? `; ${summary.ambiguousEventCount} ambiguous ${summary.ambiguousEventCount === 1 ? "event was" : "events were"} excluded from all package totals.`
                : "."}
            </p>
          )}
          {summary.warnings?.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-800">
              {summary.warnings.map((warning) => (
                <li key={`${warning.code}-${warning.eventId || "package"}`}>{warning.message}</li>
              ))}
            </ul>
          )}

          {!isTerminal ? (
            <form onSubmit={onSaveBudget} className="mt-5 border-t border-slate-100 pt-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor="planned_budget">Planned budget (dollars)</label>
                  <input
                    id="planned_budget"
                    className={input}
                    inputMode="decimal"
                    placeholder="1250.00"
                    value={budgetInput}
                    onChange={(event) => setBudgetInput(event.target.value)}
                  />
                  <p className="mt-1 text-xs text-slate-500">Leave blank to clear the budget. Enter 0.00 for an explicit zero budget.</p>
                </div>
                <div>
                  <label className={label} htmlFor="budget_reason">Reason for change</label>
                  <input
                    id="budget_reason"
                    className={input}
                    value={budgetReason}
                    onChange={(event) => setBudgetReason(event.target.value)}
                    required
                  />
                </div>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I confirm this budget change
              </label>
              {saveError && <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">{saveError}</p>}
              <button type="submit" className={`${btnPrimary} mt-3`} disabled={saving}>
                {saving ? "Saving…" : "Save budget"}
              </button>
            </form>
          ) : (
            <p className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-500">
              This package is closed, so its planned budget cannot be edited.
            </p>
          )}

          {summary.budgetRevisions?.length > 0 && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <h3 className="text-xs font-semibold text-slate-900">Budget history</h3>
              <ul className="mt-2 space-y-1 text-xs text-slate-500">
                {summary.budgetRevisions.map((revision) => (
                  <li key={revision.id}>
                    {new Date(revision.at).toLocaleString()} — {revision.actor} — {" "}
                    {revision.old_planned_cost_cents === null ? "No budget set" : money(revision.old_planned_cost_cents)}
                    {" → "}
                    {revision.new_planned_cost_cents === null ? "No budget set" : money(revision.new_planned_cost_cents)}
                    {revision.reason ? ` — ${revision.reason}` : ""}
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
