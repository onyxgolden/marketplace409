import { describe, expect, test, vi } from "vitest";

import {
  SupabaseDashboardFinancialSummaryRepository,
} from "./SupabaseDashboardFinancialSummaryRepository.js";

function summaryPayload(overrides = {}) {
  return {
    version: "forge_dashboard_financial_summary_v1",
    status: "ok",
    ownerId: "owner-1",
    scope: "business",
    portfolio: {
      income: 1500,
      expenses: 650,
      noi: 1250,
      cashFlow: 850,
      transactionCount: 3,
    },
    properties: [
      {
        propertyId: "335-butler",
        income: 2000,
        expenses: 0,
        noi: 2000,
        cashFlow: 2000,
        transactionCount: 1,
      },
      {
        propertyId: "170-john",
        income: 1500,
        expenses: 650,
        noi: 1250,
        cashFlow: 850,
        transactionCount: 2,
      },
    ],
    categories: [
      {
        category: "rental_income",
        income: 3500,
        expenses: 0,
        netAmount: 3500,
        transactionCount: 2,
      },
      {
        category: "repairs",
        income: 0,
        expenses: 650,
        netAmount: -650,
        transactionCount: 1,
      },
    ],
    transactionsStatus: "not-loaded",
    ...overrides,
  };
}

describe("SupabaseDashboardFinancialSummaryRepository", () => {
  test("calls the summary RPC once with the resolved owner and scope", async () => {
    const rpc = vi.fn(async () => ({ data: summaryPayload(), error: null }));
    const repository = new SupabaseDashboardFinancialSummaryRepository({
      supabaseClient: { rpc },
    });

    const summary = await repository.getSummary({
      ownerId: "owner-1",
      scope: "business",
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "forge_dashboard_financial_summary_v1",
      { p_owner_id: "owner-1", p_scope: "business" },
    );
    expect(summary.transactionsStatus).toBe("not-loaded");
    expect(summary).not.toHaveProperty("transactions");
    expect(Object.isFrozen(summary)).toBe(true);
  });

  test("sorts properties and categories ascending, regardless of RPC order", async () => {
    const rpc = vi.fn(async () => ({ data: summaryPayload(), error: null }));
    const repository = new SupabaseDashboardFinancialSummaryRepository({
      supabaseClient: { rpc },
    });

    const summary = await repository.getSummary({
      ownerId: "owner-1",
      scope: "business",
    });

    expect(summary.properties.map((row) => row.propertyId)).toEqual([
      "170-john",
      "335-butler",
    ]);
    expect(summary.categories.map((row) => row.category)).toEqual([
      "rental_income",
      "repairs",
    ]);
  });

  test("sorts with localeCompare, not database collation order", async () => {
    // In SQL C collation "Zebra" < "apple" (uppercase first); in
    // localeCompare "apple" < "Zebra". The repository must match the
    // JS aggregation service's order either way.
    const payload = summaryPayload();
    payload.properties = [
      {
        propertyId: "Zebra",
        income: 1,
        expenses: 0,
        noi: 1,
        cashFlow: 1,
        transactionCount: 1,
      },
      {
        propertyId: "apple",
        income: 2,
        expenses: 0,
        noi: 2,
        cashFlow: 2,
        transactionCount: 1,
      },
    ];
    const rpc = vi.fn(async () => ({ data: payload, error: null }));
    const repository = new SupabaseDashboardFinancialSummaryRepository({
      supabaseClient: { rpc },
    });

    const summary = await repository.getSummary({
      ownerId: "owner-1",
      scope: "business",
    });

    expect(summary.properties.map((row) => row.propertyId)).toEqual([
      "apple",
      "Zebra",
    ]);
  });

  test("maps 'all' scope to a null RPC scope (unfiltered)", async () => {
    const rpc = vi.fn(async () => ({ data: summaryPayload({ scope: null }), error: null }));
    const repository = new SupabaseDashboardFinancialSummaryRepository({
      supabaseClient: { rpc },
    });

    const summary = await repository.getSummary({
      ownerId: "owner-1",
      scope: "all",
    });

    expect(rpc).toHaveBeenCalledWith(
      "forge_dashboard_financial_summary_v1",
      { p_owner_id: "owner-1", p_scope: null },
    );
    expect(summary.scope).toBe(null);
  });

  test("requires an owner id", async () => {
    const repository = new SupabaseDashboardFinancialSummaryRepository({
      supabaseClient: { rpc: vi.fn() },
    });

    await expect(
      repository.getSummary({ ownerId: null }),
    ).rejects.toThrow("Owner id is required");
  });

  test("rejects an unknown scope instead of silently querying it", async () => {
    const rpc = vi.fn();
    const repository = new SupabaseDashboardFinancialSummaryRepository({
      supabaseClient: { rpc },
    });

    await expect(
      repository.getSummary({ ownerId: "owner-1", scope: "bogus" }),
    ).rejects.toThrow("Unsupported financial workspace scope: bogus");
    expect(rpc).not.toHaveBeenCalled();
  });

  test("throws on an RPC error instead of fabricating zero totals", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "Not authorized for this workspace." },
    }));
    const repository = new SupabaseDashboardFinancialSummaryRepository({
      supabaseClient: { rpc },
    });

    await expect(
      repository.getSummary({ ownerId: "owner-1" }),
    ).rejects.toMatchObject({
      message: "Not authorized for this workspace.",
    });
  });

  test("throws on a missing payload instead of fabricating zero totals", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const repository = new SupabaseDashboardFinancialSummaryRepository({
      supabaseClient: { rpc },
    });

    await expect(
      repository.getSummary({ ownerId: "owner-1" }),
    ).rejects.toThrow("Dashboard financial summary returned no data.");
  });

  test("throws on a version mismatch", async () => {
    const rpc = vi.fn(async () => ({
      data: summaryPayload({ version: "forge_dashboard_financial_summary_v2" }),
      error: null,
    }));
    const repository = new SupabaseDashboardFinancialSummaryRepository({
      supabaseClient: { rpc },
    });

    await expect(
      repository.getSummary({ ownerId: "owner-1" }),
    ).rejects.toThrow(
      "Unsupported dashboard financial summary version: forge_dashboard_financial_summary_v2",
    );
  });

  test("throws on a non-finite portfolio value", async () => {
    const payload = summaryPayload();
    payload.portfolio.income = "not-a-number";
    const rpc = vi.fn(async () => ({ data: payload, error: null }));
    const repository = new SupabaseDashboardFinancialSummaryRepository({
      supabaseClient: { rpc },
    });

    await expect(
      repository.getSummary({ ownerId: "owner-1" }),
    ).rejects.toThrow(
      "Dashboard financial summary field portfolio.income must be a finite number.",
    );
  });

  test("throws on a malformed property row", async () => {
    const payload = summaryPayload();
    payload.properties = [{ income: 1 }];
    const rpc = vi.fn(async () => ({ data: payload, error: null }));
    const repository = new SupabaseDashboardFinancialSummaryRepository({
      supabaseClient: { rpc },
    });

    await expect(
      repository.getSummary({ ownerId: "owner-1" }),
    ).rejects.toThrow(
      "Dashboard financial summary property is missing propertyId.",
    );
  });

  test("requires a Supabase client with rpc", () => {
    expect(
      () =>
        new SupabaseDashboardFinancialSummaryRepository({
          supabaseClient: {},
        }),
    ).toThrow(
      "SupabaseDashboardFinancialSummaryRepository requires a Supabase client.",
    );
  });
});
