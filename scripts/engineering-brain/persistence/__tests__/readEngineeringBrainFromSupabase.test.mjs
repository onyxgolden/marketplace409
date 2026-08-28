import { describe, expect, it } from "vitest";
import { fetchLatestRun, fetchRecordsForRun, fetchAllRecordsForRun, fetchExcludedForRun, countRecordsForRun, countExcludedForRun } from "../readEngineeringBrainFromSupabase.mjs";

function fakeQuery(result) {
  const calls = [];
  const builder = {
    select: (...args) => { calls.push(["select", args]); return builder; },
    eq: (...args) => { calls.push(["eq", args]); return builder; },
    order: (...args) => { calls.push(["order", args]); return builder; },
    limit: (...args) => { calls.push(["limit", args]); return builder; },
    range: (...args) => { calls.push(["range", args]); return builder; },
    maybeSingle: () => Promise.resolve(result),
    then: (resolve) => resolve(result),
  };
  builder.__calls = calls;
  return builder;
}

function fakeClient(table) {
  return { from: () => table };
}

// Fans out one fake query builder per `.range()` call, so pagination can be exercised page-by-page
// instead of every request seeing the same static result.
function fakePaginatedClient(pages) {
  const allCalls = [];
  let callIndex = 0;
  return {
    from: () => {
      const page = pages[Math.min(callIndex, pages.length - 1)];
      callIndex += 1;
      const builder = fakeQuery({ data: page, error: null });
      const originalThen = builder.then;
      builder.then = (resolve) => { allCalls.push(builder.__calls); return originalThen(resolve); };
      return builder;
    },
    __allCalls: allCalls,
  };
}

describe("fetchLatestRun", () => {
  it("orders by generated_at descending and takes one", async () => {
    const table = fakeQuery({ data: { id: "run_1", generated_at: "2026-01-02T00:00:00.000Z" }, error: null });
    const run = await fetchLatestRun(fakeClient(table));
    expect(run.id).toBe("run_1");
    expect(table.__calls).toContainEqual(["order", ["generated_at", { ascending: false }]]);
    expect(table.__calls).toContainEqual(["limit", [1]]);
  });

  it("propagates a query error", async () => {
    const table = fakeQuery({ data: null, error: { message: "db unreachable" } });
    await expect(fetchLatestRun(fakeClient(table))).rejects.toThrow(/db unreachable/);
  });
});

describe("fetchRecordsForRun", () => {
  it("scopes by run_id and applies optional filters", async () => {
    const table = fakeQuery({ data: [{ id: "record_0" }], error: null });
    const records = await fetchRecordsForRun(fakeClient(table), "run_1", { sourceType: "sql_rpc_function", authorityLevel: "current" });
    expect(records).toEqual([{ id: "record_0" }]);
    expect(table.__calls).toContainEqual(["eq", ["run_id", "run_1"]]);
    expect(table.__calls).toContainEqual(["eq", ["source_type", "sql_rpc_function"]]);
    expect(table.__calls).toContainEqual(["eq", ["authority_level", "current"]]);
  });

  it("does not apply a filter that was not requested", async () => {
    const table = fakeQuery({ data: [], error: null });
    await fetchRecordsForRun(fakeClient(table), "run_1");
    expect(table.__calls.some((call) => call[0] === "eq" && call[1][0] === "source_type")).toBe(false);
  });

  it("propagates a query error", async () => {
    const table = fakeQuery({ data: null, error: { message: "timeout" } });
    await expect(fetchRecordsForRun(fakeClient(table), "run_1")).rejects.toThrow(/timeout/);
  });
});

describe("fetchAllRecordsForRun", () => {
  it("returns every row on a single short page without a second request", async () => {
    const client = fakePaginatedClient([[{ id: "record_0" }, { id: "record_1" }]]);
    const records = await fetchAllRecordsForRun(client, "run_1", { pageSize: 1000 });
    expect(records).toEqual([{ id: "record_0" }, { id: "record_1" }]);
    expect(client.__allCalls).toHaveLength(1);
  });

  it("pages past a server-side row cap instead of silently truncating -- the exact bug this exists to prevent", async () => {
    const pageOne = Array.from({ length: 3 }, (_, i) => ({ id: `record_${i}` }));
    const pageTwo = [{ id: "record_3" }];
    const client = fakePaginatedClient([pageOne, pageTwo]);
    const records = await fetchAllRecordsForRun(client, "run_1", { pageSize: 3 });
    expect(records).toHaveLength(4);
    expect(records.map((r) => r.id)).toEqual(["record_0", "record_1", "record_2", "record_3"]);
    expect(client.__allCalls).toHaveLength(2);
    expect(client.__allCalls[0]).toContainEqual(["range", [0, 2]]);
    expect(client.__allCalls[1]).toContainEqual(["range", [3, 5]]);
  });

  it("orders by id for a stable cursor across pages", async () => {
    const client = fakePaginatedClient([[{ id: "record_0" }]]);
    await fetchAllRecordsForRun(client, "run_1", { pageSize: 1000 });
    expect(client.__allCalls[0]).toContainEqual(["order", ["id", { ascending: true }]]);
  });

  it("applies optional filters on every page", async () => {
    const client = fakePaginatedClient([[{ id: "record_0" }]]);
    await fetchAllRecordsForRun(client, "run_1", { sourceType: "sql_rpc_function", pageSize: 1000 });
    expect(client.__allCalls[0]).toContainEqual(["eq", ["source_type", "sql_rpc_function"]]);
  });

  it("propagates a query error", async () => {
    const table = fakeQuery({ data: null, error: { message: "timeout" } });
    await expect(fetchAllRecordsForRun(fakeClient(table), "run_1")).rejects.toThrow(/timeout/);
  });
});

describe("fetchExcludedForRun", () => {
  it("scopes by run_id", async () => {
    const table = fakeQuery({ data: [{ id: "excluded_0" }], error: null });
    const excluded = await fetchExcludedForRun(fakeClient(table), "run_1");
    expect(excluded).toEqual([{ id: "excluded_0" }]);
    expect(table.__calls).toContainEqual(["eq", ["run_id", "run_1"]]);
  });
});

describe("countRecordsForRun", () => {
  it("returns Postgres's own exact count, not the length of a possibly-truncated row fetch", async () => {
    const table = fakeQuery({ count: 4459, error: null });
    const count = await countRecordsForRun(fakeClient(table), "run_1");
    expect(count).toBe(4459);
    expect(table.__calls).toContainEqual(["select", ["*", { count: "exact", head: true }]]);
    expect(table.__calls).toContainEqual(["eq", ["run_id", "run_1"]]);
  });

  it("propagates a query error", async () => {
    const table = fakeQuery({ count: null, error: { message: "timeout" } });
    await expect(countRecordsForRun(fakeClient(table), "run_1")).rejects.toThrow(/timeout/);
  });
});

describe("countExcludedForRun", () => {
  it("returns the exact excluded-row count for a run", async () => {
    const table = fakeQuery({ count: 8, error: null });
    const count = await countExcludedForRun(fakeClient(table), "run_1");
    expect(count).toBe(8);
    expect(table.__calls).toContainEqual(["eq", ["run_id", "run_1"]]);
  });
});
