// Debt-payoff optimizer: deterministic avalanche vs snowball vs minimums-only
// comparison. Pure, no LLM calls, no I/O -- callers fetch the owner's debts
// (balances from the liability feed, APR/minimums from owner-confirmed debt
// terms) and pass plain objects in.
//
// Conventions (human units throughout): balance is dollars owed (positive),
// apr is a percent (6.5 = 6.5%), minimumPayment is dollars per month, and
// monthlySurplus is extra dollars per month beyond all minimums. Internally
// the simulation works in whole cents so interest can't drift on floats.
//
// Methodology (standard debt avalanche/snowball): every month each unpaid
// debt accrues one month of interest, then every unpaid debt receives its
// minimum payment. Whatever is left of (monthlySurplus + the minimums freed
// by already-paid debts) attacks the first unpaid debt in the strategy order,
// rolling any remainder to the next. Nothing is ever invented: a debt with a
// missing or invalid APR/minimum is classified as needsTerms and excluded
// from the simulation, never guessed.

export const STRATEGY_AVALANCHE = "avalanche";
export const STRATEGY_SNOWBALL = "snowball";
export const STRATEGY_MINIMUMS = "minimums";
export const STRATEGIES = Object.freeze([STRATEGY_AVALANCHE, STRATEGY_SNOWBALL, STRATEGY_MINIMUMS]);

// Owner preference key for the proactive debt-payoff suggestions (digest +
// inbox "top move"). Absence of a row means the default: ON.
export const DEBT_PAYOFF_SUGGESTIONS_PREFERENCE = "debt_payoff_suggestions_enabled";

// A payoff that hasn't converged in 50 years is reported as never paying off
// rather than simulated forever (e.g. minimums that don't cover interest).
const MAX_MONTHS = 600;

