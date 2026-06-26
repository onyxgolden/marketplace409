import { describe, expect, test } from "vitest";
import { Account } from "../Account";
import { AccountClassification } from "../AccountClassification";
import { AccountType } from "../AccountType";

describe("Account", () => {
  test("creates an immutable account", () => {
    const account = new Account({
      id: "1000",
      name: "Cash",
      type: AccountType.ASSET,
    });

    expect(account.id).toBe("1000");
    expect(account.name).toBe("Cash");
    expect(account.type).toBe(AccountType.ASSET);
    expect(account.classification).toBe(null);
    expect(Object.isFrozen(account)).toBe(true);
  });
});

test("creates an account with an optional classification", () => {
  const account = new Account({
    id: "1000",
    name: "Cash",
    type: AccountType.ASSET,
    classification: AccountClassification.CASH,
  });

  expect(account.classification).toBe(AccountClassification.CASH);
  expect(account.hasClassification(AccountClassification.CASH)).toBe(true);
  expect(account.hasClassification(AccountClassification.CURRENT_ASSET)).toBe(
    false,
  );
});

test("requires an id", () => {
  expect(
    () =>
      new Account({
        name: "Cash",
        type: AccountType.ASSET,
      }),
  ).toThrow("Account id is required");
});

test("requires a name", () => {
  expect(
    () =>
      new Account({
        id: "1000",
        type: AccountType.ASSET,
      }),
  ).toThrow("Account name is required");
});

test("requires a valid account type", () => {
  expect(
    () =>
      new Account({
        id: "1000",
        name: "Cash",
        type: "invalid",
      }),
  ).toThrow("Account type is invalid");
});

test("requires a valid account classification when provided", () => {
  expect(
    () =>
      new Account({
        id: "1000",
        name: "Cash",
        type: AccountType.ASSET,
        classification: "invalid",
      }),
  ).toThrow("Account classification is invalid");
});

test("identifies debit-normal accounts", () => {
  const asset = new Account({
    id: "1000",
    name: "Cash",
    type: AccountType.ASSET,
  });

  const expense = new Account({
    id: "5000",
    name: "Repairs",
    type: AccountType.EXPENSE,
  });

  expect(asset.isDebitNormal()).toBe(true);
  expect(expense.isDebitNormal()).toBe(true);
});

test("identifies credit-normal accounts", () => {
  const liability = new Account({
    id: "2000",
    name: "Loan Payable",
    type: AccountType.LIABILITY,
  });

  const equity = new Account({
    id: "3000",
    name: "Owner Equity",
    type: AccountType.EQUITY,
  });

  const revenue = new Account({
    id: "4000",
    name: "Rental Revenue",
    type: AccountType.REVENUE,
  });

  expect(liability.isCreditNormal()).toBe(true);
  expect(equity.isCreditNormal()).toBe(true);
  expect(revenue.isCreditNormal()).toBe(true);
});
