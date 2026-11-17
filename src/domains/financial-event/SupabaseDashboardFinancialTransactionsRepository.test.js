import { describe, expect, test, vi } from "vitest";

import {
  SupabaseDashboardFinancialTransactionsRepository,
} from "./SupabaseDashboardFinancialTransactionsRepository.js";

function transactionRow(overrides = {}) {
  return {
    id: "event-1",
    propertyId: "170-john",
    eventDate: "2026-01-05",
    description: "Rental income",
    amount: 1500,
    transactionKind: "income",
    category: "rental_income",
    affectsNOI: true,
    capitalized: false,
    sourceSystem: "rentec",
    sourceRecordId: "rentec-1",
    businessScope: "business",
    financialAccountId: null,
    ...overrides,
  };
}

function pagePayload(overrides = {}) {
  return {
    version: "forge_dashboard_financial_transactions_v1",
    status: "ok",
    ownerId: "owner-1",
    scope: "business",
    page: 1,
    pageSize: 1000,
    totalCount: 2,
    totalPages: 1,
    complete: true,
    transactions: [
      transactionRow({ id: "event-1" }),
      transactionRow({
        id: "event-2",
        eventDate: "2026-01-06",
        amount: 650,
        transactionKind: "expense",
        category: "repairs",
        affectsNOI: true,
      }),
    ],
    transactionsStatus: "loaded",
    ...overrides,
  };
}

describe("SupabaseDashboardFinancialTransactionsRepository", () => {
  test("calls the transactions RPC once with the resolved owner, scope and page", async () => {
    const rpc = vi.fn(async () => ({
      data: pagePayload({
        page: 2,
        pageSize: 250,
        totalCount: 500,
        totalPages: 2,
        complete: false,
      }),
      error: null,
    }));
    const repository = new SupabaseDashboardFinancialTransactionsRepository({
      supabaseClient: { rpc },
    });

    const page = await repository.getPage({
      ownerId: "owner-1",
      scope: "business",
      page: 2,
      pageSize: 250,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "forge_dashboard_financial_transactions_v1",
      {
        p_owner_id: "owner-1",
        p_scope: "business",
        p_page: 2,
        p_page_size: 250,
      },
    );
    expect(page.transactionsStatus).toBe("loaded");
    expect(page.page).toBe(2);
    expect(page.pageSize).toBe(250);
    expect(page.totalCount).toBe(500);
    expect(page.totalPages).toBe(2);
    expect(page.complete).toBe(false);
    expect(page.transactions).toHaveLength(2);
    expect(page.transactions[0].id).toBe("event-1");
    expect(Object.isFrozen(page)).toBe(true);
    expect(Object.isFrozen(page.transactions)).toBe(true);
  });

  test("passes null scope through for the unfiltered 'all' scope", async () => {
    const rpc = vi.fn(async () => ({
      data: pagePayload({ scope: null }),
      error: null,
    }));
    const repository = new SupabaseDashboardFinancialTransactionsRepository({
      supabaseClient: { rpc },
    });

    const page = await repository.getPage({
      ownerId: "owner-1",
      scope: "all",
    });

    expect(rpc).toHaveBeenCalledWith(
      "forge_dashboard_financial_transactions_v1",
      expect.objectContaining({ p_scope: null }),
    );
    expect(page.scope).toBe(null);
  });

  test("throws the RPC error instead of fabricating an empty page", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: new Error("database unavailable"),
    }));
    const repository = new SupabaseDashboardFinancialTransactionsRepository({
      supabaseClient: { rpc },
    });

    await expect(
      repository.getPage({ ownerId: "owner-1" }),
    ).rejects.toThrow("database unavailable");
  });

  test("rejects a wrong version, a non-ok status and a non-loaded status", async () => {
    const repository = new SupabaseDashboardFinancialTransactionsRepository({
      supabaseClient: {
        rpc: vi.fn(async () => ({
          data: pagePayload({ version: "forge_dashboard_financial_transactions_v0" }),
          error: null,
        })),
      },
    });
    await expect(
      repository.getPage({ ownerId: "owner-1" }),
    ).rejects.toThrow("Unsupported dashboard financial transactions version");

    const nonOk = new SupabaseDashboardFinancialTransactionsRepository({
      supabaseClient: {
        rpc: vi.fn(async () => ({
          data: pagePayload({ status: "error" }),
          error: null,
        })),
      },
    });
    await expect(
      nonOk.getPage({ ownerId: "owner-1" }),
    ).rejects.toThrow("non-ok status");

    const notLoaded = new SupabaseDashboardFinancialTransactionsRepository({
      supabaseClient: {
        rpc: vi.fn(async () => ({
          data: pagePayload({ transactionsStatus: "not-loaded" }),
          error: null,
        })),
      },
    });
    await expect(
      notLoaded.getPage({ ownerId: "owner-1" }),
    ).rejects.toThrow("non-loaded status");
  });

  test("rejects an unknown transaction kind instead of passing it through", async () => {
    const rpc = vi.fn(async () => ({
      data: pagePayload({
        transactions: [transactionRow({ transactionKind: "mystery" })],
      }),
      error: null,
    }));
    const repository = new SupabaseDashboardFinancialTransactionsRepository({
      supabaseClient: { rpc },
    });

    await expect(
      repository.getPage({ ownerId: "owner-1" }),
    ).rejects.toThrow(
      "Unsupported financial event transaction kind: mystery",
    );
  });

  test("a page past the end is a 400, never a silent empty page", async () => {
    const rpc = vi.fn(async () => ({
      data: pagePayload({ totalCount: 2, totalPages: 1, complete: true }),
      error: null,
    }));
    const repository = new SupabaseDashboardFinancialTransactionsRepository({
      supabaseClient: { rpc },
    });

    const error = await repository
      .getPage({ ownerId: "owner-1", page: 2 })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/page 2 does not exist/);
  });

  test("rejects an invalid owner, scope, page and pageSize before calling the RPC", async () => {
    const rpc = vi.fn(async () => ({ data: pagePayload(), error: null }));
    const repository = new SupabaseDashboardFinancialTransactionsRepository({
      supabaseClient: { rpc },
    });

    await expect(
      repository.getPage({ ownerId: "" }),
    ).rejects.toThrow("Owner id is required");
    await expect(
      repository.getPage({ ownerId: "owner-1", scope: "bogus" }),
    ).rejects.toThrow("Unsupported financial workspace scope");
    await expect(
      repository.getPage({ ownerId: "owner-1", page: 0 }),
    ).rejects.toThrow("positive integer");
    await expect(
      repository.getPage({ ownerId: "owner-1", pageSize: 1001 }),
    ).rejects.toThrow("between 1 and 1000");
    expect(rpc).not.toHaveBeenCalled();
  });

  test("requires a Supabase client with an rpc function", () => {
    expect(
      () =>
        new SupabaseDashboardFinancialTransactionsRepository({
          supabaseClient: {},
        }),
    ).toThrow("requires a Supabase client");
  });
});
