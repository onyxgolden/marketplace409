import { describe, expect, test } from "vitest";
import { Money } from "@/platform";
import { Account } from "../../accounts/Account.js";
import { AccountType } from "../../accounts/AccountType.js";
import { ChartOfAccounts } from "../../accounts/ChartOfAccounts.js";
import { GeneralLedger } from "../../entities/GeneralLedger.js";
import { JournalEntry } from "../../entities/JournalEntry.js";
import { Posting } from "../../entities/Posting.js";
import { LedgerDirection } from "../../value-objects/index.js";
import { PostingEngine } from "../../services/PostingEngine.js";
import { ProductionReportService } from "../ProductionReportService.js";

function chartOfAccounts() {
  return new ChartOfAccounts([
    new Account({ id: "1000", name: "Assets", type: AccountType.ASSET }),
    new Account({ id: "1010", name: "Cash", type: AccountType.ASSET, parentId: "1000" }),
    new Account({ id: "4000", name: "Revenue", type: AccountType.REVENUE }),
    new Account({ id: "5000", name: "Expenses", type: AccountType.EXPENSE }),
  ]);
}

// One month of books: collect rent, pay an expense. Balanced per journal entry.
function postMonth(id, date, rent, expense) {
  const engine = new PostingEngine();
  return engine.post(
    new JournalEntry({
      id,
      date,
      description: `Books for ${date}`,
      postings: [
        new Posting({
          id: `${id}-p1`,
          accountId: "1010",
          amount: new Money(rent),
          direction: LedgerDirection.DEBIT,
        }),
        new Posting({
          id: `${id}-p2`,
          accountId: "4000",
          amount: new Money(rent),
          direction: LedgerDirection.CREDIT,
        }),
        new Posting({
          id: `${id}-p3`,
          accountId: "5000",
          amount: new Money(expense),
          direction: LedgerDirection.DEBIT,
        }),
        new Posting({
          id: `${id}-p4`,
          accountId: "1010",
          amount: new Money(expense),
          direction: LedgerDirection.CREDIT,
        }),
      ],
    }),
  );
}

function lineAmount(report, accountId) {
  const line = report.lines().find((candidate) => candidate.label === accountId);
  if (!line) throw new Error(`No report line for account ${accountId}`);
  return line.amount;
}

describe("ProductionReportService multi-period reporting", () => {
  const ledger = GeneralLedger.create()
    .record(postMonth("je-jan", "2026-01-15", 1000, 400))
    .record(postMonth("je-feb", "2026-02-15", 2000, 100));

  const service = new ProductionReportService({
    generalLedger: ledger,
    chartOfAccounts: chartOfAccounts(),
  });

  test("builds a comparative income statement, one period at a time", () => {
    const january = service.buildIncomeStatementForPeriod({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
    expect(lineAmount(january, "4000")).toBe(-1000); // revenue is credit-normal
    expect(lineAmount(january, "5000")).toBe(400);

    const february = service.buildIncomeStatementForPeriod({
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });
    expect(lineAmount(february, "4000")).toBe(-2000);
    expect(lineAmount(february, "5000")).toBe(100);
  });

  test("builds a balance sheet as of a point in time", () => {
    // January books: cash 1000 - 400 = 600.
    const january = service.buildBalanceSheetAsOf("2026-01-31");
    expect(lineAmount(january, "1010")).toBe(600);

    // February adds 2000 - 100: cash 600 + 1900 = 2500.
    const february = service.buildBalanceSheetAsOf("2026-02-28");
    expect(lineAmount(february, "1010")).toBe(2500);
  });

  test("the unfiltered statements still see the whole ledger", () => {
    const reports = service.buildReports();
    expect(lineAmount(reports.incomeStatement, "4000")).toBe(-3000);
    expect(lineAmount(reports.balanceSheet, "1010")).toBe(2500);
  });
});
