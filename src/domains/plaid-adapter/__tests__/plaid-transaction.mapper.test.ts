import { describe, expect, it } from "vitest";

import {
  mapPlaidTransactionToFinancialEvent,
} from "../plaid-transaction.mapper";

describe("mapPlaidTransactionToFinancialEvent", () => {
  it("maps a Plaid transaction into a FORGE financial event", () => {
    const event = mapPlaidTransactionToFinancialEvent(
      {
        transactionId: "plaid_txn_1",
        accountId: "plaid_account_1",
        date: "2026-01-15",
        name: "Home Depot",
        amount: 125.5,
        category: ["Shops", "Hardware"],
        merchantName: "Home Depot",
        pending: false,
        raw: {
          paymentChannel: "in store",
        },
      },
      {
        id: "property_1",
        status: "active",
        is_deleted: false,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        rawCategory: "Hardware",
        normalizedCategory: "property_repairs",
        transactionKind: "expense",
        taxDeductible: true,
        affectsNOI: true,
        capitalized: false,
      },
      "owner_1",
    );

    expect(event).toMatchObject({
      owner_id: "owner_1",
      property_id: "property_1",
      event_date: "2026-01-15",
      description: "Home Depot",
      amount: 125.5,
      transaction_kind: "expense",
      normalized_category: "property_repairs",
      tax_deductible: true,
      affects_noi: true,
      capitalized: false,
      source_system: "plaid",
      source_record_id: "plaid_txn_1",
      metadata: {
        accountId: "plaid_account_1",
        category: ["Shops", "Hardware"],
        merchantName: "Home Depot",
        pending: false,
        raw: {
          paymentChannel: "in store",
        },
      },
    });
  });

  it("defaults optional Plaid metadata safely", () => {
    const event = mapPlaidTransactionToFinancialEvent(
      {
        transactionId: "plaid_txn_2",
        accountId: "plaid_account_2",
        date: "2026-01-16",
        name: "Bank Fee",
        amount: 12,
      },
      {
        id: "property_2",
        status: "active",
        is_deleted: false,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        rawCategory: "Bank Fee",
        normalizedCategory: "other",
        transactionKind: "expense",
        taxDeductible: true,
        affectsNOI: true,
        capitalized: false,
      },
    );

    expect(event.metadata).toMatchObject({
      accountId: "plaid_account_2",
      category: [],
      merchantName: null,
      pending: false,
      raw: null,
    });
  });
});