function toCents(dollars) {
  const n = Number(dollars);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function toDollars(cents) {
  // Normalize -0 to 0 so payloads serialize cleanly.
  return Math.round(cents) / 100 + 0;
}

function isValidApr(apr) {
  // null/undefined means "no confirmed rate" -- missing, not 0%. A genuine
  // 0% APR arrives as the number 0.
  if (apr == null) return false;
  const n = Number(apr);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

function normalizeDebt(debt) {
  if (!debt || typeof debt !== "object") return null;
  const balanceCents = toCents(debt.balance);
  if (balanceCents == null || balanceCents <= 0) return null;
  const id = typeof debt.id === "string" && debt.id.length > 0 ? debt.id : null;
  if (!id) return null;
  return {
    id,
    name: typeof debt.name === "string" && debt.name.length > 0 ? debt.name : id,
    balanceCents,
    apr: isValidApr(debt.apr) ? Number(debt.apr) : null,
    minimumCents: toCents(debt.minimumPayment),
    taxDeductible: debt.taxDeductible === true,
  };
}

// After-tax honesty: a deductible debt (the mortgage) costs less than its
// sticker APR. Ordering avalanche by the effective rate ranks debts by their
// true cost; the sticker APR is still shown next to it.
export function effectiveApr(debt, marginalTaxRate = 0) {
  const apr = Number(debt?.apr);
  const rate = Number(marginalTaxRate);
  if (!Number.isFinite(apr) || apr < 0) return null;
  const clamped = Number.isFinite(rate) && rate > 0 ? Math.min(rate, 0.99) : 0;
  if (debt?.taxDeductible !== true || clamped === 0) return Math.round(apr * 100) / 100;
  return Math.round(apr * (1 - clamped) * 100) / 100;
}

// Split debts into optimizable ones and ones waiting on owner-confirmed
// terms. Missing APR/minimum is a "needs your rate" state, never a guess.
export function classifyDebtTerms(debts) {
  const eligible = [];
  const needsTerms = [];
  for (const debt of debts ?? []) {
    const normalized = normalizeDebt(debt);
    if (!normalized) continue;
    const minimumOk = normalized.minimumCents != null && normalized.minimumCents > 0;
    if (normalized.apr == null || !minimumOk) {
      needsTerms.push(
        Object.freeze({
          id: normalized.id,
          name: normalized.name,
          balance: toDollars(normalized.balanceCents),
          missingApr: normalized.apr == null,
          missingMinimum: !minimumOk,
          taxDeductible: normalized.taxDeductible,
        }),
      );
    } else {
      eligible.push(Object.freeze({ ...normalized, balance: toDollars(normalized.balanceCents) }));
    }
  }
  return Object.freeze({
    eligible: Object.freeze(eligible),
    needsTerms: Object.freeze(needsTerms),
  });
}

function orderDebts(eligible, strategy, marginalTaxRate) {
  const ranked = eligible.map((debt) => ({
    debt,
    key: strategy === STRATEGY_SNOWBALL ? debt.balanceCents : effectiveApr(debt, marginalTaxRate),
  }));
  ranked.sort((a, b) => {
    if (a.key !== b.key) return strategy === STRATEGY_SNOWBALL ? a.key - b.key : b.key - a.key;
    // Deterministic tiebreaks: bigger balance first for avalanche (kills the
    // costliest pile), then stable by id.
    if (a.debt.balanceCents !== b.debt.balanceCents) return b.debt.balanceCents - a.debt.balanceCents;
    return a.debt.id < b.debt.id ? -1 : 1;
  });
  return ranked.map((entry) => entry.debt);
}

function simulatePayoff(ordered, monthlySurplusCents) {
  const balances = new Map(ordered.map((debt) => [debt.id, debt.balanceCents]));
  const paidOff = new Set();
  const payoffMonth = new Map();
  const interestById = new Map(ordered.map((debt) => [debt.id, 0]));
  const monthlyRateById = new Map(ordered.map((debt) => [debt.id, debt.apr / 100 / 12]));

  let month = 0;
  let converged = true;

  while (paidOff.size < ordered.length && month < MAX_MONTHS) {
    month += 1;

    // 1. Interest accrues on every unpaid balance.
    for (const debt of ordered) {
      if (paidOff.has(debt.id)) continue;
      const interest = Math.round(balances.get(debt.id) * monthlyRateById.get(debt.id));
      balances.set(debt.id, balances.get(debt.id) + interest);
      interestById.set(debt.id, interestById.get(debt.id) + interest);
    }

    // 2. Minimums on every unpaid debt.
    let freedMinimums = 0;
    for (const debt of ordered) {
      if (paidOff.has(debt.id)) {
        freedMinimums += debt.minimumCents;
        continue;
      }
      const balance = balances.get(debt.id);
      const payment = Math.min(debt.minimumCents, balance);
      const remaining = balance - payment;
      balances.set(debt.id, remaining);
      if (remaining <= 0) {
        paidOff.add(debt.id);
        payoffMonth.set(debt.id, month);
      }
    }

    // 3. Surplus + freed minimums attack the first unpaid debt in order,
    //    rolling any remainder down the line.
    let attack = monthlySurplusCents + freedMinimums;
    for (const debt of ordered) {
      if (attack <= 0) break;
      if (paidOff.has(debt.id)) continue;
      const balance = balances.get(debt.id);
      const payment = Math.min(balance, attack);
      const remaining = balance - payment;
      attack -= payment;
      balances.set(debt.id, remaining);
      if (remaining <= 0) {
        paidOff.add(debt.id);
        payoffMonth.set(debt.id, month);
      }
    }
  }

  if (paidOff.size < ordered.length) converged = false;

  const order = ordered.map((debt) =>
    Object.freeze({
      id: debt.id,
      name: debt.name,
      payoffMonth: payoffMonth.get(debt.id) ?? null,
      totalInterest: toDollars(interestById.get(debt.id)),
    }),
  );
  const totalInterestCents = [...interestById.values()].reduce((sum, cents) => sum + cents, 0);
  return {
    order: Object.freeze(order),
    totalInterest: toDollars(totalInterestCents),
    monthsToDebtFree: converged ? month : null,
    converged,
  };
}

export function optimizeDebtPayoff({ debts = [], monthlySurplus = 0, strategy = STRATEGY_AVALANCHE, marginalTaxRate = 0 } = {}) {
  const { eligible, needsTerms } = classifyDebtTerms(debts);
  const surplusCents = toCents(monthlySurplus);
  const safeSurplus = surplusCents != null && surplusCents > 0 ? surplusCents : 0;
  const resolvedStrategy = STRATEGIES.includes(strategy) ? strategy : STRATEGY_AVALANCHE;

  if (eligible.length === 0) {
    return Object.freeze({
      strategy: resolvedStrategy,
      eligible: Object.freeze([]),
      needsTerms,
      order: Object.freeze([]),
      totalInterest: 0,
      monthsToDebtFree: null,
      converged: true,
      monthlySurplus: toDollars(safeSurplus),
      marginalTaxRate: Number(marginalTaxRate) || 0,
    });
  }

  const ordered = orderDebts(eligible, resolvedStrategy, marginalTaxRate);
  const simulation = simulatePayoff(ordered, safeSurplus);

  return Object.freeze({
    strategy: resolvedStrategy,
    eligible: Object.freeze(
      eligible.map((debt) =>
        Object.freeze({
          id: debt.id,
          name: debt.name,
          balance: debt.balance,
          apr: debt.apr,
          effectiveApr: effectiveApr(debt, marginalTaxRate),
          minimumPayment: toDollars(debt.minimumCents),
          taxDeductible: debt.taxDeductible,
        }),
      ),
    ),
    needsTerms,
    order: simulation.order,
    totalInterest: simulation.totalInterest,
    monthsToDebtFree: simulation.monthsToDebtFree,
    converged: simulation.converged,
    monthlySurplus: toDollars(safeSurplus),
    marginalTaxRate: Number(marginalTaxRate) || 0,
  });
}

// The three-way comparison the panel and the digest consume. interestSaved
// is null when either side never converges (e.g. minimums that don't cover
// interest make the savings unbounded, not zero).
export function compareDebtPayoffStrategies({ debts = [], monthlySurplus = 0, marginalTaxRate = 0 } = {}) {
  const avalanche = optimizeDebtPayoff({ debts, monthlySurplus, strategy: STRATEGY_AVALANCHE, marginalTaxRate });
  const snowball = optimizeDebtPayoff({ debts, monthlySurplus, strategy: STRATEGY_SNOWBALL, marginalTaxRate });
  const minimums = optimizeDebtPayoff({ debts, monthlySurplus: 0, strategy: STRATEGY_MINIMUMS, marginalTaxRate });

  const savedVsMinimums = (plan) => {
    if (!plan.converged || !minimums.converged) return null;
    return toDollars(toCents(minimums.totalInterest) - toCents(plan.totalInterest));
  };

  const firstTarget = avalanche.order[0] ?? null;
  const avalancheSaved = savedVsMinimums(avalanche);
  // No benefit, no suggestion: a plan that saves nothing (or can't beat
  // minimums) stays silent for every consumer of topMove.
  const topMove =
    firstTarget && avalanche.converged && avalancheSaved != null && avalancheSaved > 0
      ? Object.freeze({
          debtId: firstTarget.id,
          debtName: firstTarget.name,
          extraPerMonth: avalanche.monthlySurplus,
          interestSaved: avalancheSaved,
          monthsSaved:
            minimums.converged && minimums.monthsToDebtFree != null && avalanche.monthsToDebtFree != null
              ? minimums.monthsToDebtFree - avalanche.monthsToDebtFree
              : null,
          strategy: STRATEGY_AVALANCHE,
        })
      : null;

  return Object.freeze({
    strategies: Object.freeze({ avalanche, snowball, minimums }),
    interestSavedVsMinimums: Object.freeze({
      avalanche: savedVsMinimums(avalanche),
      snowball: savedVsMinimums(snowball),
    }),
    topMove,
  });
}
