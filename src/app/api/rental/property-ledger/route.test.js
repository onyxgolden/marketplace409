import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
vi.mock("@/domains/rentec-financial-history-import/fetchAllOwnerFinancialEvents", () => ({
  fetchAllOwnerFinancialEvents: vi.fn(),
}));

import { fetchAllPages } from "./route";

// Fake PostgREST chain: every filter method returns the chain, range() resolves
// the requested slice of the canned rows. Range calls are recorded so page
// boundaries can be asserted.
function fakeClient(allRows, { failOnPage = -1 } = {}) {
  const rangeCalls = [];
  const makeChain = (pageIndex) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      or: () => chain,
      order: () => chain,
      range: (start, end) => {
        rangeCalls.push([start, end]);
        if (pageIndex === failOnPage) {
          return Promise.resolve({ data: null, error: new Error("boom") });
        }
        return Promise.resolve({ data: allRows.slice(start, end + 1), error: null });
      },
    };
    return chain;
  };
  let pageIndex = 0;
  return {
    rangeCalls,
    from: () => makeChain(pageIndex++),
  };
}

describe("fetchAllPages", () => {
  it("pages through more than one PostgREST page and returns every row", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: `row_${i}` }));
    const client = fakeClient(rows);
    const result = await fetchAllPages(() =>
      client.from("rental_payments").select("id").eq("owner_id", "o1").order("id", { ascending: true }),
    );
    expect(result).toHaveLength(2500);
    expect(result[0]).toEqual({ id: "row_0" });
    expect(result[2499]).toEqual({ id: "row_2499" });
    // Page boundaries: 0-999, 1000-1999, 2000-2999 (short page ends the loop).
    expect(client.rangeCalls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("returns a single short page without extra requests", async () => {
    const rows = Array.from({ length: 42 }, (_, i) => ({ id: `row_${i}` }));
    const client = fakeClient(rows);
    const result = await fetchAllPages(() => client.from("rental_leases").select("id"));
    expect(result).toHaveLength(42);
    expect(client.rangeCalls).toEqual([[0, 999]]);
  });

  it("throws when a page errors", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: `row_${i}` }));
    const client = fakeClient(rows, { failOnPage: 1 });
    await expect(fetchAllPages(() => client.from("rental_tenants").select("id"))).rejects.toThrow("boom");
  });
});
