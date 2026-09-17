// TR-1F-A's only concrete implementation of the MarketDataAdapter contract (marketDataAdapter.types.ts).
// One adapter instance is bound to exactly one scenario (mirroring how a real connection adapter is
// bound to one external account/data source) -- a consumer wanting a different scenario's data creates
// a different adapter instance, rather than one adapter juggling ambiguous per-instrument scenario
// membership.
//
// "No migration" reasoning for this phase: this adapter, the security master (tradingInstruments.js),
// and the scenario catalog are all pure, in-memory, code-shipped data. Nothing here is per-user,
// per-workspace, or mutable -- it is a fixed, versioned, reviewable catalog, structurally identical in
// spirit to how src/domains/knowledge/category-map.ts ships a fixed taxonomy as code, not a table.
// TR-2F is where genuinely per-user, mutable, multi-tenant state (accounts, orders) first appears --
// that is where a real migration with RLS becomes necessary, not here.

import { getSyntheticScenarioById } from "./scenarios/syntheticScenarioCatalog.js";

const BASE_CAPABILITIES = Object.freeze([
  "supports_quotes",
  "supports_bars",
  "supports_corporate_actions",
  "supports_adjusted_prices",
  "supports_end_of_day",
  // Deliberately NOT supports_real_time / supports_delayed: this adapter is neither of those --
  // it's a fixed, deterministic fixture. There is intentionally no "supports_synthetic" capability
  // key at all (see marketDataCapabilities.types.ts) -- a consumer should never need to branch on
  // whether an adapter is synthetic; see __tests__/adapterProviderNeutrality.test.js.
]);

export function createSyntheticFixtureAdapter({ scenarioId }) {
  const scenario = getSyntheticScenarioById(scenarioId);
  if (!scenario) {
    throw new Error(`Unknown synthetic scenario id "${scenarioId}".`);
  }
  const materializedBarsByInstrumentId = scenario.materialize();
  const adapterId = `synthetic_fixture_adapter_${scenarioId}`;
  const capabilities = Object.freeze({ adapterId, capabilities: BASE_CAPABILITIES });

  function requireBars(instrumentId) {
    const bars = materializedBarsByInstrumentId[instrumentId];
    if (!bars) {
      throw new Error(`Instrument "${instrumentId}" is not part of scenario "${scenarioId}".`);
    }
    return bars;
  }

  return Object.freeze({
    adapterId,
    getCapabilities: () => capabilities,

    getQuote(instrumentId, asOf) {
      const bars = requireBars(instrumentId);
      let latest = null;
      for (const bar of bars) {
        if (bar.effectiveAt <= asOf) {
          latest = bar;
        } else {
          break; // bars are always in ascending effectiveAt order -- safe to stop early
        }
      }
      if (!latest) return null;
      return Object.freeze({
        instrumentId,
        asOf,
        bidCents: latest.bidCents,
        askCents: latest.askCents,
        lastCents: latest.unadjustedCloseCents,
      });
    },

    getBars(instrumentId, range) {
      const bars = requireBars(instrumentId);
      return Object.freeze(
        bars.filter((bar) => bar.effectiveAt >= range.start && bar.effectiveAt <= range.end),
      );
    },

    getCorporateActions(instrumentId) {
      requireBars(instrumentId); // validates membership; throws the same way getBars/getQuote would
      return scenario.corporateActionsByInstrumentId[instrumentId] || Object.freeze([]);
    },
  });
}
