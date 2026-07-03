import { describe, expect, it } from "vitest";

import {
  InMemoryAccountBalanceRepository,
} from "../in-memory-account-balance.repository";

import {
  createAccountBalance,
} from "../account-balance.types";

describe("InMemoryAccountBalanceRepository", () => {
  it("saves and finds balances by financial account", async () => {
    const repository = new InMemoryAccountBalanceRepository();

    await repository.save(createAccountBalance({
      id: "balance_1",
      financialAccountId: "financial_account_1",
      connectionId: "connection_1",
      provider: "plaid",
      providerAccountId: "account_1",
      currencyCode: "USD",
      currentBalanceCents: 125000,
      availableBalanceCents: 100000,
      asOf: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    }));

    await expect(
      repository.findByFinancialAccount("financial_account_1"),
    ).resolves.toHaveLength(1);
  });

  it("finds the latest balance by financial account", async () => {
    const repository = new InMemoryAccountBalanceRepository();

    await repository.saveMany([
      createAccountBalance({
        id: "balance_1",
        financialAccountId: "financial_account_1",
        connectionId: "connection_1",
        provider: "plaid",
        providerAccountId: "account_1",
        currencyCode: "USD",
        currentBalanceCents: 100000,
        availableBalanceCents: null,
        asOf: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      createAccountBalance({
        id: "balance_2",
        financialAccountId: "financial_account_1",
        connectionId: "connection_1",
        provider: "plaid",
        providerAccountId: "account_1",
        currencyCode: "USD",
        currentBalanceCents: 125000,
        availableBalanceCents: null,
        asOf: "2026-01-02T00:00:00.000Z",
        createdAt: "2026-01-02T00:00:00.000Z",
      }),
    ]);

    const latest = await repository.findLatestByFinancialAccount(
      "financial_account_1",
    );

    expect(latest?.id).toBe("balance_2");
    expect(latest?.currentBalanceCents).toBe(125000);
  });

  it("finds balances by connection", async () => {
    const repository = new InMemoryAccountBalanceRepository();

    await repository.save(createAccountBalance({
      id: "balance_1",
      financialAccountId: "financial_account_1",
      connectionId: "connection_1",
      provider: "plaid",
      providerAccountId: "account_1",
      currencyCode: "USD",
      currentBalanceCents: 125000,
      availableBalanceCents: null,
      asOf: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    }));

    await expect(
      repository.findByConnection("connection_1"),
    ).resolves.toHaveLength(1);
  });
});
