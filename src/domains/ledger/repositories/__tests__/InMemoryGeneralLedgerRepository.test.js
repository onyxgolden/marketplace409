import { describe, expect, test } from "vitest";

import { GeneralLedger } from "../../entities/GeneralLedger";
import { InMemoryGeneralLedgerRepository } from "../InMemoryGeneralLedgerRepository";

describe("InMemoryGeneralLedgerRepository", () => {
  test("loads an empty ledger by default", () => {
    const repository = new InMemoryGeneralLedgerRepository();

    const ledger = repository.load();

    expect(ledger).toBeInstanceOf(GeneralLedger);
    expect(ledger.isEmpty()).toBe(true);
  });
});
