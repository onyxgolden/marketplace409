"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { forgeTheme } from "@/components/forge/theme";
import {
  ForgeEmptyState,
  ForgeErrorState,
  ForgeLoadingState,
} from "@/components/forge/ForgeStates.jsx";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { money } from "./formatMoney.js";
import {
  DEBT_QUESTION_CHIPS,
  answerDebtQuestion,
} from "@/domains/ledger/brain/debtPayoffAnswers.js";

const STRATEGY_LABELS = {
  avalanche: "Avalanche",
  snowball: "Snowball",
  minimums: "Minimums only",
};

const STRATEGY_HINTS = {
  avalanche: "Highest effective rate first — mathematically the cheapest.",
  snowball: "Smallest balance first — fastest early wins.",
  minimums: "Pay only minimums — the baseline everything is compared against.",
};

function money2(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function debtFreeLabel(months) {
  if (months == null) return "never at this pace";
  if (months <= 0) return "already clear";
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  const label = date.toLocaleString("en-US", { month: "short", year: "numeric" });
  return `in ${months} month${months === 1 ? "" : "s"} (~${label})`;
}

// Owner-confirmed terms editor. Never guesses: every field starts from the
// debt's stored terms (or blank) and the owner types the real numbers.
function DebtTermsForm({ debt, onSaved, onDone }) {
  const [apr, setApr] = useState(debt.apr ?? "");
  const [minimumPayment, setMinimumPayment] = useState(debt.minimumPayment ?? "");
  const [taxDeductible, setTaxDeductible] = useState(debt.taxDeductible === true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/financial/debt-terms", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          financialAccountId: debt.id,
          apr: Number(apr),
          minimumPayment: Number(minimumPayment),
          taxDeductible,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success !== true) {
        throw new Error(payload?.error || "Could not save the terms.");
      }
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the terms.");
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setClearing(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/financial/debt-terms?financialAccountId=${encodeURIComponent(debt.id)}`,
        { method: "DELETE" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success !== true) {
        throw new Error(payload?.error || "Could not clear the terms.");
      }
      onSaved();
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "Could not clear the terms.");
    } finally {
      setClearing(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/40">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-bold text-slate-600 dark:text-slate-400">
          APR %
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={apr}
            onChange={(e) => setApr(e.target.value)}
            className={inputClass}
            aria-label={`APR percent for ${debt.name}`}
          />
        </label>
        <label className="text-xs font-bold text-slate-600 dark:text-slate-400">
          Minimum $/mo
          <input
            type="number"
            min="0"
            step="0.01"
            value={minimumPayment}
            onChange={(e) => setMinimumPayment(e.target.value)}
            className={inputClass}
            aria-label={`Minimum monthly payment for ${debt.name}`}
          />
        </label>
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-400">
        <input
          type="checkbox"
          checked={taxDeductible}
          onChange={(e) => setTaxDeductible(e.target.checked)}
        />
        Interest is tax-deductible (e.g. mortgage)
      </label>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-bold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {saving ? "Saving…" : "Save terms"}
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={clearing}
          className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-bold text-slate-600 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300"
        >
          {clearing ? "Clearing…" : "Clear"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg px-3 py-1 text-xs font-bold text-slate-500 dark:text-slate-400"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function DebtRow({ debt, needsTerms, onTermsChanged }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{debt.name}</p>
        <p className="text-sm font-black text-slate-900 dark:text-slate-100">{money(debt.balance)}</p>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {needsTerms ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            Needs your rate{debt.missingApr && debt.missingMinimum ? "s" : ""}
          </span>
        ) : (
          <>
            <span className={forgeTheme.textSmall}>
              {Number(debt.apr).toFixed(2)}% APR
              {debt.taxDeductible && debt.effectiveApr !== debt.apr
                ? ` · ${Number(debt.effectiveApr).toFixed(2)}% after tax`
                : ""}
            </span>
            <span className={forgeTheme.textSmall}>Min {money(debt.minimumPayment)}/mo</span>
          </>
        )}
        <button
          type="button"
          onClick={() => setEditing((current) => !current)}
          aria-expanded={editing}
          className="text-xs font-bold text-sky-700 underline dark:text-sky-400"
        >
          {editing ? "Hide terms" : needsTerms ? "Enter terms" : "Edit terms"}
        </button>
      </div>
      {editing && (
        <DebtTermsForm
          debt={debt}
          onSaved={() => {
            setEditing(false);
            onTermsChanged();
          }}
          onDone={() => setEditing(false)}
        />
      )}
    </li>
  );
}

async function loadPayoffComparison(committed) {
  const response = await fetch(
    `/api/financial/debt-payoff?monthlySurplus=${encodeURIComponent(committed.surplus)}&taxRate=${encodeURIComponent(committed.taxRate)}`,
  );
  const payload = await response.json();
  if (!response.ok || payload?.success !== true) {
    throw new Error(payload?.error || "Could not build the debt-payoff comparison.");
  }
  return payload.data;
}

export default function DebtPayoffPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const [surplusInput, setSurplusInput] = useState("500");
  const [taxRateInput, setTaxRateInput] = useState("");
  const [committed, setCommitted] = useState({ surplus: 500, taxRate: 0 });
  const [strategy, setStrategy] = useState("avalanche");
  // Stale-while-revalidate, keyed by the committed inputs: committing new inputs
  // keeps the old comparison on screen while the new one computes.
  const { data, error, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    `financial:debt-payoff:${committed.surplus}:${committed.taxRate}`,
    () => loadPayoffComparison(committed),
    { ttlMs: 60_000 },
  );
  const [prefSaving, setPrefSaving] = useState(false);
  const [prefError, setPrefError] = useState(null);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [whatIfInput, setWhatIfInput] = useState("500");

  function reload() {
    refresh();
  }

  // Committing new surplus/tax inputs swaps the cache key, so keep the last
  // visible comparison on screen while the new one computes -- never blank.
  const [lastData, setLastData] = useState(null);
  if (data && data !== lastData) {
    // Adjusting state during render on a fresh payload: the standard React
    // derived-state pattern, so the previous comparison stays visible on re-commit.
    setLastData(data);
  }
  const visible = data ?? lastData;

  // Optimistic preference override: the PUT returns the new value and the old
  // code applied it to the checkbox immediately. Keep that instant feedback and
  // let the canonical server value from the next fresh fetch clear the override.
  const [suggestionsOverride, setSuggestionsOverride] = useState(null);
  const [prevFetchedData, setPrevFetchedData] = useState(data);
  if (data !== prevFetchedData) {
    // Adjusting state during render on a fresh payload: the standard React
    // derived-state pattern, so the canonical value always wins over the override.
    setPrevFetchedData(data);
    setSuggestionsOverride(null);
  }
  const suggestionsEnabled = suggestionsOverride ?? visible?.suggestionsEnabled !== false;

  function commitInputs() {
    const surplus = Number(surplusInput);
    const taxRate = taxRateInput === "" ? 0 : Number(taxRateInput) / 100;
    setCommitted({
      surplus: Number.isFinite(surplus) && surplus >= 0 ? surplus : 0,
      taxRate: Number.isFinite(taxRate) && taxRate >= 0 && taxRate < 1 ? taxRate : 0,
    });
  }

  async function toggleSuggestions(enabled) {
    setPrefSaving(true);
    setPrefError(null);
    try {
      const response = await fetch("/api/financial/debt-payoff/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suggestionsEnabled: enabled }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success !== true) {
        throw new Error(payload?.error || "Could not save the preference.");
      }
      // Optimistic: reflect the owner's choice immediately. The next fresh
      // payload from the cache layer clears the override with the canonical value.
      setSuggestionsOverride(payload.data.suggestionsEnabled);
    } catch (saveError) {
      setPrefError(saveError instanceof Error ? saveError.message : "Could not save the preference.");
    } finally {
      setPrefSaving(false);
    }
  }

  const strategies = visible?.strategies ?? null;
  const selected = strategies?.[strategy] ?? null;
  const saved = visible?.interestSavedVsMinimums?.[strategy] ?? null;
  const eligible = visible?.eligible ?? [];
  const needsTerms = visible?.needsTerms ?? [];
  const hasAnyDebts = eligible.length > 0 || needsTerms.length > 0;

  // The API strips the (identical) per-strategy eligible lists; reattach one
  // copy so the deterministic Q&A below works on the true engine shape.
  const comparisonForAnswers =
    visible && strategies
      ? {
          strategies: {
            avalanche: { ...strategies.avalanche, eligible },
            snowball: { ...strategies.snowball, eligible },
            minimums: { ...strategies.minimums, eligible },
          },
          interestSavedVsMinimums: visible.interestSavedVsMinimums,
          topMove: visible.topMove,
        }
      : null;
  const activeAnswer =
    activeQuestion && comparisonForAnswers
      ? answerDebtQuestion(activeQuestion, {
          comparison: comparisonForAnswers,
          debts: eligible,
          extraPerMonth: Number(whatIfInput),
          marginalTaxRate: visible.marginalTaxRate ?? 0,
          strategy,
        })
      : null;

  return (
    <section data-debt-payoff className={forgeTheme.card}>
      <button
        type="button"
        onClick={() => setCollapsed((current) => !current)}
        aria-expanded={!collapsed}
        className="flex w-full items-start justify-between gap-3 rounded-xl text-left"
      >
        <span className="min-w-0">
          <span className={forgeTheme.labelSmall}>Forge Brain</span>
          <h2 className="mt-2 text-2xl font-black text-slate-950 dark:text-slate-50">
            Debt payoff optimizer
          </h2>
        </span>
        <ChevronDown
          size={20}
          aria-hidden="true"
          className={`mt-1 shrink-0 text-slate-500 transition-transform dark:text-slate-400 ${collapsed ? "-rotate-90" : ""}`}
        />
      </button>

      {!collapsed && (
        <>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
            Avalanche vs snowball vs minimums-only, computed from your actual balances with
            standard amortization math. Advisory only — FORGE never moves money; you make
            payments at your bank.
          </p>

          {!visible && isLoading && <ForgeLoadingState label="Building the payoff comparison…" />}
          {!visible && !isLoading && error && (
            <div className="mt-4">
              <ForgeErrorState
                title="Could not build the debt-payoff comparison."
                detail={error}
                onRetry={reload}
              />
            </div>
          )}

          {visible && error && (
            <p role="status" className={`${forgeTheme.textSmall} mt-2`}>
              Could not refresh — showing the last saved comparison.
            </p>
          )}

          {visible && (isRefreshing || !data) && (
            <p role="status" className={`${forgeTheme.textSmall} mt-2`}>
              Updating…
            </p>
          )}

          {visible && !hasAnyDebts && (
            <div className="mt-4">
              <ForgeEmptyState
                headline="No debts found"
                guidance="Connect a credit or loan account, or add one manually, and its balance will show up here for payoff planning."
              />
            </div>
          )}

          {visible && hasAnyDebts && (
            <>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400">
                  Extra $/mo toward debts
                  <input
                    type="number"
                    min="0"
                    step="10"
                    value={surplusInput}
                    onChange={(e) => setSurplusInput(e.target.value)}
                    onBlur={commitInputs}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitInputs();
                    }}
                    className="ml-2 w-28 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                </label>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-400">
                  Marginal tax rate %
                  <input
                    type="number"
                    min="0"
                    max="99"
                    step="1"
                    value={taxRateInput}
                    placeholder="0"
                    onChange={(e) => setTaxRateInput(e.target.value)}
                    onBlur={commitInputs}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitInputs();
                    }}
                    className="ml-2 w-20 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                </label>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <input
                  id="debt-payoff-suggestions"
                  type="checkbox"
                  checked={suggestionsEnabled}
                  disabled={prefSaving}
                  onChange={(e) => toggleSuggestions(e.target.checked)}
                />
                <label
                  htmlFor="debt-payoff-suggestions"
                  className="text-sm text-slate-700 dark:text-slate-300"
                >
                  Show debt payoff suggestions in the Brain digest and inbox
                </label>
              </div>
              {prefError && (
                <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {prefError}
                </p>
              )}

              {eligible.length > 0 && selected && (
                <>
                  <div className="mt-4 flex gap-2" role="tablist" aria-label="Payoff strategy">
                    {Object.keys(STRATEGY_LABELS).map((key) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={strategy === key}
                        onClick={() => setStrategy(key)}
                        className={`rounded-full px-3 py-1 text-xs font-bold ${
                          strategy === key
                            ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                        }`}
                      >
                        {STRATEGY_LABELS[key]}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    {STRATEGY_HINTS[strategy]}
                  </p>

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                      <p className="text-xs text-slate-500 dark:text-slate-400">Total interest</p>
                      <p className="text-lg font-black text-slate-900 dark:text-slate-100">
                        {money2(selected.totalInterest)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                      <p className="text-xs text-slate-500 dark:text-slate-400">Debt-free</p>
                      <p className="text-lg font-black text-slate-900 dark:text-slate-100">
                        {selected.converged ? debtFreeLabel(selected.monthsToDebtFree) : "Never — minimums don't cover interest"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                      <p className="text-xs text-slate-500 dark:text-slate-400">Saved vs minimums</p>
                      <p className="text-lg font-black text-emerald-700 dark:text-emerald-400">
                        {saved != null ? money2(saved) : "—"}
                      </p>
                    </div>
                  </div>

                  <ol className="mt-4 flex flex-col gap-2">
                    {selected.order.map((entry, index) => (
                      <li
                        key={entry.id}
                        className="flex items-baseline justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2 dark:border-slate-700 dark:bg-slate-900"
                      >
                        <p className="text-sm text-slate-800 dark:text-slate-200">
                          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-xs font-black text-white dark:bg-slate-100 dark:text-slate-900">
                            {index + 1}
                          </span>
                          {entry.name}
                        </p>
                        <p className={forgeTheme.textSmall}>
                          {entry.payoffMonth != null
                            ? `Clear month ${entry.payoffMonth} · ${money2(entry.totalInterest)} interest`
                            : "Never clears at this pace"}
                        </p>
                      </li>
                    ))}
                  </ol>

                  <div className="mt-4">
                    <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">
                      Ask about this plan
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {DEBT_QUESTION_CHIPS.map((chip) => (
                        <button
                          key={chip.id}
                          type="button"
                          onClick={() =>
                            setActiveQuestion((current) => (current === chip.id ? null : chip.id))
                          }
                          aria-pressed={activeQuestion === chip.id}
                          className={`rounded-full px-3 py-1 text-xs font-bold ${
                            activeQuestion === chip.id
                              ? "bg-sky-700 text-white dark:bg-sky-500 dark:text-slate-950"
                              : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                          }`}
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                    {activeAnswer && (
                      <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 dark:border-sky-900 dark:bg-sky-950/40">
                        {activeQuestion === "what-if" && (
                          <label className="mb-2 block text-xs font-bold text-slate-600 dark:text-slate-400">
                            Extra $/mo to model
                            <input
                              type="number"
                              min="0"
                              step="10"
                              value={whatIfInput}
                              aria-label="Extra dollars per month to model"
                              onChange={(e) => setWhatIfInput(e.target.value)}
                              className="ml-2 w-28 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                            />
                          </label>
                        )}
                        <p className="text-sm leading-6 text-slate-800 dark:text-slate-200">
                          {activeAnswer}
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}

              {eligible.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">
                    Your debts
                  </h3>
                  <ul className="mt-2 flex flex-col gap-2">
                    {eligible.map((debt) => (
                      <DebtRow
                        key={debt.id}
                        debt={debt}
                        needsTerms={false}
                        onTermsChanged={reload}
                      />
                    ))}
                  </ul>
                </div>
              )}

              {needsTerms.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">
                    Needs your rate
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    The feed carries balances but not rates. Enter the APR and minimum once per
                    account — the optimizer never guesses.
                  </p>
                  <ul className="mt-2 flex flex-col gap-2">
                    {needsTerms.map((debt) => (
                      <DebtRow
                        key={debt.id}
                        debt={debt}
                        needsTerms
                        onTermsChanged={reload}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
