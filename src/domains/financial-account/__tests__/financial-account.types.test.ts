import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createFinancialAccount,
  FINANCIAL_ACCOUNT_TYPES,
} from "../financial-account.types";

describe("FinancialAccount types", () => {
  it("creates an immutable financial account", () => {
    const account = createFinancialAccount({
      id: "financial_account_1",
      connectionId: "connection_1",
      provider: "plaid",
      providerAccountId: "plaid_account_1",
      institutionId: "institution_1",
      name: "Operating Checking",
      officialName: "Business Operating Checking",
      mask: "1234",
      type: "depository",
      subtype: "checking",
      currencyCode: "USD",
      active: true,
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    });

    expect(account.name).toBe("Operating Checking");
    expect(Object.isFrozen(account)).toBe(true);
  });

  it("defines supported financial account types", () => {
    expect(FINANCIAL_ACCOUNT_TYPES).toEqual([
      "depository",
      "credit",
      "loan",
      "investment",
      "other",
    ]);
  });
});
