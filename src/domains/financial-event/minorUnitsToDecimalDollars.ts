// The single place a Transaction's amountCents (signed integer minor units -- see
// transaction.types.ts) crosses into a FinancialEvent's amount (signed decimal dollars -- see
// financial-event.types.ts). FinancialEventImportService.toFinancialEvent() is the only caller;
// this exists as its own named, directly-tested function rather than an inline `/ 100` specifically
// so the conversion boundary is explicit, greppable, and cannot silently happen twice or zero times
// as this pipeline evolves.
//
// ACCURACY OF THE GUARANTEE THIS MAKES (revised after review -- the earlier wording overclaimed):
// JavaScript's `Number` does NOT provide mathematically exact decimal representation in general --
// it is an IEEE-754 double, and most decimal fractions (including many two-decimal-place dollar
// amounts) have no exact binary representation. What this function actually guarantees is narrower
// and specific to this application's real numeric contract: for any SAFE INTEGER minor-unit input
// (see the Number.isSafeInteger check below -- real transaction amounts are always many orders of
// magnitude smaller than that boundary), the decimal STRING this function builds is constructed from
// exact integer arithmetic (Math.trunc/% on the safe-integer input, never floating-point division),
// so the string itself is exact to the cent by construction. Number(thatString) then produces the
// double closest to that exact decimal value -- and because of how IEEE-754 double-to-string and
// string-to-double conversion round-trip (per the ECMAScript spec's shortest-round-trip guarantee),
// serializing that double back to a string (directly, via .toFixed(2), or via whatever this app's
// Supabase client/JSON serialization does before it reaches the numeric column) reliably reproduces
// the same two-decimal-place string again. That round-trip property -- not "the double IS the exact
// rational value" -- is the actual guarantee: cent-preserving conversion and serialization for safe
// integer minor-unit inputs, which is exactly what this application's money handling needs and
// nothing stronger is claimed.
//
// Evaluated and rejected: returning a decimal STRING instead of a number, which would sidestep even
// needing to reason about double round-tripping. Rejected for this fix specifically because
// ResolvedFinancialEventInput.amount, FinancialEvent.amount, SupabaseFinancialEventRepository, and
// buildFinancialForgePerformance's toCents() are all typed and written throughout this codebase as
// `number`, not `string | number` -- changing that contract is a real, defensible option for this
// domain's money representation in general, but doing so HERE would expand this bounded repair into
// a cross-cutting type-contract change touching the factory, repository, and every read model, which
// is explicitly out of this fix's scope. If money-as-string ever becomes this domain's chosen
// representation, that should be its own reviewed change, not a side effect of this repair.
export function minorUnitsToDecimalDollars(minorUnits: number): number {
  if (Number.isNaN(minorUnits)) {
    throw new Error("minorUnitsToDecimalDollars requires a finite number; received NaN.");
  }
  if (!Number.isFinite(minorUnits)) {
    throw new Error(
      `minorUnitsToDecimalDollars requires a finite number; received ${minorUnits === Infinity ? "Infinity" : "-Infinity"}.`,
    );
  }
  if (!Number.isInteger(minorUnits)) {
    throw new Error(
      `minorUnitsToDecimalDollars requires an integer number of minor units (no fractional minor units exist); received ${minorUnits}.`,
    );
  }
  if (!Number.isSafeInteger(minorUnits)) {
    throw new Error(
      `minorUnitsToDecimalDollars requires a safe integer (magnitude <= ${Number.MAX_SAFE_INTEGER}) -- beyond that, the input itself may already have lost precision as a JS number before reaching this function; received ${minorUnits}.`,
    );
  }

  const sign = minorUnits < 0 ? "-" : "";
  const absoluteMinorUnits = Math.abs(minorUnits);
  const wholeDollars = Math.trunc(absoluteMinorUnits / 100);
  const remainderCents = absoluteMinorUnits % 100;
  const decimalString = `${sign}${wholeDollars}.${String(remainderCents).padStart(2, "0")}`;

  return Number(decimalString);
}

// The current Transaction-to-FinancialEvent canonical amount contract, recorded as structural,
// immutable metadata (FinancialEvent.metadata.amountUnitVersion) on every event
// FinancialEventImportService.toFinancialEvent() creates -- not just documentation. This is what
// lets the repair migration (and any future repair) distinguish "correctly-scaled event written by
// the current, fixed import code" from "event written before this version existed" using the data
// itself, rather than a time-window assumption about when a deploy happened. Provider-neutral by
// design: PlaidTransactionMapper and StripeFinancialConnectionsTransactionMapper never see or choose
// this value -- only the shared import service, at the one place the Transaction-to-FinancialEvent
// boundary is actually crossed, stamps it. Bump this (and add a new migration) if this contract ever
// changes again.
export const CANONICAL_TRANSACTION_AMOUNT_UNIT_VERSION = 1;
