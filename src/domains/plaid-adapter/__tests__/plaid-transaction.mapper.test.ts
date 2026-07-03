import {
  describe,
  expect,
  it,
} from "vitest";

import {
  PlaidTransactionMapper,
} from "../plaid-transaction.mapper";

describe("PlaidTransactionMapper", () => {
  it("maps Plaid transaction data into a canonical Transaction", () => {
    const mapper = new PlaidTransactionMapper();

    const transaction = mapper.map(
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
      "connection_1",
      "plaid",
      "financial_account_1",
      "plaid_account_1",
    );

    expect(transaction.id).toBe("transaction_plaid_plaid_txn_1");
    expect(transaction.financialAccountId).toBe("financial_account_1");
    expect(transaction.connectionId).toBe("connection_1");
    expect(transaction.provider).toBe("plaid");
    expect(transaction.providerTransactionId).toBe("plaid_txn_1");
    expect(transaction.providerAccountId).toBe("plaid_account_1");
    expect(transaction.amountCents).toBe(12550);
    expect(transaction.currencyCode).toBe("USD");
    expect(transaction.date).toBe("2026-01-15");
    expect(transaction.description).toBe("Home Depot");
    expect(transaction.merchantName).toBe("Home Depot");
    expect(transaction.category).toEqual(["Shops", "Hardware"]);
    expect(transaction.pending).toBe(false);
    expect(transaction.raw).toEqual({
      paymentChannel: "in store",
    });
    expect(Object.isFrozen(transaction)).toBe(true);
    expect(Object.isFrozen(transaction.category)).toBe(true);
  });

  it("defaults optional Plaid transaction fields safely", () => {
    const mapper = new PlaidTransactionMapper();

    const transaction = mapper.map(
      {
        transactionId: "plaid_txn_2",
        accountId: "plaid_account_2",
        date: "2026-01-16",
        name: "Bank Fee",
        amount: 12,
      },
      "connection_1",
      "plaid",
      "financial_account_2",
      "plaid_account_2",
    );

    expect(transaction.amountCents).toBe(1200);
    expect(transaction.currencyCode).toBe("USD");
    expect(transaction.merchantName).toBeNull();
    expect(transaction.category).toEqual([]);
    expect(transaction.pending).toBe(false);
    expect(transaction.raw).toBeNull();
  });

  it("maps many Plaid transactions", () => {
    const mapper = new PlaidTransactionMapper();

    const transactions = mapper.mapMany(
      [
        {
          transactionId: "plaid_txn_1",
          accountId: "plaid_account_1",
          date: "2026-01-15",
          name: "Home Depot",
          amount: 125.5,
        },
        {
          transactionId: "plaid_txn_2",
          accountId: "plaid_account_1",
          date: "2026-01-16",
          name: "Bank Fee",
          amount: 12,
        },
      ],
      "connection_1",
      "plaid",
      "financial_account_1",
      "plaid_account_1",
    );

    expect(transactions).toHaveLength(2);
    expect(transactions[0]?.id).toBe("transaction_plaid_plaid_txn_1");
    expect(transactions[1]?.id).toBe("transaction_plaid_plaid_txn_2");
  });
});
