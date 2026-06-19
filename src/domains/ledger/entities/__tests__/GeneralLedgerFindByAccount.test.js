import { describe, expect, test } from "vitest";

import { GeneralLedger } from "../GeneralLedger";

describe("GeneralLedger account queries", () => {
  test("returns an empty collection for an unknown account", () => {
    const ledger = new GeneralLedger();

    const entries = ledger.findByAccount("cash");

    expect(entries).toEqual([]);
    expect(Object.isFrozen(entries)).toBe(true);
  });
});
