import { describe, expect, test } from "vitest";
import {
  ProductionFinancialDataProvider,
  buildLedgerInputsFromFinancialEvents,
} from "../ProductionFinancialDataProvider.js";
import { FinancialEngine } from "../../engines/FinancialEngine.js";
import { parseLedgerQuery } from "../../brain/parseLedgerQuery.js";
import { answerLedgerQuery } from "../../brain/answerLedgerQuery.js";
import { buildComparativeIncomeStatements } from "../../reports/buildComparativeIncomeStatements.js";
import { expandMonths } from "../../reports/comparativePeriods.js";

function financialEvent(overrides = {}) {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    owner_id: "owner-1",
    status: "active",
    is_deleted: false,
    event_date: "2026-08-15",
    description: "Test event",
    amount: 100,
    transaction_kind: "expense",
    normalized_category: "dining_drinks",
    created_at: "2026-08-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("ProductionFinancialDataProvider", () => {
  test("maps expense events to DEBIT entries on per-category expense accounts", () => {
    const inputs = buildLedgerInputsFromFinancialEvents([
      financialEvent({
        id: "evt-1",
        amount: 42.5,
        normalized_category: "dining_drinks",
      }),
      financialEvent({
        id: "evt-2",
        amount: 80,
        normalized_category: "groceries",
      }),
    ]);

    expect(inputs).not.toBeNull();

    const chart = inputs.chartOfAccounts;

    expect(chart.hasAccount("expense:dining_drinks")).toBe(true);
    expect(chart.hasAccount("expense:groceries")).toBe(true);

    const dining = chart.getById("expense:dining_drinks");

    expect(dining.name).toBe("Dining Drinks");
    expect(dining.type).toBe("expense");

    const entries = inputs.generalLedger.getEntries();

    expect(entries).toHaveLength(2);
    expect(entries[0].direction).toBe("DEBIT");
    expect(entries[0].accountId).toBe("expense:dining_drinks");
    expect(entries[0].amount.amount).toBe(4250);
    // The accounting date is stamped for period reporting.
    expect(entries[0].metadata.journalEntryDate).toBe("2026-08-15");
    expect(entries[0].metadata.financialEventId).toBe("evt-1");
  });

  test("maps income events to CREDIT entries on per-category revenue accounts", () => {
    const inputs = buildLedgerInputsFromFinancialEvents([
      financialEvent({
        id: "evt-9",
        transaction_kind: "income",
        amount: 1600,
        normalized_category: "rent",
        event_date: "2026-08-01",
      }),
    ]);

    expect(inputs).not.toBeNull();

    const chart = inputs.chartOfAccounts;

    expect(chart.hasAccount("revenue:rent")).toBe(true);
    expect(chart.getById("revenue:rent").type).toBe("revenue");

    const entries = inputs.generalLedger.getEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].direction).toBe("CREDIT");
    expect(entries[0].amount.amount).toBe(160000);
  });

  test("uses the magnitude of signed bank amounts; direction comes from transaction_kind", () => {
    const inputs = buildLedgerInputsFromFinancialEvents([
      financialEvent({
        id: "evt-neg",
        transaction_kind: "expense",
        amount: -25.75,
        normalized_category: "dining_drinks",
      }),
    ]);

    const entries = inputs.generalLedger.getEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].direction).toBe("DEBIT");
    expect(entries[0].amount.amount).toBe(2575);
  });

  test("skips transfers, deleted/inactive rows, and zero or non-finite amounts", () => {
    const inputs = buildLedgerInputsFromFinancialEvents([
      financialEvent({ id: "keep", amount: 10 }),
      financialEvent({ id: "xfer", transaction_kind: "transfer", amount: 5000 }),
      financialEvent({ id: "del", is_deleted: true, amount: 10 }),
      financialEvent({ id: "inact", status: "inactive", amount: 10 }),
      financialEvent({ id: "zero", amount: 0 }),
      financialEvent({ id: "nan", amount: Number.NaN }),
      financialEvent({ id: "inf", amount: Number.POSITIVE_INFINITY }),
      null,
      undefined,
    ]);

    expect(inputs).not.toBeNull();
    expect(inputs.generalLedger.getEntries()).toHaveLength(1);
    expect(inputs.generalLedger.getEntries()[0].id).toContain("keep");
    expect(inputs.chartOfAccounts.accounts).toHaveLength(1);
  });

  test("returns null for an empty or fully unusable event list", () => {
    expect(buildLedgerInputsFromFinancialEvents([])).toBeNull();
    expect(buildLedgerInputsFromFinancialEvents(null)).toBeNull();
    expect(
      buildLedgerInputsFromFinancialEvents([
        financialEvent({ transaction_kind: "transfer", amount: 100 }),
      ]),
    ).toBeNull();
  });

  test("provider returns null (not zeroed reports) when the ledger is genuinely empty", () => {
    expect(
      new ProductionFinancialDataProvider({ events: [] }).getFinancialData(),
    ).toBeNull();
    expect(new ProductionFinancialDataProvider().getFinancialData()).toBeNull();
  });

  test("feeds a working FinancialEngine: ask-the-books answers from real rows", () => {
    const inputs = buildLedgerInputsFromFinancialEvents([
      financialEvent({
        id: "dine-aug-1",
        amount: 42.5,
        normalized_category: "dining_drinks",
        event_date: "2026-08-05",
        description: "Chipotle",
      }),
      financialEvent({
        id: "dine-aug-2",
        amount: 17.5,
        normalized_category: "dining_drinks",
        event_date: "2026-08-20",
        description: "Starbucks",
      }),
      financialEvent({
        id: "dine-sep-1",
        amount: 100,
        normalized_category: "dining_drinks",
        event_date: "2026-09-02",
        description: "Steakhouse",
      }),
      financialEvent({
        id: "rent-aug",
        transaction_kind: "income",
        amount: 1600,
        normalized_category: "rent",
        event_date: "2026-08-01",
        description: "Rent",
      }),
    ]);

    const engine = new FinancialEngine(inputs);
    const parsed = parseLedgerQuery("what did I spend on dining in august 2026");

    expect(parsed.unparseable).toBeUndefined();
    expect(parsed.metric).toBe("spend");
    expect(parsed.categoryFamily).toBe("dining_drinks");

    const answer = answerLedgerQuery({
      engine,
      parsed,
      question: "what did I spend on dining in august 2026",
    });

    // Only the two August dining rows count; September and rent are excluded.
    // Amounts are ledger cents throughout the brain/comparative APIs (the UI
    // converts at its money() boundary).
    expect(answer.amount).toBe(6000);
    expect(answer.lines).toHaveLength(1);
    expect(answer.lines[0].name).toBe("Dining Drinks");
    expect(answer.lines[0].amount).toBe(6000);
  });

  test("feeds a working FinancialEngine: comparative month reporting from real rows", () => {
    const inputs = buildLedgerInputsFromFinancialEvents([
      financialEvent({
        id: "e1",
        amount: 60,
        normalized_category: "dining_drinks",
        event_date: "2026-08-10",
      }),
      financialEvent({
        id: "e2",
        amount: 40,
        normalized_category: "dining_drinks",
        event_date: "2026-09-10",
      }),
      financialEvent({
        id: "i1",
        transaction_kind: "income",
        amount: 1600,
        normalized_category: "rent",
        event_date: "2026-08-01",
      }),
    ]);

    const engine = new FinancialEngine(inputs);
    const periods = buildComparativeIncomeStatements({
      engine,
      periods: expandMonths(["2026-08", "2026-09"]),
    });

    expect(periods).toHaveLength(2);

    const august = periods[0];
    const september = periods[1];

    expect(august.totals.expenses).toBe(6000);
    expect(august.totals.revenue).toBe(160000);
    expect(august.totals.netIncome).toBe(154000);
    expect(september.totals.expenses).toBe(4000);
    expect(september.totals.revenue).toBe(0);
    expect(september.totals.netIncome).toBe(-4000);

    // Columns stay aligned: dining appears in both months, rent only where active.
    const augustDining = august.lines.find(
      (line) => line.accountId === "expense:dining_drinks",
    );

    expect(augustDining.amount).toBe(6000);

    const septemberRent = september.lines.find(
      (line) => line.accountId === "revenue:rent",
    );

    expect(septemberRent.amount).toBe(0);
  });
});
