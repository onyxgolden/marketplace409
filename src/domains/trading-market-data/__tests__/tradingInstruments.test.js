import { describe, expect, it } from "vitest";
import { SYNTHETIC_INSTRUMENTS, getSyntheticInstrumentById } from "../tradingInstruments.js";
import { isPlausiblyFictional } from "../syntheticNamespace.js";

describe("synthetic instrument catalog", () => {
  it("every instrument passes the plausibly-fictional gate", () => {
    for (const instrument of SYNTHETIC_INSTRUMENTS) {
      expect(isPlausiblyFictional(instrument), `instrument ${instrument.id} failed the gate`).toBe(true);
    }
  });

  it("every instrument has data_origin='synthetic'", () => {
    for (const instrument of SYNTHETIC_INSTRUMENTS) {
      expect(instrument.dataOrigin).toBe("synthetic");
    }
  });

  it("instrument ids are stable and unique", () => {
    const ids = SYNTHETIC_INSTRUMENTS.map((instrument) => instrument.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Re-import-independent stability: the id is derived deterministically from the symbol, not a
    // random UUID, so it cannot change between process runs.
    expect(SYNTHETIC_INSTRUMENTS[0].id).toBe("trading_instrument_syn0001");
  });

  it("getSyntheticInstrumentById finds a real entry and returns null for an unknown id", () => {
    const first = SYNTHETIC_INSTRUMENTS[0];
    expect(getSyntheticInstrumentById(first.id)).toEqual(first);
    expect(getSyntheticInstrumentById("trading_instrument_does_not_exist")).toBeNull();
  });

  it("catalog rows are frozen (cannot be mutated after creation)", () => {
    "use strict";
    const instrument = SYNTHETIC_INSTRUMENTS[0];
    expect(() => {
      instrument.name = "Something Else";
    }).toThrow();
  });
});
