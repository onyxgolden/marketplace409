import { describe, expect, test } from "vitest";
import { Account } from "../Account";
import { AccountType } from "../AccountType";
import { ChartOfAccounts } from "../ChartOfAccounts";

describe("ChartOfAccounts", () => {
  test("creates an immutable chart of accounts", () => {
    const cash = new Account({
      id: "1000",
      name: "Cash",
      type: AccountType.ASSET,
    });

    const chart = new ChartOfAccounts([cash]);

    expect(chart.accounts).toEqual([cash]);
    expect(Object.isFrozen(chart)).toBe(true);
    expect(Object.isFrozen(chart.accounts)).toBe(true);
  });

  test("requires accounts to be an array", () => {
    expect(() => new ChartOfAccounts(null)).toThrow("Accounts must be an array");
  });

    test("requires every account to be an Account", () => {
    expect(() => new ChartOfAccounts([{ id: "fake" }])).toThrow(
      "Chart accounts must be Account instances",
    );
  });

  test("prevents duplicate account ids", () => {
    const cash = new Account({
      id: "1000",
      name: "Cash",
      type: AccountType.ASSET,
    });

    const duplicateCash = new Account({
      id: "1000",
      name: "Cash Duplicate",
      type: AccountType.ASSET,
    });

    expect(() => new ChartOfAccounts([cash, duplicateCash])).toThrow(
      "Duplicate account id",
    );
  });

    test("gets an account by id", () => {
    const cash = new Account({
      id: "1000",
      name: "Cash",
      type: AccountType.ASSET,
    });

    const chart = new ChartOfAccounts([cash]);

    expect(chart.getById("1000")).toBe(cash);
  });

    test("throws when account id is not found", () => {
    const chart = new ChartOfAccounts();

    expect(() => chart.getById("9999")).toThrow("Account not found");
  });

    test("checks whether an account exists by id", () => {
    const cash = new Account({
      id: "1000",
      name: "Cash",
      type: AccountType.ASSET,
    });

    const chart = new ChartOfAccounts([cash]);

    expect(chart.hasAccount("1000")).toBe(true);
    expect(chart.hasAccount("9999")).toBe(false);
  });

    test("adds an account immutably", () => {
    const chart = new ChartOfAccounts();

    const cash = new Account({
      id: "1000",
      name: "Cash",
      type: AccountType.ASSET,
    });

    const updatedChart = chart.addAccount(cash);

    expect(updatedChart).not.toBe(chart);
    expect(updatedChart.hasAccount("1000")).toBe(true);
    expect(chart.hasAccount("1000")).toBe(false);
  });

    test("prevents adding duplicate account ids", () => {
    const cash = new Account({
      id: "1000",
      name: "Cash",
      type: AccountType.ASSET,
    });

    const chart = new ChartOfAccounts([cash]);

    expect(() => chart.addAccount(cash)).toThrow("Duplicate account id");
  });
});
