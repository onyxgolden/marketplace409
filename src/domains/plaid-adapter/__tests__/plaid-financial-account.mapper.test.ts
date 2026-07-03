import {
  describe,
  expect,
  it,
} from "vitest";

import {
  PlaidFinancialAccountMapper,
} from "../plaid-financial-account.mapper";

describe("PlaidFinancialAccountMapper", () => {
  it("maps Plaid account data into a canonical FinancialAccount", () => {
    const mapper = new PlaidFinancialAccountMapper();

    const account = mapper.map(
      {
        accountId: "plaid_account_1",
        name: "Operating Checking",
        officialName: "Business Operating Checking",
        mask: "1234",
        type: "depository",
        subtype: "checking",
        isoCurrencyCode: "USD",
        unofficialCurrencyCode: null,
      },
      "connection_1",
      "plaid",
      "institution_1",
    );

    expect(account.id).toBe("financial_account_plaid_plaid_account_1");
    expect(account.connectionId).toBe("connection_1");
    expect(account.provider).toBe("plaid");
    expect(account.providerAccountId).toBe("plaid_account_1");
    expect(account.institutionId).toBe("institution_1");
    expect(account.type).toBe("depository");
    expect(account.currencyCode).toBe("USD");
    expect(Object.isFrozen(account)).toBe(true);
  });

  it("falls back to other for unknown account types", () => {
    const mapper = new PlaidFinancialAccountMapper();

    const account = mapper.map(
      {
        accountId: "plaid_account_2",
        name: "Unknown Account",
        officialName: null,
        mask: null,
        type: "mystery",
        subtype: null,
        isoCurrencyCode: null,
        unofficialCurrencyCode: null,
      },
      "connection_1",
      "plaid",
      "institution_1",
    );

    expect(account.type).toBe("other");
    expect(account.currencyCode).toBe("USD");
  });
});
