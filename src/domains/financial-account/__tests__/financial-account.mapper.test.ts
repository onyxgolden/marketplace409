import {
  describe,
  expect,
  it,
} from "vitest";

import {
  mapFinancialAccountRowToFinancialAccount,
} from "../financial-account.mapper";

describe("mapFinancialAccountRowToFinancialAccount", () => {
  it("maps a database row into a canonical FinancialAccount", () => {
    const account = mapFinancialAccountRowToFinancialAccount({
      id: "financial_account_1",
      connection_id: "connection_1",
      provider: "plaid",
      provider_account_id: "plaid_account_1",
      institution_id: "institution_1",
      name: "Operating Checking",
      official_name: "Business Operating Checking",
      mask: "1234",
      type: "depository",
      subtype: "checking",
      currency_code: "USD",
      active: true,
      created_at: "2026-07-02T00:00:00.000Z",
      updated_at: "2026-07-02T00:00:00.000Z",
    });

    expect(account).toEqual({
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

    expect(Object.isFrozen(account)).toBe(true);
  });
});
