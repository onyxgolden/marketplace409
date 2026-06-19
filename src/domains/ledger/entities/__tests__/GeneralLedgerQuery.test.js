import { describe, expect, test } from "vitest";

import { GeneralLedger } from "../GeneralLedger";

describe("GeneralLedger query behavior", () => {
  test("exposes an entries array", () => {
    const ledger = new GeneralLedger();

    expect(Array.isArray(ledger.entries)).toBe(true);
  });

  test("returns a defensive copy of entries", () => {
    const ledger = new GeneralLedger();

    const entries = ledger.entries;

    expect(entries).not.toBe(ledger.entries);
    expect(entries).toEqual(ledger.entries);
  });
});
