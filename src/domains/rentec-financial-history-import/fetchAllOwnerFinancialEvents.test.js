import { describe, expect, it, vi } from "vitest";
import { fetchAllOwnerFinancialEvents } from "./fetchAllOwnerFinancialEvents.js";

function row(id) {
  return { id, event_date: "2021-01-01", amount: 1, transaction_kind: "income" };
}

function mockDatabase(pages) {
  let callIndex = 0;
  const calls = [];
  return {
    from: (table) => {
      if (table !== "financial_events") throw new Error(`Unexpected table: ${table}`);
      const eqCalls = [];
      const node = {
        eq: (...args) => { eqCalls.push(args); return node; },
        range: (start, end) => {
          calls.push({ start, end, eqCalls: [...eqCalls] });
          const data = pages[callIndex] || [];
          callIndex += 1;
          return Promise.resolve({ data, error: null });
        },
      };
      return { select: () => node };
    },
    __calls: calls,
  };
}

describe("fetchAllOwnerFinancialEvents", () => {
  it("returns everything in a single page when there are fewer rows than the page size", async () => {
    const database = mockDatabase([[row("a"), row("b")]]);
    const rows = await fetchAllOwnerFinancialEvents(database, "owner_1");
    expect(rows).toEqual([row("a"), row("b")]);
    expect(database.__calls).toHaveLength(1);
  });

  it("paginates across multiple pages until a short page is returned", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => row(`row_${i}`));
    const lastPage = [row("last_1"), row("last_2")];
    const database = mockDatabase([fullPage, lastPage]);
    const rows = await fetchAllOwnerFinancialEvents(database, "owner_1");
    expect(rows).toHaveLength(1002);
    expect(rows[1000]).toEqual(row("last_1"));
    expect(database.__calls).toEqual([
      { start: 0, end: 999, eqCalls: [["owner_id", "owner_1"]] },
      { start: 1000, end: 1999, eqCalls: [["owner_id", "owner_1"]] },
    ]);
  });

  it("stops after an exact-page-size-multiple total by seeing one final empty page", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => row(`row_${i}`));
    const database = mockDatabase([fullPage, []]);
    const rows = await fetchAllOwnerFinancialEvents(database, "owner_1");
    expect(rows).toHaveLength(1000);
    expect(database.__calls).toHaveLength(2);
  });

  it("scopes every page to the given owner id", async () => {
    const database = mockDatabase([[row("a")]]);
    await fetchAllOwnerFinancialEvents(database, "owner_42");
    expect(database.__calls[0].eqCalls).toEqual([["owner_id", "owner_42"]]);
  });

  it("propagates a database error instead of silently returning a partial result", async () => {
    const database = {
      from: () => ({
        select: () => ({
          eq: () => ({ range: () => Promise.resolve({ data: null, error: new Error("boom") }) }),
        }),
      }),
    };
    await expect(fetchAllOwnerFinancialEvents(database, "owner_1")).rejects.toThrow("boom");
  });

  it("returns an empty array when the owner has no rows at all", async () => {
    const database = mockDatabase([[]]);
    const rows = await fetchAllOwnerFinancialEvents(database, "owner_1");
    expect(rows).toEqual([]);
  });
});
