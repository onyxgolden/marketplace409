import { describe, expect, it } from "vitest";

import { AccountingPeriod } from "@/domains/ledger";

describe("Ledger public exports", () => {
  it("exports AccountingPeriod from the public ledger API", () => {
    expect(AccountingPeriod).toBeDefined();
    expect(typeof AccountingPeriod).toBe("function");
  });
});
