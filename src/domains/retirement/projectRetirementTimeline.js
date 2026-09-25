// Year-by-year retirement balance projection for the retirement-number card's
// milestone timeline chart (Boldin-style).
//
// Everything is in retirement-start REAL dollars — the same frame as
// backtestRetirement — so no inflation math is needed inside the projection.
// The growth assumption is NOT invented: it is the long-run average annual
// real return of the user's allocation mix, computed from the bundled Shiller
// dataset (1871-2022). It is surfaced in the UI as "the historical average,
// not a promise".
//
// The projection covers retirement only (retirementAge -> planningAge).
// Pre-retirement accumulation is deliberately NOT modeled — the card never
// asked for current savings, and inventing an accumulation path would be a
// fabrication. The chart shows pre-retirement years as a milestone runway.
//
// Spending smile: optional spendingDeclinePct compounds per retirement year
// (withdrawal * (1 - decline)^i), matching backtestRetirement.
//
// Pure function: no I/O, no Date, no randomness. Safe to run in useMemo.
import { stepRetirementYear } from "./backtestRetirement.js";

function nullResult(horizonYears) {
  return {
    avgRealReturnPct: null,
    years: [],
    exhaustedAt: null,
    horizonYears,
  };
}

/**
 * Long-run average annual real return (in percent) of a stock/bond mix,
 * straight from the dataset. Exported so the UI can label the assumption
 * with the exact figure being used.
 */
export function averageRealReturnPct({ stockPct = 0.6, data } = {}) {
  const years = data?.years;
  const stockReal = data?.stockReal;
  const bondReal = data?.bondReal;
  if (
    !Array.isArray(years) ||
    !Array.isArray(stockReal) ||
    !Array.isArray(bondReal) ||
    years.length === 0 ||
    stockReal.length !== years.length ||
    bondReal.length !== years.length
  ) {
    return null;
  }
  const mix = Number.isFinite(stockPct) ? Math.min(1, Math.max(0, stockPct)) : 0.6;
  let sum = 0;
  for (let i = 0; i < years.length; i += 1) {
    sum += mix * stockReal[i] + (1 - mix) * bondReal[i];
  }
  return (sum / years.length) * 100;
}

export default function projectRetirementTimeline({
  retirementAge,
  planningAge,
  retirementYear = null,
  nestEgg,
  annualWithdrawal,
  stockPct = 0.6,
  data,
  spendingDeclinePct = 0,
}) {
  const start = Number.isFinite(retirementAge) ? Math.floor(retirementAge) : NaN;
  const end = Number.isFinite(planningAge) ? Math.floor(planningAge) : NaN;
  const horizon = Number.isFinite(start) && Number.isFinite(end) ? end - start : NaN;
  const startingNestEgg = Number.isFinite(nestEgg) ? nestEgg : NaN;
  const withdrawal = Number.isFinite(annualWithdrawal) ? annualWithdrawal : NaN;

  if (!Number.isFinite(horizon) || horizon < 0 || !Number.isFinite(startingNestEgg) || !Number.isFinite(withdrawal)) {
    return nullResult(Number.isFinite(horizon) && horizon >= 0 ? horizon : null);
  }

  const avgPct = averageRealReturnPct({ stockPct, data });
  if (avgPct == null) return nullResult(horizon);
  const avg = avgPct / 100;

  // Same smile semantics as backtestRetirement: non-positive or non-finite
  // declines clamp to 0 (flat real); capped at 99%.
  const decline =
    Number.isFinite(spendingDeclinePct) && spendingDeclinePct > 0 ? Math.min(spendingDeclinePct, 99) / 100 : 0;

  const baseYear = Number.isFinite(retirementYear) ? Math.floor(retirementYear) : null;

  const years = [];
  let balance = startingNestEgg;
  let exhaustedAt = null;

  // Point i is the balance at the START of retirement year i (age
  // retirementAge + i), after i rounds of the shared growth-first step —
  // the same calculation convention as backtestRetirement, so the two
  // views agree on exhaustion.
  for (let i = 0; i <= horizon; i += 1) {
    const yearWithdrawal = i < horizon ? withdrawal * (1 - decline) ** i : null;
    years.push({
      age: start + i,
      calendarYear: baseYear == null ? null : baseYear + i,
      balance,
      withdrawal: yearWithdrawal,
    });
    if (i === horizon) break;
    balance = stepRetirementYear(balance, avg, yearWithdrawal);
    if (balance <= 0) {
      // The money runs out during this year: the next point would be
      // negative, so the line ends here instead of rendering a fiction.
      exhaustedAt = start + i + 1;
      balance = 0;
      years.push({
        age: start + i + 1,
        calendarYear: baseYear == null ? null : baseYear + i + 1,
        balance: 0,
        withdrawal: null,
      });
      break;
    }
  }

  return {
    avgRealReturnPct: Math.round(avgPct * 100) / 100,
    years,
    exhaustedAt,
    horizonYears: horizon,
  };
}
