import { describe, expect, it } from "vitest";
import { fetchLatestRun, fetchRecordsForRun, fetchExcludedForRun } from "../readEngineeringBrainFromSupabase.mjs";

function fakeQuery(result) {
  const calls = [];
  const builder = {
    select: (...args) => { calls.push(["select", args]); return builder; },
    eq: (...args) => { calls.push(["eq", args]); return builder; },
    order: (...args) => { calls.push(["order", args]); return builder; },
    limit: (...args) => { calls.push(["limit", args]); return builder; },
    maybeSingle: () => Promise.resolve(result),
    then: (resolve) => resolve(result),
  };
  builder.__calls = calls;
  return builder;
}

function fakeClient(table) {
  return { from: () => table };
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

describe("fetchExcludedForRun", () => {
  it("scopes by run_id", async () => {
    const table = fakeQuery({ data: [{ id: "excluded_0" }], error: null });
    const excluded = await fetchExcludedForRun(fakeClient(table), "run_1");
    expect(excluded).toEqual([{ id: "excluded_0" }]);
    expect(table.__calls).toContainEqual(["eq", ["run_id", "run_1"]]);
  });
});
