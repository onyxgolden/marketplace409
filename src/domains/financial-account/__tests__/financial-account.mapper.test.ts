import { describe, expect, test } from "vitest";
import { mapFinancialAccountRowToFinancialAccount } from "../financial-account.mapper";

describe("mapFinancialAccountRowToFinancialAccount", () => {
  test("maps a database row into a FinancialAccount domain object", () => {
    const row = {
      id: "acct-1",
      created_at: "2026-06-23T00:00:00Z",
      updated_at: "2026-06-23T01:00:00Z",
      institution_id: "inst-1",
      name: "Primary Checking",
      type: "checking",
      account_mask: "1234",
      current_balance: 2500,
      supports_sync: true,
      last_synced_at: "2026-06-23T02:00:00Z",
      notes: "Main operating account",
    };

    expect(mapFinancialAccountRowToFinancialAccount(row)).toEqual({
      id: "acct-1",
      created_at: "2026-06-23T00:00:00Z",
      updated_at: "2026-06-23T01:00:00Z",
      institution_id: "inst-1",
      name: "Primary Checking",
      type: "checking",
      account_mask: "1234",
      current_balance: 2500,
      supports_sync: true,
      last_synced_at: "2026-06-23T02:00:00Z",
      notes: "Main operating account",
    });
  });
});
