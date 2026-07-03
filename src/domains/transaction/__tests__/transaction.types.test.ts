import { describe, expect, it } from "vitest";

import {
  createTransaction,
} from "../transaction.types";

describe("Transaction", () => {
  it("creates an immutable provider-agnostic transaction", () => {
    const transaction = createTransaction({
      id: "transaction_1",
      financialAccountId: "financial_account_1",
      connectionId: "connection_1",
      provider: "plaid",
      providerTransactionId: "plaid_transaction_1",
      providerAccountId: "plaid_account_1",
      amountCents: 12550,
      currencyCode: "USD",
      date: "2026-01-15",
      description: "Home Depot",
      merchantName: "Home Depot",
      category: ["Shops", "Hardware"],
      pending: false,
      raw: {
        paymentChannel: "in store",
      },
      createdAt: "2026-01-15T00:00:00.000Z",
    });

    expect(transaction.amountCents).toBe(12550);
    expect(transaction.category).toEqual(["Shops", "Hardware"]);
    expect(Object.isFrozen(transaction)).toBe(true);
    expect(Object.isFrozen(transaction.category)).toBe(true);
  });
});
