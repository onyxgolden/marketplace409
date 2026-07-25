import { describe, expect, test } from "vitest";

import {
  FinancialEventAggregationService,
  FinancialWorkspacePropertyIds,
} from "../FinancialEventAggregationService.js";

function buildEvent(overrides = {}) {
  return {
    id: "event-1",
    owner_id: "owner-1",
    status: "active",
    is_deleted: false,
    property_id: "170-john",
    event_date: "2026-01-01",
    description: "Rental Income",
    amount: 1500,
    transaction_kind: "income",
    normalized_category: "rental_income",
    tax_deductible: false,
    affects_noi: true,
    capitalized: false,
    source_system: "rentec",
    source_record_id: "rentec-1",
    metadata: null,
    ...overrides,
  };
}

describe("FinancialEventAggregationService", () => {
  test("requires a financial event array", () => {
    const service = new FinancialEventAggregationService();

    expect(() => service.aggregate(null)).toThrow(
      "Financial events must be an array",
    );
  });

  test("returns immutable empty workspace aggregation", () => {
    const service = new FinancialEventAggregationService();

    const result = service.aggregate([]);

    expect(result).toEqual({
      portfolio: {
        income: 0,
        expenses: 0,
        noi: 0,
        cashFlow: 0,
        transactionCount: 0,
      },
      properties: [],
      categories: [],
      transactions: [],
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.portfolio)).toBe(true);
    expect(Object.isFrozen(result.properties)).toBe(true);
    expect(Object.isFrozen(result.categories)).toBe(true);
    expect(Object.isFrozen(result.transactions)).toBe(true);
  });

  test("calculates portfolio income expenses NOI and cash flow", () => {
    const service = new FinancialEventAggregationService();

    const result = service.aggregate([
      buildEvent({
        id: "income-1",
        amount: 1500,
      }),
      buildEvent({
        id: "expense-1",
        amount: 250,
        description: "Repairs",
        transaction_kind: "expense",
        normalized_category: "repairs",
        tax_deductible: true,
      }),
      buildEvent({
        id: "capital-1",
        amount: 400,
        description: "Capital Improvement",
        transaction_kind: "expense",
        normalized_category: "capital_improvement",
        affects_noi: false,
        capitalized: true,
      }),
    ]);

    expect(result.portfolio).toEqual({
      income: 1500,
      expenses: 650,
      noi: 1250,
      cashFlow: 850,
      transactionCount: 3,
    });
  });

  test("groups financial totals by property", () => {
    const service = new FinancialEventAggregationService();

    const result = service.aggregate([
      buildEvent({
        id: "property-1-income",
        property_id: "170-john",
        amount: 1500,
      }),
      buildEvent({
        id: "property-1-expense",
        property_id: "170-john",
        amount: 300,
        transaction_kind: "expense",
        normalized_category: "repairs",
      }),
      buildEvent({
        id: "property-2-income",
        property_id: "335-butler",
        amount: 2000,
      }),
    ]);

    expect(result.properties).toEqual([
      {
        propertyId: "170-john",
        income: 1500,
        expenses: 300,
        noi: 1200,
        cashFlow: 1200,
        transactionCount: 2,
      },
      {
        propertyId: "335-butler",
        income: 2000,
        expenses: 0,
        noi: 2000,
        cashFlow: 2000,
        transactionCount: 1,
      },
    ]);

    expect(Object.isFrozen(result.properties[0])).toBe(true);
  });

  test("places events without a property into the unassigned summary", () => {
    const service = new FinancialEventAggregationService();

    const result = service.aggregate([
      buildEvent({
        property_id: null,
      }),
    ]);

    expect(result.properties[0].propertyId).toBe(
      FinancialWorkspacePropertyIds.UNASSIGNED,
    );
    expect(result.transactions[0].propertyId).toBe(
      FinancialWorkspacePropertyIds.UNASSIGNED,
    );
  });

  test("builds category summaries", () => {
    const service = new FinancialEventAggregationService();

    const result = service.aggregate([
      buildEvent({
        id: "rent-1",
        amount: 1500,
      }),
      buildEvent({
        id: "rent-2",
        amount: 75,
      }),
      buildEvent({
        id: "repair-1",
        amount: 250,
        transaction_kind: "expense",
        normalized_category: "repairs",
      }),
    ]);

    expect(result.categories).toEqual([
      {
        category: "rental_income",
        income: 1575,
        expenses: 0,
        netAmount: 1575,
        transactionCount: 2,
      },
      {
        category: "repairs",
        income: 0,
        expenses: 250,
        netAmount: -250,
        transactionCount: 1,
      },
    ]);

    expect(Object.isFrozen(result.categories[0])).toBe(true);
  });

  test("returns chronological immutable transaction history", () => {
    const service = new FinancialEventAggregationService();

    const result = service.aggregate([
      buildEvent({
        id: "event-2",
        event_date: "2026-02-01",
        description: "February Rent",
      }),
      buildEvent({
        id: "event-1",
        event_date: "2026-01-01",
        description: "January Rent",
      }),
    ]);

    expect(result.transactions.map((transaction) => transaction.id)).toEqual([
      "event-1",
      "event-2",
    ]);

    expect(result.transactions[0]).toMatchObject({
      propertyId: "170-john",
      eventDate: "2026-01-01",
      description: "January Rent",
      amount: 1500,
      transactionKind: "income",
      category: "rental_income",
      affectsNOI: true,
      capitalized: false,
      sourceSystem: "rentec",
      sourceRecordId: "rentec-1",
    });

    expect(Object.isFrozen(result.transactions[0])).toBe(true);
  });

  test("excludes deleted and inactive financial events", () => {
    const service = new FinancialEventAggregationService();

    const result = service.aggregate([
      buildEvent({
        id: "active",
      }),
      buildEvent({
        id: "deleted",
        is_deleted: true,
      }),
      buildEvent({
        id: "inactive",
        status: "inactive",
      }),
    ]);

    expect(result.portfolio.transactionCount).toBe(1);
    expect(result.transactions.map((transaction) => transaction.id)).toEqual([
      "active",
    ]);
  });

  test("does not mutate the source financial event collection", () => {
    const service = new FinancialEventAggregationService();
    const events = [
      buildEvent({
        id: "event-2",
        event_date: "2026-02-01",
      }),
      buildEvent({
        id: "event-1",
        event_date: "2026-01-01",
      }),
    ];

    service.aggregate(events);

    expect(events.map((event) => event.id)).toEqual([
      "event-2",
      "event-1",
    ]);
  });

  test("supports asset purchases without affecting operating KPIs", () => {
    const service = new FinancialEventAggregationService();

    const result = service.aggregate([
      buildEvent({
        transaction_kind: "asset_purchase",
        normalized_category: "capital_improvement",
        amount: 2500,
        affects_noi: false,
        capitalized: true,
      }),
    ]);

    expect(result.portfolio).toEqual({
      income: 0,
      expenses: 0,
      noi: 0,
      cashFlow: 0,
      transactionCount: 1,
    });

    expect(result.transactions[0].transactionKind).toBe(
      "asset_purchase",
    );
  });

  test("rejects unsupported transaction kinds", () => {
    const service = new FinancialEventAggregationService();

    expect(() =>
      service.aggregate([
        buildEvent({
          transaction_kind: "transfer",
        }),
      ]),
    ).toThrow(
      "Unsupported financial event transaction kind: transfer",
    );
  });

  test("rejects non-numeric financial event amounts", () => {
    const service = new FinancialEventAggregationService();

    expect(() =>
      service.aggregate([
        buildEvent({
          amount: "not-a-number",
        }),
      ]),
    ).toThrow("Financial event amount must be a finite number");
  });
});
