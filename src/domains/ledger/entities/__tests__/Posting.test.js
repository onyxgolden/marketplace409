import { describe, test, expect } from "vitest";

import { Money } from "../../../../platform";
import { Posting } from "../Posting";
import { LedgerDirection } from "../../value-objects";

describe("Posting", () => {
  test("creates a valid debit posting", () => {
    const posting = new Posting({
      id: "P1",
      accountId: "Cash",
      amount: new Money(100),
      direction: LedgerDirection.DEBIT,
    });

    expect(posting.id).toBe("P1");
    expect(posting.accountId).toBe("Cash");
    expect(posting.amount.amount).toBe(100);
    expect(posting.isDebit()).toBe(true);
    expect(posting.isCredit()).toBe(false);
  });
});
