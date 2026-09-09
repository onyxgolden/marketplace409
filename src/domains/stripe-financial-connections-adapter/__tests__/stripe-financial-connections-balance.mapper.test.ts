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
    type: "cash",
    refreshStatus: "succeeded",
    ...overrides,
  };
}

describe("StripeFinancialConnectionsBalanceMapper", () => {
  const mapper = new StripeFinancialConnectionsBalanceMapper();

  it("maps a succeeded cash-account balance refresh directly in cents -- no x100 conversion, unlike Plaid's dollar amounts", () => {
    const balance = mapper.map(stripeBalance(), "financial_account_1", "connection_1", "stripe_financial_connections");
    expect(balance.currentBalanceCents).toBe(154302);
    expect(balance.availableBalanceCents).toBe(150000);
    expect(balance.currencyCode).toBe("USD");
    expect(balance.asOf).toBe("2026-01-15T12:00:00.000Z");
  });

  it("maps a credit-account balance from `current`, not from a negated `credit.used`, with availableBalanceCents null", () => {
    // A credit account's "current balance" per Stripe is itself already the amount owed (or
    // owed-to) the holder -- there is no cash.available concept for credit, and this mapper must
    // not substitute/derive one from credit.used.
    const balance = mapper.map(
      stripeBalance({ type: "credit", currentCents: -42500, availableCents: null }),
      "financial_account_1", "connection_1", "stripe_financial_connections",
    );
    expect(balance.currentBalanceCents).toBe(-42500);
    expect(balance.availableBalanceCents).toBeNull();
  });

  it("preserves a negative current balance (money owed BY the account holder) without flipping its sign", () => {
    const balance = mapper.map(stripeBalance({ currentCents: -1899 }), "financial_account_1", "connection_1", "stripe_financial_connections");
    expect(balance.currentBalanceCents).toBe(-1899);
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

  it("never defaults currentCents to 0 -- the type requires a real number, and the client (not this mapper) is what refuses to produce a state with a missing amount", () => {
    const balance = mapper.map(stripeBalance({ currentCents: 0 }), "financial_account_1", "connection_1", "stripe_financial_connections");
    expect(balance.currentBalanceCents).toBe(0);
  });
});
