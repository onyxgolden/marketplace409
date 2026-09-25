// Historical backtesting survival analysis for the retirement-number card.
//
// Replays every possible retirement start year through the real Shiller annual
// dataset (1871-2022, Jan-to-Jan REAL total returns for US stocks and long-term
// US Treasuries incl. reinvested dividends/coupons). Everything is in REAL
// terms: nestEgg and annualWithdrawal are retirement-start dollars, and the
// series are real returns, so no inflation adjustment is needed inside the
// simulation. Annual rebalancing back to stockPct is implied by the blended
// return each year.
//
// This is the cFIREsim/FIRECalc "time machine" approach, not Monte Carlo: no
// invented return assumptions, but past returns don't predict the future.
// Caveats live in the dataset meta block (src/domains/retirement/shillerAnnual.json)
// and are surfaced in the UI caption.
//
// Optional spendingDeclinePct models the Blanchett/Kitces spending smile:
// annual withdrawals fall that many percent per year in real terms
// (withdrawal * (1 - decline)^i in retirement year i). Default 0 = flat real.
//
// Pure function: no I/O, no Date, no randomness. Safe to run in useMemo.

function nullResult(horizonYears) {
  return {
    windowsTested: 0,
    successes: 0,
    failures: 0,
    survivalPct: null,
    worstStarts: [],
    horizonYears,
  };
}

// Single-year portfolio step, shared with projectRetirementTimeline so both
// views use the identical ordering convention: growth is applied FIRST, then
// the year's withdrawal is taken.
// next = balance * (1 + realReturn) - yearWithdrawal
export function stepRetirementYear(balance, realReturn, yearWithdrawal) {
  return balance * (1 + realReturn) - yearWithdrawal;
}

export default function backtestRetirement({ nestEgg, annualWithdrawal, stockPct = 0.6, horizonYears, data, spendingDeclinePct = 0 }) {
  const horizon = Number.isFinite(horizonYears) ? Math.floor(horizonYears) : NaN;
  if (!Number.isFinite(horizon) || horizon < 1) return nullResult(horizonYears);

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
    return nullResult(horizon);
  }

  const mix = Number.isFinite(stockPct) ? Math.min(1, Math.max(0, stockPct)) : 0.6;
  const withdrawal = Number.isFinite(annualWithdrawal) ? annualWithdrawal : 0;
  const startingNestEgg = Number.isFinite(nestEgg) ? nestEgg : 0;
  // Spending smile (Blanchett/Kitces): real withdrawals decline ~1%/yr.
  // The decline compounds per retirement year: year i withdraws
  // withdrawal * (1 - decline)^i, so year 0 is the full first-year amount.
  // Non-positive or non-finite declines clamp to 0 (flat real spending);
  // a decline of 100%+ would zero out withdrawals immediately, so cap at 99.
  const decline = Number.isFinite(spendingDeclinePct) && spendingDeclinePct > 0
    ? Math.min(spendingDeclinePct, 99) / 100
    : 0;

  const yearToIndex = new Map();
  for (let i = 0; i < years.length; i += 1) yearToIndex.set(years[i], i);

  const firstYear = years[0];
  const lastStartYear = years[years.length - 1] - horizon;
  const result = {
    windowsTested: 0,
    successes: 0,
    failures: 0,
    survivalPct: null,
    worstStarts: [],
    horizonYears: horizon,
  };

  // Zero or negative withdrawal: nothing is ever drawn down, so the portfolio
  // cannot be exhausted (covers the "nothing to fund" case too).
  if (withdrawal <= 0) {
    return { ...result, survivalPct: 100 };
  }

  for (let startYear = firstYear; startYear <= lastStartYear; startYear += 1) {
    // Every year of the window must exist in the dataset (guards against
    // ragged series); a window with a missing year is not tested.
    let windowValid = true;
    const returns = [];
    for (let i = 0; i < horizon; i += 1) {
      const idx = yearToIndex.get(startYear + i);
      if (idx == null) {
        windowValid = false;
        break;
      }
      returns.push(mix * stockReal[idx] + (1 - mix) * bondReal[idx]);
    }
    if (!windowValid) continue;

    result.windowsTested += 1;
    let portfolio = startingNestEgg;
    let survived = true;
    for (let i = 0; i < horizon; i += 1) {
      const yearWithdrawal = withdrawal * (1 - decline) ** i;
      portfolio = stepRetirementYear(portfolio, returns[i], yearWithdrawal);
      if (portfolio <= 0) {
        survived = false;
        break;
      }
    }
    if (survived) {
      result.successes += 1;
    } else {
      result.failures += 1;
      if (result.worstStarts.length < 5) result.worstStarts.push(startYear);
    }
  }

  if (result.windowsTested === 0) return { ...result, survivalPct: null };

  result.survivalPct = Math.round((result.successes / result.windowsTested) * 1000) / 10;
  return result;
}
