// Allocation picker for the retirement-number card. Selecting a profile sets the
// withdrawal-rate assumption — every pro tool (Fidelity, Schwab, Empower) asks
// investing STYLE first and derives the expected return, rather than letting
// users type in a yield they hope to chase.
//
// IMPORTANT: these return bands are long-run HISTORICAL averages (roughly a
// century of US stock/bond data). History is not a promise — future returns can
// be worse, especially over a single 30-year retirement. These are starting
// points for an assumption, not a recommendation.

export const ALLOCATION_PROFILES = [
  {
    id: "conservative",
    label: "Conservative",
    mix: "~20% stocks / 80% bonds",
    historicalBand: "~4–6% nominal",
    withdrawalRatePct: 3.5,
    stockPct: 0.2,
  },
  {
    id: "balanced",
    label: "Balanced",
    mix: "~60% stocks / 40% bonds",
    historicalBand: "~6–8% nominal",
    withdrawalRatePct: 4.0,
    stockPct: 0.6,
  },
  {
    id: "growth",
    label: "Growth",
    mix: "~90% stocks / 10% bonds",
    historicalBand: "~8–10% nominal",
    withdrawalRatePct: 4.5,
    stockPct: 0.9,
  },
];

export function allocationProfileById(id) {
  return ALLOCATION_PROFILES.find((profile) => profile.id === id) ?? null;
}
