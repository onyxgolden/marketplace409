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

  test("is immutable", () => {
    const posting = new Posting({
      id: "P1",
      accountId: "Cash",
      amount: new Money(100),
      direction: LedgerDirection.DEBIT,
    });

    expect(Object.isFrozen(posting)).toBe(true);
  });

  test("serializes to JSON", () => {
    const posting = new Posting({
      id: "P1",
      accountId: "Cash",
      amount: new Money(100),
      direction: LedgerDirection.DEBIT,
      description: "Opening balance",
      metadata: { source: "test" },
    });

    expect(posting.toJSON()).toEqual({
      id: "P1",
      accountId: "Cash",
      amount: { amount: 100, currency: "USD" },
      direction: LedgerDirection.DEBIT,
      description: "Opening balance",
      metadata: { source: "test" },
    });
  });

  test("identifies debit and credit postings", () => {
    const debit = new Posting({
      id: "D1",
      accountId: "Cash",
      amount: new Money(100),
      direction: LedgerDirection.DEBIT,
    });

    const credit = new Posting({
      id: "C1",
      accountId: "Revenue",
      amount: new Money(100),
      direction: LedgerDirection.CREDIT,
    });

    expect(debit.isDebit()).toBe(true);
    expect(debit.isCredit()).toBe(false);

    expect(credit.isDebit()).toBe(false);
    expect(credit.isCredit()).toBe(true);
  });
});
