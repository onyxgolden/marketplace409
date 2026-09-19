"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { isSavingsOrInvestmentCategory } from "@/domains/budgeting/isSavingsOrInvestmentCategory";
import { isDebtPayoffCategory } from "@/domains/budgeting/isDebtPayoffCategory";
import { resolveCategoryDisplayLabel } from "@/domains/budgeting/categoryDisplayLabel";
import { lineVarianceCents, varianceLabel } from "@/domains/budgeting/budgetVariance";
import { categoryFamilyOf } from "@/domains/budgeting/categoryFamily";
import { monthlyEquivalentAmount } from "@/domains/financial-event/detectRecurringPayments";
import BudgetPieChart from "@/components/forge/budget/BudgetPieChart";
import ScreenHeadlineNumber from "@/components/forge/ScreenHeadlineNumber";
import { describeLeftToSpend } from "@/components/forge/budget/budgetHeadline";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const centsToMoney = (cents) => (typeof cents === "number" ? money.format(cents / 100) : "—");

// Short labels for a family suggestion's member categories: "dining_drinks_restaurants" under the
// "dining_drinks" family renders as just "Restaurants".
function memberShortLabels(entry) {
  const prefix = `${entry.normalizedCategory}_`;
  return (entry.memberCategories ?? []).map((member) => {
    const remainder = member.startsWith(prefix) ? member.slice(prefix.length) : member;
    return remainder
      .split("_")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  });
}

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

