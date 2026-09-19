/**
 * Deterministic Q&A over the debt-payoff engine (Brain slice 7).
 *
 * Each exported answer is a PURE function of engine output: it takes a
 * comparison from compareDebtPayoffStrategies() (or the debts + inputs to
 * run one) and returns a human sentence built only from those numbers.
 * No LLM, no free-text parsing, no fabricated figures -- if the engine has
 * no number, the answer says so instead of inventing one.
 */

import { compareDebtPayoffStrategies } from "./debtPayoff.js";

export const DEBT_QUESTION_CHIPS = Object.freeze([
  { id: "target-first", label: "Which debt should I target first?" },
  { id: "interest-saved", label: "How much interest will I save?" },
  { id: "debt-free-when", label: "When will I be debt-free?" },
  { id: "what-if", label: "What if I pay extra each month?", amount: true },
]);

const STRATEGY_LABELS = Object.freeze({
  avalanche: "Avalanche",
  snowball: "Snowball",
  minimums: "Minimums-only",
});

function fmtMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function fmtPct(value) {
  return `${Number(value).toFixed(2)}%`;
}

function rateBit(terms) {
  if (!terms || terms.apr == null) return "";
  if (terms.taxDeductible === true && terms.effectiveApr !== terms.apr) {
    return ` (${fmtPct(terms.effectiveApr)} after-tax, ${fmtPct(terms.apr)} sticker)`;
  }
  return ` (${fmtPct(terms.apr)} APR)`;
}

/**
 * Which debt to attack first: the head of the avalanche order, with the
 * savings attached when the comparison produced a top move.
 */
export function answerTargetFirst(comparison) {
  const order = comparison?.strategies?.avalanche?.order ?? [];
  const first = order[0];
  if (!first) {
    return (
      "The optimizer can't pick a target yet — enter the APR and minimum " +
      "for each debt below and the ranking will appear here."
    );
  }
  const terms = (comparison?.strategies?.avalanche?.eligible ?? []).find((d) => d?.id === first.id);
  let answer =
    `Target ${first.name} first — it carries the highest effective rate` +
    `${terms ? `${rateBit(terms)} on a ${fmtMoney(terms.balance)} balance` : ""}.`;
  const topMove = comparison?.topMove;
  if (topMove && topMove.debtId === first.id && Number(topMove.interestSaved) > 0) {
    answer +=
      ` Putting the extra ${fmtMoney(topMove.extraPerMonth)}/mo toward it saves ` +
      `${fmtMoney(topMove.interestSaved)} in interest vs minimums-only`;
    if (Number(topMove.monthsSaved) > 0) {
      answer += ` and clears every debt ${topMove.monthsSaved} months sooner`;
    }
    answer += ".";
  }
  return answer;
}

/**
 * Interest saved vs the minimums-only baseline, for the selected strategy.
 */
export function answerInterestSaved(comparison, strategy = "avalanche") {
  const baseline = comparison?.strategies?.minimums;
  if (strategy === "minimums") {
    if (!baseline) {
      return "Run the comparison first — the savings are computed from your actual balances.";
    }
    const months = baseline.converged ? ` over ${baseline.monthsToDebtFree} months` : "";
    return (
      `Minimums-only is the baseline: ${fmtMoney(baseline.totalInterest)} in total interest${months}. ` +
      "Pick avalanche or snowball above to see what an extra monthly payment saves against it."
    );
  }
  const key = strategy === "snowball" ? "snowball" : "avalanche";
  const plan = comparison?.strategies?.[key];
  if (!plan || !baseline) {
    return "Run the comparison first — the savings are computed from your actual balances.";
  }
  const saved = comparison?.interestSavedVsMinimums?.[key];
  if (saved == null) {
    return (
      "Minimums-only never pays these debts off — the minimums don't cover the monthly " +
      "interest — so there is no finite savings number. Any extra payment beats a balance " +
      "that grows forever."
    );
  }
  return (
    `${STRATEGY_LABELS[key]} saves ${fmtMoney(saved)} in interest vs minimums-only ` +
    `(${fmtMoney(baseline.totalInterest)} → ${fmtMoney(plan.totalInterest)}).`
  );
}

/**
 * Debt-free timing per strategy, straight from the engine's month counts.
 */
export function answerDebtFreeWhen(comparison) {
  const strategies = comparison?.strategies;
  if (!strategies) return "Run the comparison first — the timing comes from your actual balances.";
  const order = (comparison?.strategies?.avalanche?.order ?? []);
  if (order.length === 0) {
    return "No debts with confirmed terms yet — enter the APR and minimum for each account below first.";
  }
  const parts = ["avalanche", "snowball", "minimums"].map((key) => {
    const plan = strategies[key];
    const label = STRATEGY_LABELS[key];
    if (!plan?.converged) {
      return `${label}: never — the minimums don't cover the monthly interest`;
    }
    return `${label}: debt-free in ${plan.monthsToDebtFree} months`;
  });
  return parts.join(". ") + ".";
}

/**
 * Re-runs the engine with a hypothetical extra monthly payment. Pure:
 * same debts, same math, different surplus.
 */
export function answerWhatIf({ debts, extraPerMonth, marginalTaxRate = 0 }) {
  const list = Array.isArray(debts) ? debts : [];
  if (list.length === 0) {
    return "Enter the APR and minimum for each debt below first — there's nothing to model yet.";
  }
  const extra = Number(extraPerMonth);
  if (!Number.isFinite(extra) || extra < 0) {
    return "Enter a non-negative dollar amount to model.";
  }
  const comparison = compareDebtPayoffStrategies({
    debts: list,
    monthlySurplus: extra,
    marginalTaxRate,
  });
  const { avalanche, minimums } = comparison.strategies;
  if (!avalanche.converged) {
    return (
      `With ${fmtMoney(extra)}/mo extra these debts still don't pay off — the payments ` +
      "don't cover the monthly interest. A larger extra payment would be needed."
    );
  }
  let answer =
    `With ${fmtMoney(extra)}/mo extra, avalanche clears every debt in ` +
    `${avalanche.monthsToDebtFree} months, costing ${fmtMoney(avalanche.totalInterest)} in interest`;
  const saved = comparison.interestSavedVsMinimums.avalanche;
  if (saved != null && saved > 0) {
    answer += ` — ${fmtMoney(saved)} less than minimums-only`;
    if (minimums.converged && minimums.monthsToDebtFree != null) {
      const sooner = minimums.monthsToDebtFree - avalanche.monthsToDebtFree;
      if (sooner > 0) answer += ` and ${sooner} months sooner`;
    }
    answer += ".";
  } else if (!minimums.converged) {
    answer += ", vs minimums-only which never pays them off.";
  } else {
    answer += ".";
  }
  return answer;
}

/**
 * Dispatcher: question id -> answer string. Returns null for unknown ids.
 * `context` is { comparison, debts, extraPerMonth, marginalTaxRate, strategy }.
 */
export function answerDebtQuestion(questionId, context = {}) {
  switch (questionId) {
    case "target-first":
      return answerTargetFirst(context.comparison);
    case "interest-saved":
      return answerInterestSaved(context.comparison, context.strategy ?? "avalanche");
    case "debt-free-when":
      return answerDebtFreeWhen(context.comparison);
    case "what-if":
      return answerWhatIf({
        debts: context.debts,
        extraPerMonth: context.extraPerMonth,
        marginalTaxRate: context.marginalTaxRate ?? 0,
      });
    default:
      return null;
  }
}
