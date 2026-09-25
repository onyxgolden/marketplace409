// Deterministic 4%-rule retirement-number math for the FORGE budget page card.
//
// All dollar inputs are in TODAY'S dollars. General spending, Social Security,
// and rental cash flow are inflated to retirement-year dollars at the general
// inflation rate; healthcare is inflated at its own (faster) healthcare rate,
// in two phases (pre-65 bridge vs post-65 Medicare).
//
// No Monte Carlo, no return assumptions — this is the deterministic slice.
// A historical-backtesting probability frame is deliberately left for Slice B.

/**
 * Declining real spending: modeled as withdrawals falling roughly 1%/yr in
 * real terms. This is NOT the Blanchett/Kitces spending smile (which dips
 * mid-retirement and rises late as healthcare climbs) — it is a simpler
 * declining-spending assumption, labeled as such in the UI. The deterministic
 * 4%-rule shorthand treats the nest egg as funding a FLAT real perpetuity at
 * the withdrawal rate w: nestEgg = S / w. With real spending declining at
 * rate g, the present value of that stream is S / (w + g) instead. So the
 * declining-spending path divides by (withdrawalRatePct +
 * SPENDING_SMILE_DECLINE_PCT), not by withdrawalRatePct alone. This is a
 * labeled assumption, never a hidden dial: the UI always shows both the flat
 * and declining numbers side by side.
 */
export const SPENDING_SMILE_DECLINE_PCT = 1;

/**
 * SSA reduction/delayed-credit factors for a full retirement age (FRA) of 67.
 *
 * Real SSA rules: claiming at 62 (60 months early) reduces the primary
 * insurance amount by 30% (36 months at 5/9 of 1% per month + 24 months at
 * 5/12 of 1% per month = 20% + 10% = 30%) -> 0.70. Claiming at 70 earns
 * delayed retirement credits of 8% per year for 3 years after FRA -> 1.24.
 * FRA itself -> 1.00. Intermediate claim ages are linearly interpolated
 * between these anchors; ages outside 62-70 clamp to the edge factor.
 */
const CLAIM_FACTORS = [
  [62, 0.7],
  [67, 1.0],
  [70, 1.24],
];

function claimFactor(ssClaimAge) {
  if (!Number.isFinite(ssClaimAge)) return 1;
  if (ssClaimAge <= CLAIM_FACTORS[0][0]) return CLAIM_FACTORS[0][1];
  const last = CLAIM_FACTORS[CLAIM_FACTORS.length - 1];
  if (ssClaimAge >= last[0]) return last[1];
  for (let i = 1; i < CLAIM_FACTORS.length; i += 1) {
    const [loAge, loFactor] = CLAIM_FACTORS[i - 1];
    const [hiAge, hiFactor] = CLAIM_FACTORS[i];
    if (ssClaimAge <= hiAge) {
      const t = (ssClaimAge - loAge) / (hiAge - loAge);
      return loFactor + t * (hiFactor - loFactor);
    }
  }
  return 1;
}

function nullResult() {
  return {
    yearsToRetirement: null,
    retirementYear: null,
    annualSpendAtRetirement: null,
    healthcareAnnualAtRetirement: null,
    post65At65: null,
    ssClaimFactor: null,
    ssAnnualAtRetirement: null,
    rentalAnnualAtRetirement: null,
    portfolioNeedAnnual: null,
    requiredNestEgg: null,
    spendingSmile: null,
    levers: { retireLater2: null, spendLess200: null, ssAt70: null },
  };
}

