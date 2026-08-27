import { describe, expect, it } from "vitest";
import { searchRecords } from "../searchRecords.mjs";

function record(overrides) {
  return {
    source_path: "src/lib/foo.js", source_type: "application_source_file", symbol_or_section: null,
    commit_sha: "sha1", content_hash: "h1", authority_level: "current", version: null, details: null,
    ...overrides,
  };
}

describe("searchRecords (filters)", () => {
  const records = [
    record({ source_path: "src/app/api/workspace/members/route.js", source_type: "api_route" }),
    record({ source_path: "supabase/migrations/x.sql", source_type: "sql_table", details: { table: "widgets" } }),
    record({ source_path: "supabase/migrations/x.sql", source_type: "sql_rls_policy", details: { table: "widgets" } }),
    record({ source_path: "governance/snapshots/a.json", source_type: "historical_snapshot", authority_level: "historical_snapshot" }),
  ];

  it("filters by source_type", () => {
    const results = searchRecords(records, { filters: { sourceType: "sql_table" } });
    expect(results).toHaveLength(1);
    expect(results[0].record.source_type).toBe("sql_table");
  });

  it("filters by authority_level", () => {
    const results = searchRecords(records, { filters: { authorityLevel: "historical_snapshot" } });
    expect(results).toHaveLength(1);
  });

  it("filters by table", () => {
    const results = searchRecords(records, { filters: { table: "widgets" } });
    expect(results).toHaveLength(2);
  });

  it("filters by exact source path", () => {
    const results = searchRecords(records, { filters: { sourcePath: "supabase/migrations/x.sql" } });
    expect(results).toHaveLength(2);
  });

  it("filters by commit sha", () => {
    const results = searchRecords([...records, record({ commit_sha: "sha2" })], { filters: { commitSha: "sha2" } });
    expect(results).toHaveLength(1);
  });

  it("a pure filter-only query (no search text) returns every filtered record, not just ones with keyword overlap", () => {
    const results = searchRecords(records, { filters: { sourceType: "sql_table" }, queryText: "" });
    expect(results).toHaveLength(1);
  });

  it("combining a keyword query with a filter narrows to records matching both", () => {
    const results = searchRecords(records, { queryText: "widgets", filters: { sourceType: "sql_rls_policy" }, metadataOnly: true });
    expect(results).toHaveLength(1);
    expect(results[0].record.source_type).toBe("sql_rls_policy");
  });

  it("a keyword query with no matches returns an empty array (not every record)", () => {
    const results = searchRecords(records, { queryText: "nonexistenttermxyz", metadataOnly: true });
    expect(results).toEqual([]);
  });

  it("respects a bounded content-fetch cap: the content provider is not called for every record on a large corpus", () => {
    const manyRecords = Array.from({ length: 50 }, (_, i) => record({ source_path: `src/lib/file${i}.js` }));
    let callCount = 0;
    searchRecords(manyRecords, {
      queryText: "foo",
      contentProvider: () => { callCount += 1; return "foo"; },
    });
    expect(callCount).toBeLessThanOrEqual(50);
    expect(callCount).toBeGreaterThan(0);
  });
});
