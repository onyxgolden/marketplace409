import { describe, expect, test } from "vitest";
import { Money } from "../../../../platform/value-objects/Money";
import { Account } from "../../accounts/Account";
import { AccountType } from "../../accounts/AccountType";
import { ChartOfAccounts } from "../../accounts/ChartOfAccounts";
import { AccountRollupSnapshotBuilder } from "../AccountRollupSnapshotBuilder";

function account(id, name = id) {
  return new Account({
    id,
    name,
    type: AccountType.ASSET,
  });
}

describe("AccountRollupSnapshotBuilder", () => {
  test("builds a snapshot for every account in the chart", () => {
    const chartOfAccounts = new ChartOfAccounts([
      account("1000", "Assets"),
      account("1010", "Cash"),
    ]);

    const rollupService = {
      getBalanceByAccount(accountId) {
        if (accountId === "1000") {
          return new Money(65);
        }

        if (accountId === "1010") {
          return new Money(25);
        }

        return new Money(0);
      },
    };

    const builder = new AccountRollupSnapshotBuilder({
      chartOfAccounts,
      rollupService,
    });

    const snapshot = builder.build();

    expect(snapshot.get("1000")).toEqual(new Money(65));
    expect(snapshot.get("1010")).toEqual(new Money(25));
    expect(snapshot.get("9999")).toEqual(new Money(0));
    expect(snapshot.entries()).toHaveLength(2);
  });
});
