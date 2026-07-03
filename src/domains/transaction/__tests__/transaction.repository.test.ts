import { describe, expect, it } from "vitest";

import {
  InMemoryTransactionRepository,
} from "../in-memory-transaction.repository";

import {
  createTransaction,
} from "../transaction.types";

function makeTransaction(
  id: string,
  overrides = {},
) {
  return createTransaction({
    id,
    financialAccountId: "financial_account_1",
    connectionId: "connection_1",
    provider: "plaid",
    providerTransactionId: `plaid_${id}`,
    providerAccountId: "plaid_account_1",
    amountCents: 12550,
    currencyCode: "USD",
    date: "2026-01-15",
    description: "Home Depot",
    merchantName: "Home Depot",
    category: ["Shops", "Hardware"],
    pending: false,
    raw: null,
    createdAt: "2026-01-15T00:00:00.000Z",
    ...overrides,
  });
}

describe("InMemoryTransactionRepository", () => {
  it("saves and finds transactions by financial account", async () => {
    const repository = new InMemoryTransactionRepository();

    await repository.save(makeTransaction("transaction_1"));

    await expect(
      repository.findByFinancialAccount("financial_account_1"),
    ).resolves.toHaveLength(1);
  });

  it("finds transactions by connection", async () => {
    const repository = new InMemoryTransactionRepository();

    await repository.save(makeTransaction("transaction_1"));

    await expect(
      repository.findByConnection("connection_1"),
    ).resolves.toHaveLength(1);
  });

  it("finds a transaction by provider transaction id", async () => {
    const repository = new InMemoryTransactionRepository();

    await repository.save(makeTransaction("transaction_1"));

    const transaction = await repository.findByProviderTransactionId(
      "plaid",
      "plaid_transaction_1",
    );

    expect(transaction?.id).toBe("transaction_1");
  });
});
