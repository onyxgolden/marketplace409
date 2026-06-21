import { describe, expect, test } from "vitest";
import { AccountRollupService } from "../AccountRollupService";
import { Money } from "../../../../platform/value-objects/Money";

describe("AccountRollupService", () => {
  test("rolls up an account balance including descendants", () => {
    const chartOfAccounts = {
      getDescendants(accountId) {
        expect(accountId).toBe("1000");

        return [{ id: "1010" }, { id: "1020" }];
      },
    };

    const balances = new Map([
      ["1000", new Money(10)],
      ["1010", new Money(25)],
      ["1020", new Money(40)],
    ]);

    const balanceCalculator = {
      getBalanceByAccount(accountId) {
        return balances.get(accountId);
      },
    };

    const service = new AccountRollupService({
      chartOfAccounts,
      balanceCalculator,
    });

    expect(service.getBalanceByAccount("1000")).toEqual(new Money(75));
  });
});
