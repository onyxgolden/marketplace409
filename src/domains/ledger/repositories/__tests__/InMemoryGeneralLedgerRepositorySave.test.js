import { describe, expect, test } from "vitest";

import { GeneralLedger } from "../../entities/GeneralLedger";
import { InMemoryGeneralLedgerRepository } from "../InMemoryGeneralLedgerRepository";

describe("InMemoryGeneralLedgerRepository save behavior", () => {
  test("returns the same ledger that was saved", () => {
    const repository = new InMemoryGeneralLedgerRepository();

    const ledger = GeneralLedger.create();

    repository.save(ledger);

    const loadedLedger = repository.load();

    expect(loadedLedger).toBe(ledger);
  });
});
