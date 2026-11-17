import { describe, expect, test, vi } from "vitest";

import {
  loadAllDiagnosticTransactions,
} from "./dashboardTransactionDiagnostics.js";

function pageResponse({ rows, page, totalCount, totalPages, complete }) {
  return {
    ok: true,
    json: async () => ({
      success: true,
      transactions: rows,
      page,
      pageSize: 1000,
      totalCount,
      totalPages,
      complete,
      transactionsStatus: "loaded",
    }),
  };
}

describe("loadAllDiagnosticTransactions", () => {
  test("loads every page until complete and returns the full list", async () => {
    const fetcher = vi.fn(async (url) => {
      const page = Number(new URL(url, "http://localhost").searchParams.get("page"));

      if (page === 1) {
        return pageResponse({
          rows: [{ id: "a" }],
          page: 1,
          totalCount: 2,
          totalPages: 2,
          complete: false,
        });
      }

      return pageResponse({
        rows: [{ id: "b" }],
        page: 2,
        totalCount: 2,
        totalPages: 2,
        complete: true,
      });
    });

    const result = await loadAllDiagnosticTransactions({ fetcher });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      transactions: [{ id: "a" }, { id: "b" }],
      totalCount: 2,
    });
  });

  test("a single complete page needs no second fetch", async () => {
    const fetcher = vi.fn(async () =>
      pageResponse({
        rows: [],
        page: 1,
        totalCount: 0,
        totalPages: 1,
        complete: true,
      }),
    );

    const result = await loadAllDiagnosticTransactions({ fetcher });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.totalCount).toBe(0);
  });

  test("rejects a stub that returns only the first 1000 of 2501 as complete", async () => {
    const fetcher = vi.fn(async () =>
      pageResponse({
        rows: Array.from({ length: 1000 }, (_, index) => ({
          id: `event-${index}`,
        })),
        page: 1,
        totalCount: 2501,
        totalPages: 3,
        complete: true,
      }),
    );

    await expect(
      loadAllDiagnosticTransactions({ fetcher }),
    ).rejects.toThrow(
      "Transaction history is incomplete: loaded 1000 of 2501 transactions.",
    );
  });

  test("rejects a page stream that never marks a page complete", async () => {
    const fetcher = vi.fn(async (url) => {
      const page = Number(new URL(url, "http://localhost").searchParams.get("page"));

      return pageResponse({
        rows: [{ id: `page-${page}` }],
        page,
        totalCount: 2,
        totalPages: 2,
        complete: false,
      });
    });

    await expect(
      loadAllDiagnosticTransactions({ fetcher }),
    ).rejects.toThrow(
      "Transaction history is incomplete: the server did not finish the list.",
    );
  });

  test("rejects a totalCount that changes mid-load", async () => {
    const fetcher = vi.fn(async (url) => {
      const page = Number(new URL(url, "http://localhost").searchParams.get("page"));

      if (page === 1) {
        return pageResponse({
          rows: [{ id: "a" }],
          page: 1,
          totalCount: 2,
          totalPages: 2,
          complete: false,
        });
      }

      return pageResponse({
        rows: [{ id: "b" }],
        page: 2,
        totalCount: 3,
        totalPages: 2,
        complete: true,
      });
    });

    await expect(
      loadAllDiagnosticTransactions({ fetcher }),
    ).rejects.toThrow(
      "Transaction history changed while loading; reload to retry.",
    );
  });

  test("surfaces a server error instead of an empty history", async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: "Unable to load transaction history." }),
    }));

    await expect(
      loadAllDiagnosticTransactions({ fetcher }),
    ).rejects.toThrow("Unable to load transaction history.");
  });
});
