// Tenant overpayment credits — pure domain math for the offline-payment credit path.
//
// The database RPCs (record_offline_rental_payment, apply_rental_tenant_credit) are the
// authority and re-enforce every rule below; these functions exist so the UI and API can
// validate, preview, and explain the split with the exact same arithmetic the database
// will apply — no invented numbers, no divergent rounding.
//
// Money model (mirrors migration 20260925120000_rental_tenant_credits):
// - A payment records the FULL amount actually received against the selected charge.
// - appliedCents (min(amount, charge remaining)) moves the charge's paid balance.
// - creditCents (the excess) becomes an open credit on the tenant's lease.
// - Applying a credit to a charge is balance-neutral in the ledger read model — the
//   money was already counted in the payment — but it reduces the charge's remaining
//   balance so owner/tenant "amount due" views stay correct.

const isCents = (value) => Number.isSafeInteger(value) && value >= 0;

export function isOverpayment(amountCents, chargeRemainingCents) {
  if (!isCents(amountCents) || !isCents(chargeRemainingCents)) return false;
  return amountCents > chargeRemainingCents;
}

// Split an offline payment against a charge's remaining balance. Throws on invalid
// input; never invents amounts.
export function splitOfflineOverpayment(amountCents, chargeRemainingCents) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error("A positive payment amount is required.");
  }
  if (!isCents(chargeRemainingCents)) {
    throw new Error("The charge remaining balance must be a nonnegative whole number of cents.");
  }
  const appliedCents = Math.min(amountCents, chargeRemainingCents);
  const creditCents = amountCents - appliedCents;
  return { appliedCents, creditCents, isOverpayment: creditCents > 0 };
}

// Apply (part of) an open credit to a charge's remaining balance. The applied amount is
// clamped to what both sides can absorb — the caller decides how to surface a shortfall.
export function applyCreditToCharge({ creditRemainingCents, chargeRemainingCents, requestedCents }) {
  for (const [name, value] of Object.entries({ creditRemainingCents, chargeRemainingCents, requestedCents })) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a nonnegative whole number of cents.`);
    }
  }
  if (requestedCents === 0) throw new Error("A positive credit application amount is required.");
  const appliedCents = Math.min(requestedCents, creditRemainingCents, chargeRemainingCents);
  if (appliedCents <= 0) throw new Error("There is nothing to apply this credit to.");
  return {
    appliedCents,
    newCreditRemainingCents: creditRemainingCents - appliedCents,
    newChargeRemainingCents: chargeRemainingCents - appliedCents,
    creditFullyApplied: creditRemainingCents - appliedCents === 0,
    chargeFullyPaid: chargeRemainingCents - appliedCents === 0,
  };
}

// FIFO ordering for auto-application: oldest credit first, id as a stable tiebreak.
export function sortCreditsForAutoApply(credits = []) {
  return [...credits].sort((a, b) => {
    const byDate = String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    if (byDate !== 0) return byDate;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}
