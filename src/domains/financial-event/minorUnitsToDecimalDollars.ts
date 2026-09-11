// The single place a Transaction's amountCents (signed integer minor units -- see
// transaction.types.ts) crosses into a FinancialEvent's amount (signed decimal dollars -- see
// financial-event.types.ts). FinancialEventImportService.toFinancialEvent() is the only caller;
// this exists as its own named, directly-tested function rather than an inline `/ 100` specifically
// so the conversion boundary is explicit, greppable, and cannot silently happen twice or zero times
// as this pipeline evolves.
//
// Built on integer string arithmetic, not floating-point division, so cent precision is exact by
// construction rather than by luck: `absoluteMinorUnits / 100` as a plain JS division can be exact
// for the specific two-decimal-place values money needs, but building the decimal string from
// Math.trunc/% integer operations first, then parsing it once, guarantees there is no intermediate
// floating-point rounding step for large or awkward inputs.
export function minorUnitsToDecimalDollars(minorUnits: number): number {
  if (!Number.isInteger(minorUnits)) {
    throw new Error(
      `minorUnitsToDecimalDollars requires an integer number of minor units; received ${minorUnits}.`,
    );
  }

  const sign = minorUnits < 0 ? "-" : "";
  const absoluteMinorUnits = Math.abs(minorUnits);
  const wholeDollars = Math.trunc(absoluteMinorUnits / 100);
  const remainderCents = absoluteMinorUnits % 100;
  const decimalString = `${sign}${wholeDollars}.${String(remainderCents).padStart(2, "0")}`;

  return Number(decimalString);
}
