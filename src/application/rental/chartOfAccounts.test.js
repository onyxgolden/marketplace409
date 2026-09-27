import { describe, expect, it } from "vitest";
import {
  ChartUnavailableError,
  isChartTableMissing,
  resolvePostingCategories,
} from "./chartOfAccounts";

// Minimal chainable fake of the supabase client used by the chart module:
// from().select().eq() for reads, from().insert() for the seed write.
function fakeClient({ seedRead, accountsRead, insertError = null } = {}) {
  let selectCalls = 0;
  const makeChain = () => {
    selectCalls += 1;
    const result = selectCalls === 1 ? seedRead : accountsRead;
    const chain = {
      eq: () => chain,
      order: () => ({ order: () => Promise.resolve(result) }),
      // The seed read awaits the chain directly (real client is thenable).
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  };
  return {
    from: () => ({
      select: () => makeChain(),
      insert: async () => ({ error: insertError }),
    }),
  };
}

const seedRow = { code: "property_repairs" };
const accountRows = [
  { id: "1", code: "property_repairs", label: "Repairs", account_type: "expense", is_active: true, is_system: true },
  { id: "2", code: "utilities", label: "Utilities", account_type: "expense", is_active: false, is_system: true },
];

describe("isChartTableMissing", () => {
  it("detects the Postgres undefined_table code", () => {
    expect(isChartTableMissing({ code: "42P01", message: "anything" })).toBe(true);
  });
  it("detects the relation-does-not-exist message", () => {
    expect(isChartTableMissing({ message: 'relation "chart_of_accounts" does not exist' })).toBe(true);
  });
  it("rejects unrelated errors", () => {
    expect(isChartTableMissing({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isChartTableMissing(new Error("connection reset"))).toBe(false);
    expect(isChartTableMissing(null)).toBe(false);
  });
});

describe("resolvePostingCategories", () => {
  it("returns the owner's active codes when the chart reads fine", async () => {
    const client = fakeClient({
      seedRead: { data: [seedRow], error: null },
      accountsRead: { data: accountRows, error: null },
    });
    const codes = await resolvePostingCategories(client, "owner_1");
    expect(codes).toEqual(["property_repairs"]);
  });

  it("returns null (legacy mode) when the chart table is missing", async () => {
    const client = fakeClient({
      seedRead: { data: null, error: { code: "42P01", message: "relation does not exist" } },
    });
    await expect(resolvePostingCategories(client, "owner_1")).resolves.toBeNull();
  });

  it("throws ChartUnavailableError on a transient read failure", async () => {
    const client = fakeClient({
      seedRead: { data: null, error: new Error("connection reset") },
    });
    await expect(resolvePostingCategories(client, "owner_1")).rejects.toBeInstanceOf(ChartUnavailableError);
  });

  it("throws ChartUnavailableError when the seed insert fails", async () => {
    const client = fakeClient({
      seedRead: { data: [], error: null },
      insertError: new Error("deadlock"),
    });
    await expect(resolvePostingCategories(client, "owner_1")).rejects.toBeInstanceOf(ChartUnavailableError);
  });
});
