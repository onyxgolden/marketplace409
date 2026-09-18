"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { isSavingsOrInvestmentCategory } from "@/domains/budgeting/isSavingsOrInvestmentCategory";
import { isDebtPayoffCategory } from "@/domains/budgeting/isDebtPayoffCategory";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const centsToMoney = (cents) => (typeof cents === "number" ? money.format(cents / 100) : "—");

const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function draftsFromLines(lines) {
  return Object.fromEntries(lines.map((line) => [line.categoryId, line.plannedAmountCents != null ? String(line.plannedAmountCents / 100) : ""]));
}

function parseDollarsToCents(value) {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return NaN;
  return Math.round(parsed * 100);
}

function normalizedCategoryFromLabel(label) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// This panel only ever shows/edits the household's own spending -- a business_scope selector is a
// later feature, not this one (see the budgeting API routes' own BUSINESS_SCOPE constant).
export default function BudgetPanel() {
  const [status, setStatus] = useState("loading"); // "loading" | "available" | "schema-unavailable" | "error"
  const [errorMessage, setErrorMessage] = useState("");
  const [lines, setLines] = useState([]);
  const [totalIncomeCents, setTotalIncomeCents] = useState(0);
  const [suggestions, setSuggestions] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [savingCategoryId, setSavingCategoryId] = useState(null);
  const [addingCategory, setAddingCategory] = useState(null);
  const [renamingCategoryId, setRenamingCategoryId] = useState(null);
  const [removingCategoryId, setRemovingCategoryId] = useState(null);
  const [manualLabel, setManualLabel] = useState("");
  const requestInFlight = useRef(false);
  const month = useMemo(() => currentMonth(), []);

  const load = useCallback(() => {
    if (requestInFlight.current) return undefined;
    requestInFlight.current = true;
    setStatus("loading");
    setErrorMessage("");
    return Promise.all([
      fetch(`/api/budgeting/plan?month=${month}`).then((response) => response.json().then((payload) => ({ response, payload }))),
      fetch(`/api/budgeting/suggestions?month=${month}`).then((response) => response.json().then((payload) => ({ response, payload }))),
    ])
      .then(([planResult, suggestionsResult]) => {
        for (const { response, payload } of [planResult, suggestionsResult]) {
          if (response.status === 503 && payload.code === "budgeting_schema_unavailable") {
            setStatus("schema-unavailable");
            return null;
          }
          if (!response.ok) throw new Error(payload.error || "Unable to load your budget.");
        }
        setLines(planResult.payload.lines || []);
        setDrafts(draftsFromLines(planResult.payload.lines || []));
        setTotalIncomeCents(planResult.payload.summary?.totalIncomeCents ?? 0);
        setSuggestions(suggestionsResult.payload.categories || []);
        setStatus("available");
        return null;
      })
      .catch((loadError) => {
        setErrorMessage(loadError.message);
        setStatus("error");
      })
      .finally(() => {
        requestInFlight.current = false;
      });
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  const suggestionByCategory = useMemo(() => new Map(suggestions.map((entry) => [entry.normalizedCategory, entry])), [suggestions]);
  const plannedCategories = useMemo(() => new Set(lines.map((line) => line.normalizedCategory)), [lines]);
  const addableSuggestions = useMemo(
    () => suggestions.filter((entry) => !plannedCategories.has(entry.normalizedCategory)),
    [suggestions, plannedCategories],
  );
  // Debt payoff is checked first and takes precedence over a savings/investment match, mirroring
  // the standard "pay down debt before extra investing" guidance -- ranked ahead in the UI below,
  // not scored, since there's no balance/interest-rate data here to do a real avalanche/snowball order.
  const debtPayoffSuggestions = useMemo(() => addableSuggestions.filter((entry) => isDebtPayoffCategory(entry)), [addableSuggestions]);
  const savingsAndInvestmentSuggestions = useMemo(
    () => addableSuggestions.filter((entry) => !isDebtPayoffCategory(entry) && isSavingsOrInvestmentCategory(entry)),
    [addableSuggestions],
  );
  // Everyday-spending suggestions only -- debt/savings/investment ones already have their own
  // "where could this go" callout above, right where the unassigned balance is.
  const everydaySuggestions = useMemo(
    () => addableSuggestions.filter((entry) => !isDebtPayoffCategory(entry) && !isSavingsOrInvestmentCategory(entry)),
    [addableSuggestions],
  );

  const totalPlannedCents = useMemo(() => lines.reduce((total, line) => total + (line.plannedAmountCents ?? 0), 0), [lines]);
  const totalActualCents = useMemo(() => lines.reduce((total, line) => total + line.actualAmountCents, 0), [lines]);
  const unassignedCents = totalIncomeCents - totalPlannedCents;

  const saveLine = useCallback(
    (categoryId) => {
      const cents = parseDollarsToCents(drafts[categoryId] ?? "");
      if (cents === null || Number.isNaN(cents)) return;
      setSavingCategoryId(categoryId);
      fetch("/api/budgeting/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, month, plannedAmountCents: cents }),
      })
        .then((response) => response.json().then((payload) => ({ response, payload })))
        .then(({ response, payload }) => {
          if (!response.ok) throw new Error(payload.error || "Unable to save this amount.");
          setLines((previous) => previous.map((line) => (line.categoryId === categoryId ? { ...line, plannedAmountCents: cents } : line)));
        })
        .catch((saveError) => setErrorMessage(saveError.message))
        .finally(() => setSavingCategoryId(null));
    },
    [drafts, month],
  );

  const addCategory = useCallback(
    ({ normalizedCategory, displayLabel, sourceType }) => {
      setAddingCategory(normalizedCategory);
      fetch("/api/budgeting/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ normalizedCategory, displayLabel, sourceType }),
      })
        .then((response) => response.json().then((payload) => ({ response, payload })))
        .then(({ response, payload }) => {
          if (!response.ok) throw new Error(payload.error || "Unable to add this category.");
          setManualLabel("");
          return load();
        })
        .catch((addError) => setErrorMessage(addError.message))
        .finally(() => setAddingCategory(null));
    },
    [load],
  );

  const renameCategory = useCallback(
    (categoryId, displayLabel) => {
      setRenamingCategoryId(categoryId);
      return fetch(`/api/budgeting/categories/${categoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayLabel }),
      })
        .then((response) => response.json().then((payload) => ({ response, payload })))
        .then(({ response, payload }) => {
          if (!response.ok) throw new Error(payload.error || "Unable to rename this category.");
          setLines((previous) => previous.map((line) => (line.categoryId === categoryId ? { ...line, displayLabel } : line)));
        })
        .catch((renameError) => setErrorMessage(renameError.message))
        .finally(() => setRenamingCategoryId(null));
    },
    [],
  );

  const removeCategory = useCallback(
    (categoryId) => {
      setRemovingCategoryId(categoryId);
      return fetch(`/api/budgeting/categories/${categoryId}`, { method: "DELETE" })
        .then((response) => response.json().then((payload) => ({ response, payload })))
        .then(({ response, payload }) => {
          if (!response.ok) throw new Error(payload.error || "Unable to remove this category.");
          setLines((previous) => previous.filter((line) => line.categoryId !== categoryId));
        })
        .catch((removeError) => setErrorMessage(removeError.message))
        .finally(() => setRemovingCategoryId(null));
    },
    [],
  );

  return (
    <section
      data-guided-workflow-panel
      aria-label="Budget"
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900"
    >
      <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Money</p>
      <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Budget — {monthLabel(month)}</h2>
      <p className="mt-2 max-w-xl text-sm text-slate-600 dark:text-slate-400">
        Set your own planned amount for each category. Suggestions are based on your last 3 months of spending — you
        always choose the final number.
      </p>

      {status === "loading" ? (
        <p role="status" className="mt-6 text-sm text-slate-500 dark:text-slate-400">
          Loading your budget…
        </p>
      ) : null}

      {status === "schema-unavailable" ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/60 dark:bg-amber-950/30" role="alert">
          <p className="text-sm font-bold text-amber-900 dark:text-amber-200">Budget has not been activated for this environment yet.</p>
          <button
            type="button"
            onClick={load}
            className={`mt-4 rounded-xl border border-amber-400 px-4 py-2 text-sm font-bold text-amber-900 transition hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40 ${FOCUS_RING}`}
          >
            Retry
          </button>
        </div>
      ) : null}

      {status === "error" ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 dark:border-red-900/60 dark:bg-red-950/30">
          <p role="alert" className="text-sm font-bold text-red-800 dark:text-red-300">
            {errorMessage || "Something went wrong loading your budget."}
          </p>
          <button
            type="button"
            onClick={load}
            className={`mt-4 rounded-xl border border-red-400 px-4 py-2 text-sm font-bold text-red-800 transition hover:bg-red-100 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/40 ${FOCUS_RING}`}
          >
            Retry
          </button>
        </div>
      ) : null}

      {status === "available" ? (
        <>
          <BudgetSummaryBar
            totalIncomeCents={totalIncomeCents}
            totalPlannedCents={totalPlannedCents}
            totalActualCents={totalActualCents}
            unassignedCents={unassignedCents}
          />

          {unassignedCents > 0 && (debtPayoffSuggestions.length > 0 || savingsAndInvestmentSuggestions.length > 0) ? (
            <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/60 dark:bg-emerald-950/30">
              <p className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                You have {centsToMoney(unassignedCents)} not yet assigned this month. Debt payoff is listed first —
                paying down what you owe is generally worth more than extra investing.
              </p>
              {debtPayoffSuggestions.length > 0 ? (
                <WhereToPutMoneyGroup
                  heading="Debt payoff"
                  entries={debtPayoffSuggestions}
                  addingCategory={addingCategory}
                  onAdd={addCategory}
                />
              ) : null}
              {savingsAndInvestmentSuggestions.length > 0 ? (
                <WhereToPutMoneyGroup
                  heading="Savings & investments"
                  entries={savingsAndInvestmentSuggestions}
                  addingCategory={addingCategory}
                  onAdd={addCategory}
                />
              ) : null}
            </div>
          ) : null}

          {lines.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">No budget categories yet.</p>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                Add one from your spending history below, or add a category by hand.
              </p>
            </div>
          ) : (
            <ul className="mt-6 space-y-3">
              {lines.map((line) => (
                <BudgetLineRow
                  key={line.categoryId}
                  line={line}
                  draft={drafts[line.categoryId] ?? ""}
                  onDraftChange={(value) => setDrafts((previous) => ({ ...previous, [line.categoryId]: value }))}
                  suggestion={suggestionByCategory.get(line.normalizedCategory) || null}
                  onSave={() => saveLine(line.categoryId)}
                  saving={savingCategoryId === line.categoryId}
                  onRename={(displayLabel) => renameCategory(line.categoryId, displayLabel)}
                  renaming={renamingCategoryId === line.categoryId}
                  onRemove={() => removeCategory(line.categoryId)}
                  removing={removingCategoryId === line.categoryId}
                />
              ))}
            </ul>
          )}

          {everydaySuggestions.length > 0 ? (
            <div className="mt-8">
              <h3 className="text-sm font-black uppercase tracking-wide text-slate-700 dark:text-slate-300">
                Add from your spending history
              </h3>
              <ul className="mt-3 space-y-2">
                {everydaySuggestions.map((entry) => (
                  <li
                    key={entry.normalizedCategory}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-700"
                  >
                    <div>
                      <p className="font-bold text-slate-900 dark:text-white">{entry.displayLabel}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Recent average: {centsToMoney(entry.suggestedAmountCents)} / month
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={addingCategory === entry.normalizedCategory}
                      onClick={() =>
                        addCategory({
                          normalizedCategory: entry.normalizedCategory,
                          displayLabel: entry.displayLabel,
                          sourceType: "history_suggested",
                        })
                      }
                      className={`rounded-lg px-3 py-1.5 text-sm font-bold transition disabled:opacity-50 ${goldControlClassName} ${FOCUS_RING}`}
                    >
                      {addingCategory === entry.normalizedCategory ? "Adding…" : "Add"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-8">
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-700 dark:text-slate-300">Add a category by hand</h3>
            <form
              className="mt-3 flex flex-wrap gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                const trimmed = manualLabel.trim();
                if (!trimmed) return;
                addCategory({ normalizedCategory: normalizedCategoryFromLabel(trimmed), displayLabel: trimmed, sourceType: "manual" });
              }}
            >
              <input
                type="text"
                value={manualLabel}
                onChange={(event) => setManualLabel(event.target.value)}
                placeholder="e.g. Kids activities"
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-white"
              />
              <button
                type="submit"
                disabled={addingCategory !== null || manualLabel.trim() === ""}
                className={`rounded-xl border border-sky-300 px-4 py-2 text-sm font-bold text-sky-800 transition hover:bg-sky-50 disabled:opacity-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-950/40 ${FOCUS_RING}`}
              >
                Add category
              </button>
            </form>
          </div>
        </>
      ) : null}
    </section>
  );
}

function BudgetSummaryBar({ totalIncomeCents, totalPlannedCents, totalActualCents, unassignedCents }) {
  const unassignedTone =
    unassignedCents > 0
      ? "text-emerald-700 dark:text-emerald-400"
      : unassignedCents < 0
        ? "text-red-700 dark:text-red-400"
        : "text-slate-900 dark:text-white";
  const unassignedCaption = unassignedCents > 0 ? "Not yet assigned" : unassignedCents < 0 ? "Over-assigned" : "Every dollar assigned";

  return (
    <dl className="mt-6 grid grid-cols-2 gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:grid-cols-4 dark:border-slate-700 dark:bg-slate-950/40">
      <div>
        <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Income this month</dt>
        <dd className="mt-1 text-xl font-black text-slate-950 dark:text-white">{centsToMoney(totalIncomeCents)}</dd>
      </div>
      <div>
        <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Planned</dt>
        <dd className="mt-1 text-xl font-black text-slate-950 dark:text-white">{centsToMoney(totalPlannedCents)}</dd>
      </div>
      <div>
        <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Spent so far</dt>
        <dd className="mt-1 text-xl font-black text-slate-950 dark:text-white">{centsToMoney(totalActualCents)}</dd>
      </div>
      <div>
        <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{unassignedCaption}</dt>
        <dd className={`mt-1 text-xl font-black ${unassignedTone}`}>{centsToMoney(unassignedCents)}</dd>
      </div>
    </dl>
  );
}

function WhereToPutMoneyGroup({ heading, entries, addingCategory, onAdd }) {
  return (
    <div className="mt-4">
      <h4 className="text-xs font-black uppercase tracking-wide text-emerald-800 dark:text-emerald-300">{heading}</h4>
      <ul className="mt-2 space-y-2">
        {entries.map((entry) => (
          <li
            key={entry.normalizedCategory}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-white px-4 py-3 dark:border-emerald-800 dark:bg-slate-950"
          >
            <div>
              <p className="font-bold text-slate-900 dark:text-white">{entry.displayLabel}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Recent average: {centsToMoney(entry.suggestedAmountCents)} / month</p>
            </div>
            <button
              type="button"
              disabled={addingCategory === entry.normalizedCategory}
              onClick={() => onAdd({ normalizedCategory: entry.normalizedCategory, displayLabel: entry.displayLabel, sourceType: "history_suggested" })}
              className={`rounded-lg px-3 py-1.5 text-sm font-bold transition disabled:opacity-50 ${goldControlClassName} ${FOCUS_RING}`}
            >
              {addingCategory === entry.normalizedCategory ? "Adding…" : "Add"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BudgetLineRow({ line, draft, onDraftChange, suggestion, onSave, saving, onRename, renaming, onRemove, removing }) {
  const draftCents = parseDollarsToCents(draft);
  const dirty = draftCents !== null && !Number.isNaN(draftCents) && draftCents !== line.plannedAmountCents;
  const showSuggestion = suggestion && suggestion.suggestedAmountCents !== line.plannedAmountCents;

  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(line.displayLabel);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const submitRename = () => {
    const trimmed = labelDraft.trim();
    if (!trimmed || trimmed === line.displayLabel) {
      setIsEditingLabel(false);
      setLabelDraft(line.displayLabel);
      return;
    }
    Promise.resolve(onRename(trimmed)).then(() => setIsEditingLabel(false));
  };

  return (
    <li className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {isEditingLabel ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                submitRename();
              }}
            >
              <label className="sr-only" htmlFor={`budget-line-label-${line.categoryId}`}>
                Rename {line.displayLabel}
              </label>
              <input
                id={`budget-line-label-${line.categoryId}`}
                type="text"
                value={labelDraft}
                onChange={(event) => setLabelDraft(event.target.value)}
                autoFocus
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-black text-slate-950 dark:border-slate-600 dark:bg-slate-950 dark:text-white"
              />
              <button
                type="submit"
                disabled={renaming}
                className={`rounded-lg px-2 py-1 text-xs font-bold transition disabled:opacity-50 ${goldControlClassName} ${FOCUS_RING}`}
              >
                {renaming ? "Saving…" : "Save name"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsEditingLabel(false);
                  setLabelDraft(line.displayLabel);
                }}
                className={`rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 ${FOCUS_RING}`}
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-black text-slate-950 dark:text-white">{line.displayLabel}</p>
              <button
                type="button"
                onClick={() => setIsEditingLabel(true)}
                className={`rounded px-1.5 py-0.5 text-xs font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 ${FOCUS_RING}`}
              >
                Rename
              </button>
            </div>
          )}
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Spent so far this month: {centsToMoney(line.actualAmountCents)}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`budget-line-${line.categoryId}`}>
            Planned amount for {line.displayLabel}
          </label>
          <span className="text-sm font-bold text-slate-500 dark:text-slate-400">$</span>
          <input
            id={`budget-line-${line.categoryId}`}
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            className="w-28 rounded-xl border border-slate-300 bg-white px-3 py-2 text-right text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-white"
          />
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || saving}
            className={`rounded-lg px-3 py-2 text-sm font-bold transition disabled:opacity-40 ${goldControlClassName} ${FOCUS_RING}`}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {showSuggestion ? (
          <button
            type="button"
            onClick={() => onDraftChange(String(suggestion.suggestedAmountCents / 100))}
            className={`rounded-lg border border-sky-300 px-3 py-1 text-xs font-bold text-sky-800 transition hover:bg-sky-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-950/40 ${FOCUS_RING}`}
          >
            Suggested: {centsToMoney(suggestion.suggestedAmountCents)} — use this
          </button>
        ) : null}
        {confirmingRemove ? (
          <span className="flex items-center gap-2 text-xs">
            <span className="font-bold text-red-700 dark:text-red-400">Remove {line.displayLabel} from your budget?</span>
            <button
              type="button"
              onClick={onRemove}
              disabled={removing}
              className={`rounded-lg border border-red-400 px-2 py-1 font-bold text-red-800 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950/40 ${FOCUS_RING}`}
            >
              {removing ? "Removing…" : "Confirm remove"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              className={`rounded-lg border border-slate-300 px-2 py-1 font-bold text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 ${FOCUS_RING}`}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingRemove(true)}
            className={`rounded-lg px-2 py-1 text-xs font-bold text-slate-500 transition hover:bg-red-50 hover:text-red-700 dark:text-slate-400 dark:hover:bg-red-950/30 dark:hover:text-red-300 ${FOCUS_RING}`}
          >
            Remove from budget
          </button>
        )}
      </div>
    </li>
  );
}
