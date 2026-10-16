/**
 * DSCR (Debt Service Coverage Ratio) illustrative calculator.
 *
 * Pure domain function — no I/O, no persistence, no network.
 * All inputs are user-supplied. Output is an illustration only,
 * never an approval, prequalification, rate quote, or underwriting decision.
 *
 * Formula: DSCR = qualifyingMonthlyRent / monthlyDebtService
 * where monthlyDebtService = P&I + taxes + insurance + HOA/dues
 * (taxes/insurance excluded when escrowInclusive is true to avoid double-counting).
 */

/**
 * @typedef {Object} DscrInputs
 * @property {number} rent - Qualifying monthly rent basis (user-supplied).
 * @property {number} principalAndInterest - Monthly P&I payment.
 * @property {number} taxes - Monthly property taxes (ignored when escrowInclusive).
 * @property {number} insurance - Monthly property insurance incl. flood where applicable (ignored when escrowInclusive).
 * @property {number} hoaDues - Monthly association/HOA dues and other housing expenses.
 * @property {boolean} escrowInclusive - True when P&I already includes taxes and insurance.
 */

/**
 * @typedef {Object} DscrComponent
 * @property {string} label
 * @property {number} amount
 * @property {boolean} included
 */

/**
 * @typedef {Object} DscrResult
 * @property {boolean} ok
 * @property {string|null} error - Field-level or computation error message.
 * @property {number|null} ratio - Computed DSCR, rounded to 3 decimals.
 * @property {DscrComponent[]} components - Denominator components shown to the user.
 * @property {string|null} formula - Human-readable formula applied.
 */

const ILLUSTRATIVE_THRESHOLDS = [1.0, 1.2, 1.25];

const DISCLAIMER =
  "This is an illustration, not an approval, prequalification, rate quote, or underwriting decision. " +
  "Lender definitions and overlays vary; no ratio guarantees approval anywhere.";

function isValidMoney(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Compute the illustrative DSCR.
 * @param {DscrInputs} inputs
 * @returns {DscrResult}
 */
export function computeDscr(inputs) {
  const {
    rent,
    principalAndInterest,
    taxes = 0,
    insurance = 0,
    hoaDues = 0,
    escrowInclusive = false,
  } = inputs ?? {};

  // Field-level validation before any computation.
  const fields = { rent, principalAndInterest, taxes, insurance, hoaDues };
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return {
        ok: false,
        error: `Invalid input: ${name} must be a number.`,
        ratio: null,
        components: [],
        formula: null,
      };
    }
    if (!Number.isFinite(value) || value < 0) {
      return {
        ok: false,
        error: `Invalid input: ${name} must be zero or greater.`,
        ratio: null,
        components: [],
        formula: null,
      };
    }
  }

  const useTaxes = escrowInclusive ? 0 : taxes;
  const useInsurance = escrowInclusive ? 0 : insurance;

  const components = [
    { label: "Principal & interest", amount: principalAndInterest, included: true },
    {
      label: "Property taxes",
      amount: taxes,
      included: !escrowInclusive,
    },
    {
      label: "Property insurance",
      amount: insurance,
      included: !escrowInclusive,
    },
    { label: "HOA / dues / other", amount: hoaDues, included: true },
  ];

  const debtService =
    principalAndInterest + useTaxes + useInsurance + hoaDues;

  if (debtService <= 0) {
    return {
      ok: false,
      error:
        "Cannot compute — monthly debt service is zero. Check your inputs (P&I, taxes, insurance, HOA).",
      ratio: null,
      components,
      formula: null,
    };
  }

  const ratio = Math.round((rent / debtService) * 1000) / 1000;
  const formula = escrowInclusive
    ? "DSCR = rent ÷ (P&I incl. escrow + HOA/dues)"
    : "DSCR = rent ÷ (P&I + taxes + insurance + HOA/dues)";

  return { ok: true, error: null, ratio, components, formula };
}

/**
 * Illustrative threshold comparison labels — never "pass"/"fail".
 * @param {number} ratio
 * @returns {{threshold:number,label:string}[]}
 */
export function illustrativeComparisons(ratio) {
  return ILLUSTRATIVE_THRESHOLDS.map((t) => ({
    threshold: t,
    label:
      ratio >= t
        ? `At or above the ${t.toFixed(2)}x illustrative level`
        : `Below the ${t.toFixed(2)}x illustrative level`,
  }));
}

export { DISCLAIMER, ILLUSTRATIVE_THRESHOLDS };
