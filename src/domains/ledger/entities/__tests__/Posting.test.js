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

  test("requires an id", () => {
    expect(() => {
      new Posting({
        accountId: "Cash",
        amount: new Money(100),
        direction: LedgerDirection.DEBIT,
      });
    }).toThrow("Posting requires an id");
  });
  test("requires an accountId", () => {
    expect(() => {
      new Posting({
        id: "P1",
        amount: new Money(100),
        direction: LedgerDirection.DEBIT,
      });
    }).toThrow("Posting requires an accountId");
  });
    test("requires a Money object", () => {
    expect(() => {
      new Posting({
        id: "P1",
        accountId: "Cash",
        amount: 100,
        direction: LedgerDirection.DEBIT,
      });
    }).toThrow("Posting amount must be a Money object");
  });
    test("requires a valid ledger direction", () => {
    expect(() => {
      new Posting({
        id: "P1",
        accountId: "Cash",
        amount: new Money(100),
        direction: "INVALID",
      });
    }).toThrow("Posting direction must be DEBIT or CREDIT");
  });
});
