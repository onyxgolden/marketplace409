import { describe, expect, test } from "vitest";
import { Money } from "@/platform";
import { Account } from "../../accounts/Account";
import { AccountType } from "../../accounts/AccountType";
import { ChartOfAccounts } from "../../accounts/ChartOfAccounts";
import { GeneralLedger } from "../../entities/GeneralLedger";
import { JournalEntry } from "../../entities/JournalEntry";
import { Posting } from "../../entities/Posting";
import { LedgerDirection } from "../../value-objects";
import { PostingEngine } from "../PostingEngine";
import { BalanceCalculator } from "../../calculators/BalanceCalculator";
import { AccountRollupService } from "../AccountRollupService";

function chart() {
  return new ChartOfAccounts([
    new Account({ id: "1000", name: "Assets", type: AccountType.ASSET }),
    new Account({ id: "1010", name: "Cash", type: AccountType.ASSET }),
    new Account({ id: "1020", name: "Bank", type: AccountType.ASSET }),
  ])
    .setParent("1010", "1000")
    .setParent("1020", "1000");
}

function postSplit(id, date, cashAmount, bankAmount) {
  const engine = new PostingEngine();
  return engine.post(
    new JournalEntry({
      id,
      date,
      description: "Owner contribution",
      postings: [
        new Posting({
          id: `${id}-p1`,
          accountId: "1010",
          amount: new Money(cashAmount),
          direction: LedgerDirection.DEBIT,
        }),
        new Posting({
          id: `${id}-p2`,
          accountId: "1020",
          amount: new Money(bankAmount),
          direction: LedgerDirection.DEBIT,
        }),
        new Posting({
          id: `${id}-p3`,
          accountId: "2000",
          amount: new Money(cashAmount + bankAmount),
          direction: LedgerDirection.CREDIT,
        }),
      ],
    }),
  );
}

describe("AccountRollupService.getBalanceByAccountInPeriod", () => {
  test("rolls up period-filtered child balances through the hierarchy", () => {
    const ledger = GeneralLedger.create()
      .record(postSplit("je-jan", "2026-01-10", 25, 40))
      .record(postSplit("je-feb", "2026-02-10", 100, 0));

    const service = new AccountRollupService({
      chartOfAccounts: chart(),
      balanceCalculator: new BalanceCalculator(ledger),
    });

    const january = service.getBalanceByAccountInPeriod("1000", {
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
    expect(january.amount).toBe(65);

    const february = service.getBalanceByAccountInPeriod("1000", {
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });
    expect(february.amount).toBe(100);
  });
});
