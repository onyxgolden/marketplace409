// The provider-neutral market-data adapter contract. TR-1F-A implements this once (see
// syntheticFixtureAdapter.js) against synthetic fixtures; a future TR-1A implements the identical
// interface against a real licensed vendor. Every method signature below is deliberately free of any
// concept that only makes sense for synthetic OR licensed data -- see
// __tests__/adapterProviderNeutrality.test.js for the actual proof (a fake consumer written against
// only this interface, run against the synthetic adapter, asserting it never needed to know the data
// was synthetic).
//
// asOf / range parameters are always ISO-8601 timestamp strings, matching effectiveAt on a bar --
// never a bar index or any other internal representation, so a consumer never needs adapter-specific
// knowledge to ask "what did this look like at this moment."

export type MarketDataBar = Readonly<{
  sequenceIndex: number;
  effectiveAt: string;
  receivedAt: string;
  unadjustedCloseCents: number;
  adjustedCloseCents: number;
  bidCents: number;
  askCents: number;
  volumeShares: number;
}>;

export type MarketDataQuote = Readonly<{
  instrumentId: string;
  asOf: string;
  bidCents: number;
  askCents: number;
  lastCents: number;
}>;

export type CorporateAction = Readonly<{
  atBarIndex: number;
  type: "split" | "dividend";
  ratioNumerator?: number;
  ratioDenominator?: number;
  amountCents?: number;
}>;

export interface MarketDataAdapter {
  readonly adapterId: string;
  getCapabilities(): { adapterId: string; capabilities: readonly string[] };
  // Returns the most recent bar at or before `asOf`, reshaped into quote form, or null if the
  // instrument/scenario has no data at or before that timestamp.
  getQuote(instrumentId: string, asOf: string): MarketDataQuote | null;
  // Returns every bar with effectiveAt in [rangeStart, rangeEnd], inclusive, in ascending
  // sequenceIndex order. A caller passing a future rangeEnd never receives bars beyond what the
  // underlying data source has actually produced up to "now" for that source -- see replay.js for
  // the stricter, explicitly look-ahead-safe entry point used by backtest/replay callers.
  getBars(instrumentId: string, range: { start: string; end: string }): readonly MarketDataBar[];
  getCorporateActions(instrumentId: string): readonly CorporateAction[];
}
