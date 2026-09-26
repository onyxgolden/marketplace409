"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { forgeTheme } from "@/components/forge/theme";
import {
  ForgeEmptyState,
  ForgeErrorState,
  ForgeLoadingState,
} from "@/components/forge/ForgeStates";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { money } from "./formatMoney.js";
import {
  buildLeftThisMonth,
  describeLeftThisMonth,
  monthKeyOf,
} from "./leftThisMonth.js";

// The financial dashboard's "Left this month" cash-flow residual: expected
// income remaining minus expected bills remaining minus planned spending,
// derived from real data (detected recurring payments + the month's budget
// plan) with the math spelled out in plain language. Read-only -- nothing here
// moves money.
async function loadLeftThisMonth(monthKey) {
  const recurringPayload = await fetch("/api/financial/recurring")
    .then((response) => response.json().then((payload) => ({ response, payload })))
    .then(({ response, payload }) =>
      response.ok && payload?.success !== false ? payload.patterns ?? [] : [],
    )
    .catch(() => []);

  // Budget is advisory: a 503 (budgeting schema not yet available) or a
  // failure just means planned spending is untracked, never a fabricated zero.
  let budgetLines = null;
  try {
    const response = await fetch(`/api/budgeting/plan?month=${monthKey}&scope=personal`);
    const payload = await response.json();
    if (response.ok && Array.isArray(payload?.lines)) {
      budgetLines = payload.lines;
    }
  } catch {
    budgetLines = null;
  }

  return { patterns: recurringPayload, budgetLines };
}

const TONE_STYLES = {
  positive: "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40",
  negative: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40",
  neutral: "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60",
};

const TONE_VALUE = {
  positive: "text-emerald-700 dark:text-emerald-300",
  negative: "text-red-700 dark:text-red-300",
  neutral: "text-slate-900 dark:text-slate-100",
};

export default function LeftThisMonthPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const [monthKey] = useState(() => monthKeyOf(new Date()));

  const { data, error, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    `financial:left-this-month:${monthKey}`,
    () => loadLeftThisMonth(monthKey),
    { ttlMs: 60_000 },
  );

  const result = data ? buildLeftThisMonth(data) : null;
  const description = result?.hasAnyData ? describeLeftThisMonth(result, money) : null;
  // An unknown residual (income/bills untracked) is neutral -- never green or
  // red, since there is no number to feel good or bad about.
  let tone = "neutral";
  if (result?.hasAnyData && result.residualKnown) {
    tone = result.overBudget ? "negative" : "positive";
  }

  return (
    <section data-left-this-month className={forgeTheme.card}>
      <button
        type="button"
        onClick={() => setCollapsed((current) => !current)}
        aria-expanded={!collapsed}
        className="flex w-full items-start justify-between gap-3 rounded-xl text-left"
      >
        <span className="min-w-0">
          <span className={forgeTheme.labelSmall}>Forge Brain</span>
          <h2 className="mt-2 text-2xl font-black text-slate-950 dark:text-slate-50">
            Left this month
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
            Expected income minus expected bills minus planned spending, from your
            detected recurring payments and budget &mdash; read-only, nothing here
            moves money.
          </p>

          <div className="mt-4">
            {!result && isLoading && (
              <ForgeLoadingState label="Working out what’s left this month…" />
            )}

            {!result && !isLoading && error && (
              <ForgeErrorState
                title="Could not work out what’s left this month."
                detail={error}
                onRetry={refresh}
              />
            )}

            {result && error && (
              <p role="status" className={`${forgeTheme.textSmall} mt-2`}>
                Could not refresh &mdash; showing the last saved calculation.
              </p>
            )}

            {result && (isRefreshing || !data) && (
              <p role="status" className={`${forgeTheme.textSmall} mt-2`}>
                Updating&hellip;
              </p>
            )}

            {result && !result.hasAnyData && (
              <ForgeEmptyState
                headline="Not enough data to say what’s left this month"
                guidance="This widget reads your real data and won’t guess: connect accounts so recurring payments can be detected, or set up a budget for this month, and the math will appear here."
                actionHref="/forge/budget"
                actionLabel="Set up a budget"
              />
            )}

            {result && result.hasAnyData && description && (
              <div
                className={`rounded-2xl border px-5 py-4 ${TONE_STYLES[tone]}`}
              >
                <p
                  className={`text-3xl font-black tracking-tight ${TONE_VALUE[tone]}`}
                  aria-live="polite"
                >
                  {description.resultText}
                </p>
                <p className="mt-3 text-sm font-bold text-slate-800 dark:text-slate-100">
                  {description.equation} = {description.resultText}{" "}
                  <span aria-hidden="true">&middot;</span> {description.dailyText}
                </p>
                <ul className="mt-3 flex flex-col gap-2 text-sm text-slate-600 dark:text-slate-400">
                  <li>{description.incomeNote}</li>
                  <li>{description.billsNote}</li>
                  <li>{description.plannedNote}</li>
                  {description.overlapNote && <li>{description.overlapNote}</li>}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
