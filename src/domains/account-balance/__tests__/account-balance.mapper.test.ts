import {
  describe,
  expect,
  it,
} from "vitest";

import {
  mapAccountBalanceRowToAccountBalance,
} from "../account-balance.mapper";

describe(
  "mapAccountBalanceRowToAccountBalance",
  () => {
    it("maps a database row into an immutable canonical account balance", () => {
      const balance =
        mapAccountBalanceRowToAccountBalance({
          id: "account_balance_1",
          financial_account_id:
            "financial_account_1",
          connection_id: "connection_1",
          provider: "plaid",
          provider_account_id:
            "plaid_account_1",
          currency_code: "USD",
          current_balance_cents: 125055,
          available_balance_cents: 100025,
          as_of:
            "2026-07-15T00:00:00.000Z",
          created_at:
            "2026-07-15T00:00:00.000Z",
        });

      expect(balance).toEqual({
        id: "account_balance_1",
        financialAccountId:
          "financial_account_1",
        connectionId: "connection_1",
        provider: "plaid",
        providerAccountId:
          "plaid_account_1",
        currencyCode: "USD",
        currentBalanceCents: 125055,
        availableBalanceCents: 100025,
        asOf:
          "2026-07-15T00:00:00.000Z",
        createdAt:
          "2026-07-15T00:00:00.000Z",
      });

      expect(Object.isFrozen(balance)).toBe(
        true,
      );
    });

    it("preserves a null available balance", () => {
      const balance =
        mapAccountBalanceRowToAccountBalance({
          id: "account_balance_1",
          financial_account_id:
            "financial_account_1",
          connection_id: "connection_1",
          provider: "plaid",
          provider_account_id:
            "plaid_account_1",
          currency_code: "USD",
          current_balance_cents: 125055,
          available_balance_cents: null,
          as_of:
            "2026-07-15T00:00:00.000Z",
          created_at:
            "2026-07-15T00:00:00.000Z",
        });

      expect(
        balance.availableBalanceCents,
      ).toBeNull();
    });
  },
);
