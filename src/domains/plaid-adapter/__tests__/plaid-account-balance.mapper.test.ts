import {
  describe,
  expect,
  it,
} from "vitest";

import {
  PlaidAccountBalanceMapper,
} from "../plaid-account-balance.mapper";

describe("PlaidAccountBalanceMapper", () => {
  it("maps Plaid balance data into a canonical AccountBalance", () => {
    const mapper = new PlaidAccountBalanceMapper();

    const balance = mapper.map(
      {
        accountId: "plaid_account_1",
        current: 1250.55,
        available: 1000.25,
        isoCurrencyCode: "USD",
        unofficialCurrencyCode: null,
      },
      "financial_account_1",
      "connection_1",
      "plaid",
      "2026-01-01T00:00:00.000Z",
    );

    expect(balance.id).toBe(
      "account_balance_plaid_plaid_account_1_2026-01-01T00:00:00.000Z",
    );
    expect(balance.financialAccountId).toBe("financial_account_1");
    expect(balance.connectionId).toBe("connection_1");
    expect(balance.provider).toBe("plaid");
    expect(balance.providerAccountId).toBe("plaid_account_1");
    expect(balance.currencyCode).toBe("USD");
    expect(balance.currentBalanceCents).toBe(125055);
    expect(balance.availableBalanceCents).toBe(100025);
    expect(Object.isFrozen(balance)).toBe(true);
  });

  it("allows unavailable balance to be null", () => {
    const mapper = new PlaidAccountBalanceMapper();

    const balance = mapper.map(
      {
        accountId: "plaid_account_1",
        current: 1250,
        available: null,
        isoCurrencyCode: null,
        unofficialCurrencyCode: null,
      },
      "financial_account_1",
      "connection_1",
      "plaid",
      "2026-01-01T00:00:00.000Z",
    );

    expect(balance.availableBalanceCents).toBeNull();
    expect(balance.currencyCode).toBe("USD");
  });
});