// Personal and business are two fully separate budgets, not one combined view -- rental income
// isn't grocery money, and a repair bill shouldn't compete with personal categories for
// "unassigned" dollars. Switching scope reloads everything from scratch for that scope.
export default function BudgetPanel() {
  const [scope, setScope] = useState("personal"); // "personal" | "business"
  const [status, setStatus] = useState("loading"); // "loading" | "available" | "schema-unavailable" | "error"
  const [errorMessage, setErrorMessage] = useState("");
  const [lines, setLines] = useState([]);
  const [totalIncomeCents, setTotalIncomeCents] = useState(0);
  const [incomeByCategory, setIncomeByCategory] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [recurringPatterns, setRecurringPatterns] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [savingCategoryId, setSavingCategoryId] = useState(null);
  const [addingCategory, setAddingCategory] = useState(null);
  const [renamingCategoryId, setRenamingCategoryId] = useState(null);
  const [removingCategoryId, setRemovingCategoryId] = useState(null);
  const [savingNoteCategoryId, setSavingNoteCategoryId] = useState(null);
  const [manualLabel, setManualLabel] = useState("");
  const requestInFlight = useRef(false);
  const month = useMemo(() => currentMonth(), []);

  const load = useCallback(() => {
    if (requestInFlight.current) return undefined;
    requestInFlight.current = true;
    setStatus("loading");
    setErrorMessage("");
    return Promise.all([
      fetch(`/api/budgeting/plan?month=${month}&scope=${scope}`).then((response) => response.json().then((payload) => ({ response, payload }))),
      fetch(`/api/budgeting/suggestions?month=${month}&scope=${scope}`).then((response) => response.json().then((payload) => ({ response, payload }))),
      // Recurring detection is advisory -- if it's down, the budget still loads.
      fetch("/api/financial/recurring")
        .then((response) => response.json().then((payload) => ({ response, payload })))
        .then(({ response, payload }) => (response.ok ? payload.patterns ?? [] : []))
        .catch(() => []),
    ])
      .then(([planResult, suggestionsResult, recurringResult]) => {
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
        setIncomeByCategory(planResult.payload.incomeByCategory || []);
        setSuggestions(suggestionsResult.payload.categories || []);
        setRecurringPatterns(recurringResult || []);
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
  }, [month, scope]);

  useEffect(() => {
    load();
  }, [load]);

  // Families, not exact categories: a planned "dining_drinks_restaurants" line already covers the
  // "dining_drinks" family, so the family suggestion must not reappear as addable.
  const plannedFamilies = useMemo(
    () => new Set(lines.map((line) => categoryFamilyOf(line.normalizedCategory) ?? line.normalizedCategory)),
    [lines],
  );
  // Recurring-payment suggestions: detected patterns the history engine didn't already surface
  // and the user hasn't planned yet. Outbound only (budget lines are spending), matched to the
  // current scope, and only patterns with a real decided category -- "other"/uncategorized
  // patterns stay on the connections panel until someone classifies them.
  const recurringSuggestions = useMemo(() => {
    const historyFamilies = new Set(suggestions.map((entry) => categoryFamilyOf(entry.normalizedCategory) ?? entry.normalizedCategory));
    return recurringPatterns
      .filter((pattern) => pattern.direction === "outbound")
      .filter((pattern) => (pattern.businessScope ?? "personal") === scope)
      .filter((pattern) => pattern.category && pattern.category !== "other")
      .filter((pattern) => {
        const family = categoryFamilyOf(pattern.category) ?? pattern.category;
        return !plannedFamilies.has(family) && !historyFamilies.has(family);
      })
      .map((pattern) => ({
        normalizedCategory: pattern.category,
        displayLabel: resolveCategoryDisplayLabel(pattern.category),
        suggestedAmountCents: Math.round(monthlyEquivalentAmount(pattern) * 100),
        pattern,
      }));
  }, [recurringPatterns, suggestions, plannedFamilies, scope]);
  const suggestionByCategory = useMemo(() => {
    const map = new Map(suggestions.map((entry) => [entry.normalizedCategory, entry]));
    // Recurring patterns fill gaps the history engine missed -- history suggestions win ties.
    for (const entry of recurringSuggestions) {
      if (!map.has(entry.normalizedCategory)) map.set(entry.normalizedCategory, entry);
    }
    return map;
  }, [suggestions, recurringSuggestions]);
  const addableSuggestions = useMemo(
    () => suggestions.filter((entry) => !plannedFamilies.has(categoryFamilyOf(entry.normalizedCategory) ?? entry.normalizedCategory)),
    [suggestions, plannedFamilies],
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

  // The screen's one number: "How much is left to spend this month?" Derived
  // from the already-fetched plan totals; follows the personal/business scope
  // tabs. Dashes until the plan loads -- never a fabricated $0.
  const leftToSpendHeadline = useMemo(
    () =>
      describeLeftToSpend({
        leftToSpendCents:
          status === "available"
            ? lineVarianceCents({ plannedAmountCents: totalPlannedCents, actualAmountCents: totalActualCents })
            : null,
        totalPlannedCents: status === "available" ? totalPlannedCents : null,
      }),
    [status, totalPlannedCents, totalActualCents],
  );

  const incomeChartEntries = useMemo(
    () => incomeByCategory.map((entry) => ({ label: entry.displayLabel, valueCents: entry.amountCents })),
    [incomeByCategory],
  );
  const plannedChartEntries = useMemo(
    () =>
      lines
        .filter((line) => (line.plannedAmountCents ?? 0) > 0)
        .map((line) => ({ label: line.displayLabel, valueCents: line.plannedAmountCents })),
    [lines],
  );

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
        body: JSON.stringify({ normalizedCategory, displayLabel, sourceType, businessScope: scope }),
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
    [load, scope],
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

  const saveNote = useCallback(
    (categoryId, note) => {
      setSavingNoteCategoryId(categoryId);
      return fetch(`/api/budgeting/categories/${categoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      })
        .then((response) => response.json().then((payload) => ({ response, payload })))
        .then(({ response, payload }) => {
          if (!response.ok) throw new Error(payload.error || "Unable to save this note.");
          const savedNote = payload.category?.note ?? null;
          setLines((previous) => previous.map((line) => (line.categoryId === categoryId ? { ...line, note: savedNote } : line)));
        })
        .catch((noteError) => setErrorMessage(noteError.message))
        .finally(() => setSavingNoteCategoryId(null));
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Money</p>
          <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Budget — {monthLabel(month)}</h2>
        </div>
        <div className="flex flex-col items-end gap-4">
          <ScreenHeadlineNumber
            value={leftToSpendHeadline.value}
            label="Left to spend"
            caption={leftToSpendHeadline.caption}
            tone={leftToSpendHeadline.tone}
            testId="budget-headline-number"
          />
          <div role="tablist" aria-label="Budget scope" className="flex rounded-xl border border-slate-300 p-1 dark:border-slate-600">
          {[
            { value: "personal", label: "Personal" },
            { value: "business", label: "Business" },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={scope === option.value}
              onClick={() => setScope(option.value)}
              className={`rounded-lg px-4 py-1.5 text-sm font-bold transition ${FOCUS_RING} ${
                scope === option.value
                  ? `${goldControlClassName}`
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {option.label}
            </button>
          ))}
          </div>
        </div>
      </div>
      <p className="mt-2 max-w-xl text-sm text-slate-600 dark:text-slate-400">
        {scope === "personal"
          ? "Set your own planned amount for each category. Suggestions are based on your last 3 months of spending — you always choose the final number."
          : "Your rental/business income and expenses, kept separate from personal spending. Same suggestion and planning tools, scoped to the business."}
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

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <BudgetPieChart title="Income by source" entries={incomeChartEntries} emptyHint="No categorized income recorded yet this month." />
            <BudgetPieChart title="Planned by category" entries={plannedChartEntries} emptyHint="Set a planned amount on a category to see it here." />
          </div>

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
            <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-700 dark:bg-slate-950/40">
                    <th scope="col" className="px-4 py-2.5 font-bold text-slate-600 dark:text-slate-300">
                      Category
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-bold text-slate-600 dark:text-slate-300">
                      Note
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-bold text-slate-600 dark:text-slate-300">
                      Suggested
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-bold text-slate-600 dark:text-slate-300">
                      Planned
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-bold text-slate-600 dark:text-slate-300">
                      Actual
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-bold text-slate-600 dark:text-slate-300">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {lines.map((line) => (
                    <BudgetLineRow
                      key={line.categoryId}
                      line={line}
                      draft={drafts[line.categoryId] ?? ""}
                      onDraftChange={(value) => setDrafts((previous) => ({ ...previous, [line.categoryId]: value }))}
                      suggestion={suggestionByCategory.get(categoryFamilyOf(line.normalizedCategory) ?? line.normalizedCategory) || null}
                      onSave={() => saveLine(line.categoryId)}
                      saving={savingCategoryId === line.categoryId}
                      onRename={(displayLabel) => renameCategory(line.categoryId, displayLabel)}
                      renaming={renamingCategoryId === line.categoryId}
                      onSaveNote={(note) => saveNote(line.categoryId, note)}
                      savingNote={savingNoteCategoryId === line.categoryId}
                      onRemove={() => removeCategory(line.categoryId)}
                      removing={removingCategoryId === line.categoryId}
                    />
                  ))}
                </tbody>
              </table>
            </div>
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
                      {entry.memberCategories?.length > 0 ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Includes: {memberShortLabels(entry).join(", ")}
                        </p>
                      ) : null}
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

          {recurringSuggestions.length > 0 ? (
            <div className="mt-8">
              <h3 className="text-sm font-black uppercase tracking-wide text-slate-700 dark:text-slate-300">
                Add from recurring payments
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Detected from your bank feed — same account, steady rhythm. Amounts are scaled to a monthly budget.
              </p>
              <ul className="mt-3 space-y-2">
                {recurringSuggestions.map((entry) => (
                  <RecurringSuggestionRow
                    key={`${entry.normalizedCategory}-${entry.pattern.accountId ?? "unknown"}`}
                    entry={entry}
                    adding={addingCategory === entry.normalizedCategory}
                    onAdd={(displayLabel) =>
                      addCategory({
                        normalizedCategory: entry.normalizedCategory,
                        displayLabel,
                        sourceType: "history_suggested",
                      })
                    }
                  />
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
  const leftToSpendCents = lineVarianceCents({ plannedAmountCents: totalPlannedCents, actualAmountCents: totalActualCents });
  const leftToSpendTone =
    leftToSpendCents > 0
      ? "text-emerald-700 dark:text-emerald-400"
      : leftToSpendCents < 0
        ? "text-red-700 dark:text-red-400"
        : "text-slate-900 dark:text-white";

  return (
    <dl className="mt-6 grid grid-cols-2 gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:grid-cols-3 lg:grid-cols-5 dark:border-slate-700 dark:bg-slate-950/40">
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
        <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Left to spend</dt>
        <dd className={`mt-1 text-xl font-black ${leftToSpendTone}`}>
          {centsToMoney(Math.abs(leftToSpendCents))}
          <span className="ml-1 text-sm font-bold">{varianceLabel(leftToSpendCents)}</span>
        </dd>
      </div>
      <div>
        <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{unassignedCaption}</dt>
        <dd className={`mt-1 text-xl font-black ${unassignedTone}`}>{centsToMoney(unassignedCents)}</dd>
      </div>
    </dl>
  );
}

function RecurringSuggestionRow({ entry, adding, onAdd }) {  const [label, setLabel] = useState(entry.displayLabel);
  const { pattern } = entry;
  const trimmed = label.trim();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-700">
      <div className="min-w-0 flex-1 basis-64">
        <label className="sr-only" htmlFor={`recurring-label-${entry.normalizedCategory}`}>
          Budget label for this recurring payment
        </label>
        <input
          id={`recurring-label-${entry.normalizedCategory}`}
          type="text"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-white"
        />
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {centsToMoney(entry.suggestedAmountCents)} / month · {pattern.cadence} · {pattern.occurrences} payments
          {pattern.nextExpectedDate ? ` · next ~${pattern.nextExpectedDate}` : ""}
        </p>
      </div>
      <button
        type="button"
        disabled={adding || trimmed === ""}
        onClick={() => onAdd(trimmed)}
        className={`rounded-lg px-3 py-1.5 text-sm font-bold transition disabled:opacity-50 ${goldControlClassName} ${FOCUS_RING}`}
      >
        {adding ? "Adding…" : "Add"}
      </button>
    </li>
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

function BudgetLineRow({ line, draft, onDraftChange, suggestion, onSave, saving, onRename, renaming, onSaveNote, savingNote, onRemove, removing }) {
  const draftCents = parseDollarsToCents(draft);
  const dirty = draftCents !== null && !Number.isNaN(draftCents) && draftCents !== line.plannedAmountCents;
  const showSuggestion = suggestion && suggestion.suggestedAmountCents !== line.plannedAmountCents;

  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(line.displayLabel);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [noteDraft, setNoteDraft] = useState(line.note ?? "");

  const submitRename = () => {
    const trimmed = labelDraft.trim();
    if (!trimmed || trimmed === line.displayLabel) {
      setIsEditingLabel(false);
      setLabelDraft(line.displayLabel);
      return;
    }
    Promise.resolve(onRename(trimmed)).then(() => setIsEditingLabel(false));
  };

  const submitNoteIfChanged = () => {
    if (noteDraft === (line.note ?? "")) return;
    onSaveNote(noteDraft);
  };

  return (
    <tr className="align-top">
      <td className="px-4 py-3">
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
              className="w-32 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-bold text-slate-950 dark:border-slate-600 dark:bg-slate-950 dark:text-white"
            />
            <button
              type="submit"
              disabled={renaming}
              className={`rounded-lg px-2 py-1 text-xs font-bold transition disabled:opacity-50 ${goldControlClassName} ${FOCUS_RING}`}
            >
              {renaming ? "…" : "Save"}
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
          <button
            type="button"
            onClick={() => setIsEditingLabel(true)}
            className={`rounded px-1 -mx-1 text-left font-bold text-slate-950 transition hover:bg-slate-100 dark:text-white dark:hover:bg-slate-800 ${FOCUS_RING}`}
            title="Click to rename"
          >
            {line.displayLabel}
          </button>
        )}
      </td>
      <td className="px-4 py-3">
        <label className="sr-only" htmlFor={`budget-line-note-${line.categoryId}`}>
          Note for {line.displayLabel}
        </label>
        <input
          id={`budget-line-note-${line.categoryId}`}
          type="text"
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          onBlur={submitNoteIfChanged}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          placeholder={savingNote ? "Saving…" : "Add a note"}
          className="w-40 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-slate-700 transition hover:border-slate-300 focus:border-slate-300 focus:bg-white dark:text-slate-300 dark:hover:border-slate-600 dark:focus:border-slate-600 dark:focus:bg-slate-950"
        />
      </td>
      <td className="px-4 py-3 text-right">
        {suggestion ? (
          <div className="flex flex-col items-end">
            <span className="text-slate-600 dark:text-slate-400">{centsToMoney(suggestion.suggestedAmountCents)}</span>
            {showSuggestion ? (
              <button
                type="button"
                onClick={() => onDraftChange(String(suggestion.suggestedAmountCents / 100))}
                className={`text-xs font-bold text-sky-700 transition hover:underline dark:text-sky-400 ${FOCUS_RING}`}
              >
                use this
              </button>
            ) : null}
          </div>
        ) : (
          <span className="text-slate-400 dark:text-slate-600">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
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
            className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-right text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-white"
          />
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || saving}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition disabled:opacity-40 ${goldControlClassName} ${FOCUS_RING}`}
          >
            {saving ? "…" : "Save"}
          </button>
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="text-slate-700 dark:text-slate-300">{centsToMoney(line.actualAmountCents)}</div>
        {(() => {
          const variance = lineVarianceCents({ plannedAmountCents: line.plannedAmountCents, actualAmountCents: line.actualAmountCents });
          if (variance == null) return null;
          return (
            <div
              className={`text-xs font-bold ${
                variance > 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : variance < 0
                    ? "text-red-700 dark:text-red-400"
                    : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {variance === 0 ? "on plan" : `${centsToMoney(Math.abs(variance))} ${varianceLabel(variance)}`}
            </div>
          );
        })()}
      </td>
      <td className="px-4 py-3 text-right">
        {confirmingRemove ? (
          <span className="flex items-center justify-end gap-1.5 whitespace-nowrap text-xs">
            <button
              type="button"
              onClick={onRemove}
              disabled={removing}
              className={`rounded-lg border border-red-400 px-2 py-1 font-bold text-red-800 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950/40 ${FOCUS_RING}`}
            >
              {removing ? "…" : "Confirm"}
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
            className={`rounded px-1.5 py-1 text-xs font-bold text-slate-400 transition hover:bg-red-50 hover:text-red-700 dark:text-slate-500 dark:hover:bg-red-950/30 dark:hover:text-red-300 ${FOCUS_RING}`}
            title={`Remove ${line.displayLabel} from your budget`}
          >
            Remove
          </button>
        )}
      </td>
    </tr>
  );
}
