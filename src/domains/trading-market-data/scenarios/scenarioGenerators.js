// The single, documented, deterministic bar generator every synthetic scenario in this domain is
// built from. No scenario's bars are ever hand-edited to "look right" -- every scenario in
// syntheticScenarioCatalog.js is fully described by the parameters passed to generateScenarioBars()
// below, and those parameters (and the reasoning behind each choice) are what make a scenario
// reviewable and reproducible.
//
// Generation rule (this IS the documented rule referenced throughout this domain and the catalog):
//   1. Start at `startPriceCents`, walk forward one synthetic trading bar (day) at a time.
//   2. Each phase in `phases` applies its own `trendSlopeCentsPerBar` (added every bar) and
//      `volatilityAmplitudeCents` (a seeded-random value in [-amplitude, +amplitude] added every
//      bar) for exactly `barCount` bars, then the next phase begins where the price left off. A
//      single-phase scenario is a plain trend; multiple phases compose into shapes like
//      drawdown-then-recovery.
//   3. Bid/ask are derived from the resulting close via `spreadBps` (basis points of the close),
//      split evenly above and below.
//   4. Volume is `baseVolume(volumeProfile) * (0.5 + random())`, i.e. randomly between 0.5x and 1.5x
//      a profile's base level -- "thin" for partial-fill teaching scenarios, "normal" otherwise,
//      "high" for scenarios that shouldn't exhibit partial fills.
//   5. `effectiveAt` is one synthetic calendar day per bar, starting from a fixed epoch
//      (2026-01-05, an arbitrary but fixed Monday) -- the epoch and cadence are constants, not
//      derived from wall-clock time, so output is stable across runs and across years.
//   6. `receivedAt` is always exactly 60 seconds after `effectiveAt` -- a fixed, deterministic
//      constant chosen specifically so the two fields can never collapse into being
//      interchangeable, without asserting a false claim about real-world feed latency (there is no
//      real feed here to have latency).
//   7. Corporate actions (see applyCorporateActionsAndComputeAdjustedPrices) are folded in last, in
//      ascending `atBarIndex` order, producing `adjustedCloseCents` alongside `unadjustedCloseCents`.
//
// Randomness source: createSeededRandom(seedFromString(seedString)) -- see deterministicRandom.js.
// The SAME seedString always produces the SAME random sequence, hence the same bars, forever.

import { createSeededRandom, seedFromString } from "../deterministicRandom.js";

const SYNTHETIC_EPOCH_MS = Date.UTC(2026, 0, 5);
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const RECEIVED_AT_OFFSET_MS = 60_000;

const VOLUME_PROFILE_BASE = Object.freeze({ thin: 50, normal: 500, high: 5000 });

export function generateScenarioBars({
  seedString,
  phases,
  startPriceCents = 10000,
  spreadBps = 20,
  volumeProfile = "normal",
  corporateActions = [],
}) {
  if (!VOLUME_PROFILE_BASE[volumeProfile]) {
    throw new Error(`Unknown volumeProfile "${volumeProfile}".`);
  }
  const random = createSeededRandom(seedFromString(seedString));
  const bars = [];
  let priceCents = startPriceCents;
  let barIndex = 0;
  const baseVolume = VOLUME_PROFILE_BASE[volumeProfile];

  for (const phase of phases) {
    for (let i = 0; i < phase.barCount; i += 1) {
      priceCents += phase.trendSlopeCentsPerBar;
      const noise = (random() - 0.5) * 2 * phase.volatilityAmplitudeCents;
      priceCents = Math.max(1, Math.round(priceCents + noise));

      const effectiveAt = new Date(SYNTHETIC_EPOCH_MS + barIndex * ONE_DAY_MS).toISOString();
      const receivedAt = new Date(
        SYNTHETIC_EPOCH_MS + barIndex * ONE_DAY_MS + RECEIVED_AT_OFFSET_MS,
      ).toISOString();

      const halfSpreadCents = Math.max(1, Math.round((priceCents * spreadBps) / 10000 / 2));
      const volumeShares = Math.max(1, Math.round(baseVolume * (0.5 + random())));

      bars.push({
        sequenceIndex: barIndex,
        effectiveAt,
        receivedAt,
        unadjustedCloseCents: priceCents,
        adjustedCloseCents: priceCents,
        bidCents: priceCents - halfSpreadCents,
        askCents: priceCents + halfSpreadCents,
        volumeShares,
      });
      barIndex += 1;
    }
  }

  applyCorporateActionsAndComputeAdjustedPrices(bars, corporateActions);
  return bars;
}

// Folds splits and dividends into a bar series that already has adjustedCloseCents ==
// unadjustedCloseCents for every bar (generateScenarioBars' initial state). Processes actions in
// ascending atBarIndex order so multiple actions compound correctly, oldest-first.
export function applyCorporateActionsAndComputeAdjustedPrices(bars, corporateActions) {
  const ordered = [...corporateActions].sort((a, b) => a.atBarIndex - b.atBarIndex);
  for (const action of ordered) {
    if (action.type === "split") {
      const ratio = action.ratioNumerator / action.ratioDenominator;
      for (const bar of bars) {
        if (bar.sequenceIndex >= action.atBarIndex) {
          // From the split forward: this IS the real, post-split price -- unadjusted and adjusted
          // move together, both rescaled.
          bar.unadjustedCloseCents = Math.max(1, Math.round(bar.unadjustedCloseCents / ratio));
          bar.bidCents = Math.max(1, Math.round(bar.bidCents / ratio));
          bar.askCents = Math.max(1, Math.round(bar.askCents / ratio));
          bar.adjustedCloseCents = bar.unadjustedCloseCents;
        } else {
          // Historical bars: unadjusted stays exactly as originally quoted; adjusted is rescaled so
          // the adjusted series has no discontinuity across the split date.
          bar.adjustedCloseCents = Math.max(1, Math.round(bar.adjustedCloseCents / ratio));
        }
      }
    } else if (action.type === "dividend") {
      // Deliberately simple, documented rule: every bar strictly before the dividend has its
      // adjusted price reduced by the flat dividend amount -- an additive total-return
      // approximation, not a claim to replicate real dividend-adjustment methodology. This fixture's
      // only job is to teach "adjusted and unadjusted differ around a dividend," not to be a
      // dollar-accurate corporate-actions engine.
      for (const bar of bars) {
        if (bar.sequenceIndex < action.atBarIndex) {
          bar.adjustedCloseCents = Math.max(1, bar.adjustedCloseCents - action.amountCents);
        }
      }
    } else {
      throw new Error(`Unknown corporate action type: "${action.type}".`);
    }
  }
}
