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
