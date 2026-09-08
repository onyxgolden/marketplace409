import { describe, expect, it } from "vitest";
import { StripeFinancialConnectionsAccountMapper } from "../stripe-financial-connections-account.mapper";

function stripeAccount(overrides = {}) {
  return {
    accountId: "fca_test_1",
    displayName: "Checking",
    institutionName: "Chase",
    last4: "6789",
    category: "cash",
    subcategory: "checking",
    status: "active",
    currency: "usd",
    ...overrides,
  };
}

describe("StripeFinancialConnectionsAccountMapper", () => {
  const mapper = new StripeFinancialConnectionsAccountMapper();

  it("maps a checking account to canonical type depository", () => {
    const account = mapper.map(stripeAccount(), "connection_1", "stripe_financial_connections", "institution_1");
    expect(account.type).toBe("depository");
    expect(account.subtype).toBe("checking");
    expect(account.mask).toBe("6789");
    expect(account.currencyCode).toBe("USD");
    expect(account.providerAccountId).toBe("fca_test_1");
    expect(account.id).toBe("financial_account_stripe_financial_connections_fca_test_1");
  });

  it("maps a credit card account (category credit) to canonical type credit", () => {
    const account = mapper.map(
      stripeAccount({ category: "credit", subcategory: "credit_card" }),
      "connection_1", "stripe_financial_connections", "institution_1",
    );
    expect(account.type).toBe("credit");
  });

  it("maps an investment account to canonical type investment", () => {
    const account = mapper.map(
      stripeAccount({ category: "investment", subcategory: null }),
      "connection_1", "stripe_financial_connections", "institution_1",
    );
    expect(account.type).toBe("investment");
  });

  it("falls back to other for an unrecognized category", () => {
    const account = mapper.map(
      stripeAccount({ category: "other", subcategory: null }),
      "connection_1", "stripe_financial_connections", "institution_1",
    );
    expect(account.type).toBe("other");
  });

  it("marks an inactive/disconnected Stripe account as inactive in the canonical model", () => {
    const account = mapper.map(
      stripeAccount({ status: "disconnected" }),
      "connection_1", "stripe_financial_connections", "institution_1",
    );
    expect(account.active).toBe(false);
  });

  it("marks a Stripe status: 'inactive' account (e.g. Test (Non-OAuth)'s 'Failure'/'Account closes after linking' scenario accounts) as active: false -- needs-attention, not silently healthy/importable", () => {
    const account = mapper.map(
      stripeAccount({ displayName: "Failure", status: "inactive" }),
      "connection_1", "stripe_financial_connections", "institution_1",
    );
    expect(account.active).toBe(false);
  });

  it("never carries an ownership field -- the approved application scope excludes account-ownership data", () => {
    const account = mapper.map(stripeAccount(), "connection_1", "stripe_financial_connections", "institution_1");
    expect(account).not.toHaveProperty("ownership");
    expect(account).not.toHaveProperty("owners");
  });
});
