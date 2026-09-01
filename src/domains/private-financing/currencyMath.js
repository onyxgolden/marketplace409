// Cent-safe primitives for the Private Financing calculation engine. Builds on, rather than replaces,
// src/platform/value-objects/Money.js -- Money is a per-operation rounding wrapper; what's genuinely new
// here is rounding a single fractional-cents value (produced by a day-count interest calculation) down
// to the one integer-cent value everything else in the engine is required to use.

export function assertIntegerCents(value, label = "amount") {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer number of cents.`);
  }
}

// The one place non-integer arithmetic is allowed to produce a value -- every function that computes a
// "final" monetary result (interest accrual, in particular) must pass its raw output through this before
// returning or storing it. Half-up rounding, matching Money.js's own Math.round convention.
export function roundToNearestCent(fractionalCents) {
  if (typeof fractionalCents !== "number" || !Number.isFinite(fractionalCents)) {
    throw new Error("fractionalCents must be a finite number.");
  }
  return Math.round(fractionalCents);
}

// Splits totalCents across weights[] proportionally, guaranteeing the output sums back to EXACTLY
// totalCents (largest-remainder method) -- no cent is ever lost or manufactured by rounding, unlike a
// naive `Math.floor(total * weight)` per entry. Used by paymentAllocation.js's "proportional_extra"
// policy. A weight of 0 always receives 0, never a stray rounding cent. Throws on a negative weight or an
// all-zero weights array (nothing to allocate proportionally to).
export function allocateCentsByRatio(totalCents, weights) {
  if (!Number.isInteger(totalCents) || totalCents < 0) throw new Error("totalCents must be a non-negative integer.");
  if (!Array.isArray(weights) || weights.length === 0) throw new Error("weights must be a non-empty array.");
  for (const weight of weights) {
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) {
      throw new Error("every weight must be a non-negative finite number.");
    }
  }
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) throw new Error("weights must sum to a positive number.");

  const rawShares = weights.map((weight) => (totalCents * weight) / totalWeight);
  const flooredShares = rawShares.map(Math.floor);
  let remainder = totalCents - flooredShares.reduce((sum, share) => sum + share, 0);

  // Largest-remainder method: the entries with the biggest fractional part lost to flooring receive the
  // leftover cents first, one each, until the remainder is exhausted -- deterministic given a stable input
  // order (ties broken by original index).
  const order = rawShares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const result = [...flooredShares];
  for (let i = 0; i < order.length && remainder > 0; i += 1) {
    result[order[i].index] += 1;
    remainder -= 1;
  }
  return Object.freeze(result);
}
