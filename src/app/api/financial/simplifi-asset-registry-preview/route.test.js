import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedFinancialApplication", () => ({
  createAuthenticatedFinancialApplication: mocks.authenticate,
}));

import { GET } from "./route";

function buildBalanceRow(accountId, asOf, currentBalanceCents) {
  return {
    financial_account_id: accountId,
    current_balance_cents: currentBalanceCents,
    as_of: asOf,
  };
}

// Each call to database.from(table) must return an independent builder — the route issues several
// queries concurrently via Promise.all, so a single shared/mutable builder would race on which
// table's rows it resolves against.
function makeDatabase(rowsByTable) {
  function buildQuery(table) {
    const allRows = rowsByTable[table] || [];
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      range: (from, to) =>
        Promise.resolve({ data: allRows.slice(from, to + 1), error: null }),
      then: (resolve) => resolve({ data: allRows, error: null }),
    };
    return builder;
  }
  return { from: vi.fn((table) => buildQuery(table)) };
}

describe("GET /api/financial/simplifi-asset-registry-preview — account_balances pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pages through more than 1,000 account_balances rows and still resolves the latest balance per account", async () => {
    // 3 accounts, each with 400 historical balance rows (1,200 total, spans two 1,000-row pages).
    // Ordered by (financial_account_id asc, as_of desc), matching the query's real ordering, so the
    // first row seen per account across the whole paginated scan is that account's latest balance.
    const accountBalanceRows = [];
    for (const accountId of ["account-a", "account-b", "account-c"]) {
      for (let day = 400; day >= 1; day -= 1) {
        const asOf = `2026-01-${String((day % 28) + 1).padStart(2, "0")}T00:00:00.000Z`;
        const currentBalanceCents = day === 400 ? 999999 : day * 100;
        accountBalanceRows.push(
          buildBalanceRow(accountId, asOf, currentBalanceCents),
        );
      }
    }
    accountBalanceRows.sort((a, b) => {
      if (a.financial_account_id !== b.financial_account_id) {
        return a.financial_account_id < b.financial_account_id ? -1 : 1;
      }
      return a.as_of < b.as_of ? 1 : -1;
    });
    // Give account-a's genuinely-latest row a distinct, unambiguous as_of/value pair so the test
    // fails if pagination silently drops or reorders rows across the page boundary.
    const latestForAccountA = accountBalanceRows.find(
      (row) => row.financial_account_id === "account-a",
    );
    latestForAccountA.as_of = "2026-06-01T00:00:00.000Z";
    latestForAccountA.current_balance_cents = 555500;
    accountBalanceRows.sort((a, b) => {
      if (a.financial_account_id !== b.financial_account_id) {
        return a.financial_account_id < b.financial_account_id ? -1 : 1;
      }
      return a.as_of < b.as_of ? 1 : -1;
    });

    expect(accountBalanceRows.length).toBeGreaterThan(1000);

    const database = makeDatabase({
      financial_accounts: [
        { id: "account-a", name: "2015 Toyota Tacoma", type: "other", provider: "quicken_simplifi_csv", active: true },
      ],
      account_balances: accountBalanceRows,
      financial_assets: [],
      financial_events: [
        { financial_account_id: "account-a", metadata: { account_scope: "business" } },
      ],
    });
    mocks.authenticate.mockResolvedValue({
      user: { id: "owner_1" },
      supabaseClient: database,
    });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();

    const accountARow = body.rows.find(
      (row) => row.financialAccountId === "account-a",
    );
    expect(accountARow.valueCents).toBe(555500);
    expect(accountARow.valueDate).toBe("2026-06-01T00:00:00.000Z");
  });

  it("resolves the latest balance correctly when an account's rows straddle a page boundary", async () => {
    // account-x gets exactly 1,000 older rows (fills page 1 entirely), account-y's single, genuinely
    // latest row lands as the very first row of page 2 — this only resolves correctly if pagination
    // continues past page 1 rather than stopping once a full page is seen.
    const accountBalanceRows = [];
    for (let day = 1000; day >= 1; day -= 1) {
      accountBalanceRows.push(
        buildBalanceRow(
          "account-x",
          `2020-01-01T00:00:00.000Z`,
          day,
        ),
      );
    }
    accountBalanceRows.push(
      buildBalanceRow("account-y", "2026-07-01T00:00:00.000Z", 424242),
    );

    const database = makeDatabase({
      financial_accounts: [
        { id: "account-y", name: "Box Trailer", type: "other", provider: "quicken_simplifi_csv", active: true },
      ],
      account_balances: accountBalanceRows,
      financial_assets: [],
      financial_events: [
        { financial_account_id: "account-y", metadata: { account_scope: "business" } },
      ],
    });
    mocks.authenticate.mockResolvedValue({
      user: { id: "owner_1" },
      supabaseClient: database,
    });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();

    const accountYRow = body.rows.find(
      (row) => row.financialAccountId === "account-y",
    );
    expect(accountYRow.valueCents).toBe(424242);
    expect(accountYRow.valueDate).toBe("2026-07-01T00:00:00.000Z");
  });

  it("returns the authentication response when unauthenticated", async () => {
    mocks.authenticate.mockResolvedValueOnce({
      response: new Response("unauthorized", { status: 401 }),
    });
    const response = await GET();
    expect(response.status).toBe(401);
  });
});
