import { describe, expect, test } from "vitest";

import {
  DIAGNOSTIC_PAGE_SIZE_MAX,
  buildDiagnosticPage,
  parseDiagnosticPageParams,
} from "./transactionDiagnostics.js";

function transactions(count) {
  return Array.from({ length: count }, (_, index) => ({ id: `event-${index}` }));
}

describe("parseDiagnosticPageParams", () => {
  test("defaults to page 1 and a 1000-row page", () => {
    expect(
      parseDiagnosticPageParams(new URLSearchParams()),
    ).toEqual({ page: 1, pageSize: 1000 });
  });

  test("accepts explicit page and pageSize", () => {
    expect(
      parseDiagnosticPageParams(
        new URLSearchParams("page=3&pageSize=250"),
      ),
    ).toEqual({ page: 3, pageSize: 250 });
  });

  test("rejects a non-positive page with a 400 status", () => {
    const error = (() => {
      try {
        parseDiagnosticPageParams(new URLSearchParams("page=0"));
      } catch (caught) {
        return caught;
      }
      return null;
    })();

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(400);
  });

  test("rejects a pageSize above the cap with a 400 status", () => {
    const error = (() => {
      try {
        parseDiagnosticPageParams(
          new URLSearchParams(
            `pageSize=${DIAGNOSTIC_PAGE_SIZE_MAX + 1}`,
          ),
        );
      } catch (caught) {
        return caught;
      }
      return null;
    })();

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(400);
  });
});

describe("buildDiagnosticPage", () => {
  // Fix round (diagnostic endpoint): the page result now comes from the
  // server-side paginated RPC, not from a full in-memory list. The
  // response shape and paging semantics are unchanged.
  test("pages the full list with complete/total semantics", () => {
    const rows = transactions(2501);

    const first = buildDiagnosticPage({
      pageResult: {
        transactions: rows.slice(0, 1000),
        totalCount: 2501,
        totalPages: 3,
        complete: false,
      },
      page: 1,
      pageSize: 1000,
    });

    expect(first.transactions).toHaveLength(1000);
    expect(first.totalCount).toBe(2501);
    expect(first.totalPages).toBe(3);
    expect(first.complete).toBe(false);
    expect(first.transactionsStatus).toBe("loaded");

    const last = buildDiagnosticPage({
      pageResult: {
        transactions: rows.slice(2000),
        totalCount: 2501,
        totalPages: 3,
        complete: true,
      },
      page: 3,
      pageSize: 1000,
    });

    expect(last.transactions).toHaveLength(501);
    expect(last.complete).toBe(true);
  });

  test("an empty history is one complete empty page, not an error", () => {
    const page = buildDiagnosticPage({
      pageResult: {
        transactions: [],
        totalCount: 0,
        totalPages: 1,
        complete: true,
      },
      page: 1,
      pageSize: 1000,
    });

    expect(page.transactions).toEqual([]);
    expect(page.totalCount).toBe(0);
    expect(page.totalPages).toBe(1);
    expect(page.complete).toBe(true);
  });

  test("a page past the end is a 400, never a silent empty page", () => {
    const error = (() => {
      try {
        buildDiagnosticPage({
          pageResult: {
            transactions: transactions(10),
            totalCount: 10,
            totalPages: 1,
            complete: false,
          },
          page: 2,
          pageSize: 1000,
        });
      } catch (caught) {
        return caught;
      }
      return null;
    })();

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(400);
  });

  test("a malformed page result is an error, never a fabricated page", () => {
    expect(() =>
      buildDiagnosticPage({
        pageResult: { transactions: [], totalCount: 10 },
        page: 1,
        pageSize: 1000,
      }),
    ).toThrow("Diagnostic transactions must be a page result.");
  });
});
