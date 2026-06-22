import { describe, expect, test } from "vitest";
import { Money } from "../../../../platform/value-objects/Money";
import { Account } from "../../accounts/Account";
import { AccountType } from "../../accounts/AccountType";
import { ChartOfAccounts } from "../../accounts/ChartOfAccounts";
import { BalanceCalculator } from "../../calculators/BalanceCalculator";
import { GeneralLedger } from "../../entities/GeneralLedger";
import { JournalEntry } from "../../entities/JournalEntry";
import { Posting } from "../../entities/Posting";
import { LedgerDirection } from "../../value-objects";
import { PostingEngine } from "../PostingEngine";
import { AccountRollupCachedService } from "../AccountRollupCachedService";

function account(id, name = id) {
  return new Account({
    id,
    name,
    type: AccountType.ASSET,
  });
}

describe("AccountRollupCachedService", () => {
  test("caches rollup results and returns same value on repeated calls", () => {
    const chartOfAccounts = new ChartOfAccounts([
      account("1000", "Assets"),
      account("1010", "Cash"),
      account("1020", "Bank"),
      account("2000", "Equity"),
    ])
      .setParent("1010", "1000")
      .setParent("1020", "1000");

    const journalEntry = new JournalEntry({
      id: "je-1",
      date: new Date("2026-01-01"),
      description: "cached rollup test",
      postings: [
        new Posting({
          id: "p-1",
          accountId: "1010",
          amount: new Money(25),
          direction: LedgerDirection.DEBIT,
        }),
        new Posting({
          id: "p-2",
          accountId: "1020",
          amount: new Money(40),
          direction: LedgerDirection.DEBIT,
        }),
        new Posting({
          id: "p-3",
          accountId: "2000",
          amount: new Money(65),
          direction: LedgerDirection.CREDIT,
        }),
      ],
    });

    const postingEngine = new PostingEngine();
    const postingResult = postingEngine.post(journalEntry);

    const generalLedger = GeneralLedger.create().record(postingResult);
    const balanceCalculator = new BalanceCalculator(generalLedger);

    const cachedService = new AccountRollupCachedService({
      chartOfAccounts,
      balanceCalculator,
    });

    const first = cachedService.getBalanceByAccount("1000");
    const second = cachedService.getBalanceByAccount("1000");

    expect(first).toEqual(new Money(65));
    expect(second).toEqual(first);
  });
});

