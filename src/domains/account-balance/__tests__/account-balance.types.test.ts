import { describe, expect, it } from "vitest";

import {
  createAccountBalance,
} from "../account-balance.types";

describe("AccountBalance", () => {
  it("creates an immutable account balance snapshot", () => {
    const balance = createAccountBalance({
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
    });

    expect(balance.currentBalanceCents).toBe(125000);
    expect(balance.availableBalanceCents).toBe(100000);
    expect(Object.isFrozen(balance)).toBe(true);
  });

  it("allows unavailable balance to be null", () => {
    const balance = createAccountBalance({
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
    });

    expect(balance.availableBalanceCents).toBeNull();
  });
});
