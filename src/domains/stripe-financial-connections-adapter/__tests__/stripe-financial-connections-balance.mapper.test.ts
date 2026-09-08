import { describe, expect, it } from "vitest";
import { StripeFinancialConnectionsBalanceMapper } from "../stripe-financial-connections-balance.mapper";
import type { StripeFinancialConnectionsBalance } from "../stripe-financial-connections-balance.types";

function stripeBalance(overrides: Partial<StripeFinancialConnectionsBalance> = {}): StripeFinancialConnectionsBalance {
  return {
    accountId: "fca_test_1",
    currentCents: 154302,
    availableCents: 150000,
    currency: "usd",
    asOf: "2026-01-15T12:00:00.000Z",
    refreshStatus: "succeeded",
    ...overrides,
  };
}

describe("StripeFinancialConnectionsBalanceMapper", () => {
  const mapper = new StripeFinancialConnectionsBalanceMapper();

  it("maps a succeeded balance refresh directly in cents -- no x100 conversion, unlike Plaid's dollar amounts", () => {
    const balance = mapper.map(stripeBalance(), "financial_account_1", "connection_1", "stripe_financial_connections");
    expect(balance.currentBalanceCents).toBe(154302);
    expect(balance.availableBalanceCents).toBe(150000);
    expect(balance.currencyCode).toBe("USD");
    expect(balance.asOf).toBe("2026-01-15T12:00:00.000Z");
  });

  it("refuses to map a balance whose refresh has not succeeded, rather than writing stale/pending data as current", () => {
    expect(() => mapper.map(stripeBalance({ refreshStatus: "pending" }), "financial_account_1", "connection_1", "stripe_financial_connections"))
      .toThrow(/not from a succeeded refresh/);
    expect(() => mapper.map(stripeBalance({ refreshStatus: "failed" }), "financial_account_1", "connection_1", "stripe_financial_connections"))
      .toThrow(/not from a succeeded refresh/);
    expect(() => mapper.map(stripeBalance({ refreshStatus: null }), "financial_account_1", "connection_1", "stripe_financial_connections"))
      .toThrow(/not from a succeeded refresh/);
  });

  it("passes through a null available balance (e.g. a credit account with no available-credit concept reported)", () => {
    const balance = mapper.map(stripeBalance({ availableCents: null }), "financial_account_1", "connection_1", "stripe_financial_connections");
    expect(balance.availableBalanceCents).toBeNull();
  });
});