function clampNonNegative(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function computeCore({
  monthlyExpenses,
  withdrawalRatePct,
  currentAge,
  retirementAge,
  planningAge = 95,
  generalInflationPct = 3,
  healthcareInflationPct = 5,
  includeHealthcare = true,
  pre65HealthcareAnnual = 18000,
  post65HealthcareAnnual = 6500,
  monthlySSBenefit = 0,
  ssClaimAge = 67,
  ssHaircut = false,
  monthlyRentalCashFlow = 0,
  spendingSmile = false,
}) {
  const yearsToRetirement = Math.max(0, retirementAge - currentAge);
  const retirementYear = new Date().getFullYear() + yearsToRetirement;
  const generalGrowth = (1 + generalInflationPct / 100) ** yearsToRetirement;
  const healthcareGrowth = (1 + healthcareInflationPct / 100) ** yearsToRetirement;

  const annualSpendAtRetirement = clampNonNegative(monthlyExpenses) * 12 * generalGrowth;

  // Two-phase healthcare: the pre-65 bridge (ACA/COBRA) costs far more than
  // post-65 Medicare, and healthcare inflates faster than general spending
  // (HealthView Services) — hence its own inflation rate.
  let healthcareAnnualAtRetirement = 0;
  if (includeHealthcare) {
    const baseAnnual = retirementAge < 65 ? pre65HealthcareAnnual : post65HealthcareAnnual;
    healthcareAnnualAtRetirement = clampNonNegative(baseAnnual) * healthcareGrowth;
  }
  // Informational: what the post-65 annual cost looks like at age 65 in
  // nominal dollars, so the Medicare-phase line reads as a concrete figure.
  const post65At65 =
    clampNonNegative(post65HealthcareAnnual) * (1 + healthcareInflationPct / 100) ** Math.max(0, 65 - currentAge);

  // Social Security benefit is assumed to keep pace with general inflation
  // (SSA COLA), so the today's-dollars benefit is grown at general inflation
  // to retirement-year dollars just like spending.
  const factor = claimFactor(ssClaimAge);
  const ssAnnualAtRetirement =
    clampNonNegative(monthlySSBenefit) * 12 * factor * (ssHaircut ? 0.75 : 1) * generalGrowth;

  const rentalAnnualAtRetirement = clampNonNegative(monthlyRentalCashFlow) * 12 * generalGrowth;

  const portfolioNeedAnnual = Math.max(
    0,
    annualSpendAtRetirement + healthcareAnnualAtRetirement - ssAnnualAtRetirement - rentalAnnualAtRetirement,
  );
  // Spending smile: a declining real-spending stream has present value
  // S / (w + g), so the effective divisor grows by the smile decline rate.
  const effectiveWithdrawalRate =
    (withdrawalRatePct + (spendingSmile ? SPENDING_SMILE_DECLINE_PCT : 0)) / 100;
  const requiredNestEgg = portfolioNeedAnnual / effectiveWithdrawalRate;

  return {
    yearsToRetirement,
    retirementYear,
    annualSpendAtRetirement,
    healthcareAnnualAtRetirement,
    post65At65,
    ssClaimFactor: factor,
    ssAnnualAtRetirement,
    rentalAnnualAtRetirement,
    portfolioNeedAnnual,
    requiredNestEgg,
    spendingSmile,
  };
}

export default function computeRetirementTarget(input) {
  const {
    withdrawalRatePct,
    currentAge,
    retirementAge,
  } = input ?? {};

  // A withdrawal rate of zero (or an invalid age pair) means the 4%-rule
  // division is undefined — return nulls rather than Infinity or NaN so the
  // UI never renders a fabricated number.
  if (
    !Number.isFinite(withdrawalRatePct) ||
    withdrawalRatePct <= 0 ||
    !Number.isFinite(currentAge) ||
    !Number.isFinite(retirementAge)
  ) {
    return nullResult();
  }

  const base = computeCore(input);
  if (!Number.isFinite(base.requiredNestEgg)) return nullResult();

  // "What can I do about it" lever deltas. Each recomputes the nest egg with
  // one assumption changed; negative = the lever lowers the required number.
  const retireLater2 = computeCore({ ...input, retirementAge: input.retirementAge + 2 });
  const spendLess200 = computeCore({ ...input, monthlyExpenses: (input.monthlyExpenses ?? 0) - 200 });
  const ssAt70 = computeCore({ ...input, ssClaimAge: 70 });

  return {
    ...base,
    levers: {
      retireLater2: retireLater2.requiredNestEgg - base.requiredNestEgg,
      spendLess200: spendLess200.requiredNestEgg - base.requiredNestEgg,
      ssAt70: input.ssClaimAge >= 70 ? 0 : ssAt70.requiredNestEgg - base.requiredNestEgg,
    },
  };
}
