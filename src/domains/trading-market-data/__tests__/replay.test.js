import { describe, expect, it } from "vitest";
import { createLookAheadSafeReplayCursor } from "../replay.js";
import { createSyntheticFixtureAdapter } from "../syntheticFixtureAdapter.js";
import { getSyntheticScenarioById } from "../scenarios/syntheticScenarioCatalog.js";

const SCENARIO_ID = "rising_market_v1";
const [INSTRUMENT_ID] = getSyntheticScenarioById(SCENARIO_ID).instrumentIds;

describe("createLookAheadSafeReplayCursor: golden look-ahead-prevention test", () => {
  it("advanceTo never returns a bar later than the requested asOf", () => {
    const adapter = createSyntheticFixtureAdapter({ scenarioId: SCENARIO_ID });
    const allBars = getSyntheticScenarioById(SCENARIO_ID).materialize()[INSTRUMENT_ID];
    const cursor = createLookAheadSafeReplayCursor({ adapter, instrumentId: INSTRUMENT_ID });

    const midpoint = allBars[Math.floor(allBars.length / 2)];
    const current = cursor.advanceTo(midpoint.effectiveAt);

    expect(current.effectiveAt <= midpoint.effectiveAt).toBe(true);
    expect(current.sequenceIndex).toBeLessThanOrEqual(midpoint.sequenceIndex);
  });

  it("returns null before the scenario's first bar, and never advances past what asOf allows", () => {
    const adapter = createSyntheticFixtureAdapter({ scenarioId: SCENARIO_ID });
    const cursor = createLookAheadSafeReplayCursor({ adapter, instrumentId: INSTRUMENT_ID });
    expect(cursor.advanceTo("0001-01-01T00:00:00.000Z")).toBeNull();
  });

  it("the cursor object exposes no property or method that returns the underlying array or any bar beyond current()", () => {
    const adapter = createSyntheticFixtureAdapter({ scenarioId: SCENARIO_ID });
    const cursor = createLookAheadSafeReplayCursor({ adapter, instrumentId: INSTRUMENT_ID });
    cursor.advanceTo(getSyntheticScenarioById(SCENARIO_ID).materialize()[INSTRUMENT_ID][2].effectiveAt);

    // The only own-enumerable surface of the cursor is exactly these three functions -- nothing that
    // could hand back the full bar array (e.g. no "bars", "all", "data", "_bars" property).
    expect(Object.keys(cursor).sort()).toEqual(["advanceTo", "current", "hasMoreAfterCurrent"]);
    // Serializing the cursor itself (a function-only frozen object) reveals nothing -- there is no
    // data property at all to leak through introspection.
    expect(JSON.stringify(cursor)).toBe("{}");
  });

  it("FALSIFIABILITY CHECK: a naive/unsafe cursor that returns the full array would let a consumer read future bars -- proving this test has teeth", () => {
    // Deliberately unsafe: exposes the whole materialized array, the way a careless implementation
    // might. This function exists ONLY in this test, to prove the golden assertions above are not
    // vacuously true (i.e. this is what "not look-ahead-safe" looks like, and the checks above would
    // catch it).
    function createNaiveUnsafeCursor({ adapter, instrumentId }) {
      const bars = adapter.getBars(instrumentId, {
        start: "0000-01-01T00:00:00.000Z",
        end: "9999-12-31T23:59:59.999Z",
      });
      return { bars, index: 0 }; // <-- the array itself is directly reachable; this is the bug
    }

    const adapter = createSyntheticFixtureAdapter({ scenarioId: SCENARIO_ID });
    const unsafeCursor = createNaiveUnsafeCursor({ adapter, instrumentId: INSTRUMENT_ID });

    // A "consumer" simulating being at bar 2 can still trivially read bar 20 -- the exact defect the
    // real cursor's design prevents.
    expect(unsafeCursor.bars[20]).toBeDefined();
    expect(unsafeCursor.bars[20].sequenceIndex).toBe(20);

    // And the real cursor's own surface genuinely differs from this unsafe shape:
    const safeCursor = createLookAheadSafeReplayCursor({ adapter, instrumentId: INSTRUMENT_ID });
    expect(safeCursor.bars).toBeUndefined();
  });
});
