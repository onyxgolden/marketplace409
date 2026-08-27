import { describe, expect, it } from "vitest";
import {
  createSupabaseServiceClient,
  findExistingRun,
  manifestToRunRow,
  manifestRecordToRow,
  manifestExcludedToRow,
  syncManifestToSupabase,
} from "../syncManifestToSupabase.mjs";

function fakeTable(behaviors) {
  const calls = [];
  const builder = {
    select: (...args) => { calls.push(["select", args]); return builder; },
    eq: (...args) => { calls.push(["eq", args]); return builder; },
    limit: (...args) => { calls.push(["limit", args]); return builder; },
    maybeSingle: () => Promise.resolve(behaviors.maybeSingle ?? { data: null, error: null }),
    insert: (rows) => {
      calls.push(["insert", rows]);
      const behavior = behaviors.insert;
      return Promise.resolve(typeof behavior === "function" ? behavior(rows) : (behavior ?? { data: null, error: null }));
    },
  };
  builder.__calls = calls;
  return builder;
}

function fakeSupabaseClient(tables) {
  return { from: (tableName) => tables[tableName] };
}

describe("createSupabaseServiceClient", () => {
  it("throws a clear error when required env vars are missing, rather than a confusing SDK error later", () => {
    expect(() => createSupabaseServiceClient({ url: null, serviceRoleKey: null })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});

describe("row mapping (pure functions)", () => {
  it("manifestToRunRow maps every required column", () => {
    const manifest = { commit_sha: "sha1", extractor_version: 2, schema_version: "1.0", index_content_hash: "hash1", generated_at: "2026-01-01T00:00:00.000Z", counts: { indexed_total: 5 } };
    expect(manifestToRunRow(manifest, "run_1")).toEqual({
      id: "run_1", commit_sha: "sha1", extractor_version: 2, schema_version: "1.0",
      index_content_hash: "hash1", generated_at: "2026-01-01T00:00:00.000Z", counts: { indexed_total: 5 },
    });
  });

  it("manifestRecordToRow maps every field including nullable ones", () => {
    const record = { source_path: "a.js", source_type: "application_source_file", symbol_or_section: null, commit_sha: "sha1", content_hash: "h1", authority_level: "current", version: null, details: null };
    expect(manifestRecordToRow(record, "run_1", 0)).toEqual({
      run_id: "run_1", id: "record_0", source_path: "a.js", source_type: "application_source_file",
      symbol_or_section: null, commit_sha: "sha1", content_hash: "h1", authority_level: "current", version: null, details: null,
    });
  });

  it("manifestExcludedToRow maps path and reason", () => {
    expect(manifestExcludedToRow({ source_path: "a.js", reason: "lockfile" }, "run_1", 0)).toEqual({
      run_id: "run_1", id: "excluded_0", source_path: "a.js", reason: "lockfile",
    });
  });
});

describe("findExistingRun", () => {
  it("returns the run id when a matching commit + index_content_hash already exists", async () => {
    const table = fakeTable({ maybeSingle: { data: { id: "run_existing" }, error: null } });
    const result = await findExistingRun(fakeSupabaseClient({ engineering_brain_runs: table }), { commitSha: "sha1", indexContentHash: "hash1" });
    expect(result).toBe("run_existing");
  });

  it("returns null when no matching run exists", async () => {
    const table = fakeTable({ maybeSingle: { data: null, error: null } });
    const result = await findExistingRun(fakeSupabaseClient({ engineering_brain_runs: table }), { commitSha: "sha1", indexContentHash: "hash1" });
    expect(result).toBeNull();
  });

  it("throws with the underlying error message on a query failure", async () => {
    const table = fakeTable({ maybeSingle: { data: null, error: { message: "connection refused" } } });
    await expect(findExistingRun(fakeSupabaseClient({ engineering_brain_runs: table }), { commitSha: "sha1", indexContentHash: "hash1" }))
      .rejects.toThrow(/connection refused/);
  });
});

describe("syncManifestToSupabase", () => {
  function sampleManifest(recordCount = 3) {
    return {
      commit_sha: "sha1",
      extractor_version: 2,
      schema_version: "1.0",
      index_content_hash: "hash1",
      generated_at: "2026-01-01T00:00:00.000Z",
      counts: { indexed_total: recordCount },
      records: Array.from({ length: recordCount }, (_, i) => ({
        source_path: `src/lib/file${i}.js`, source_type: "application_source_file", symbol_or_section: null,
        commit_sha: "sha1", content_hash: `h${i}`, authority_level: "current", version: null, details: null,
      })),
      excluded: [{ source_path: "package-lock.json", reason: "lockfile" }],
    };
  }

  it("is idempotent: skips the sync entirely when this exact commit + index_content_hash was already synced", async () => {
    const runsTable = fakeTable({ maybeSingle: { data: { id: "run_existing" }, error: null } });
    const result = await syncManifestToSupabase({ supabaseClient: fakeSupabaseClient({ engineering_brain_runs: runsTable }), manifest: sampleManifest() });
    expect(result.skipped).toBe(true);
    expect(result.runId).toBe("run_existing");
    expect(runsTable.__calls.some((call) => call[0] === "insert")).toBe(false);
  });

  it("inserts a run row, then every record and excluded row tied to it, when no existing run matches", async () => {
    const runsTable = fakeTable({ maybeSingle: { data: null, error: null } });
    const recordsTable = fakeTable({});
    const excludedTable = fakeTable({});
    const result = await syncManifestToSupabase({
      supabaseClient: fakeSupabaseClient({ engineering_brain_runs: runsTable, engineering_brain_records: recordsTable, engineering_brain_excluded: excludedTable }),
      manifest: sampleManifest(3),
    });

    expect(result.skipped).toBe(false);
    expect(result.recordCount).toBe(3);
    expect(result.excludedCount).toBe(1);

    const runInsertCall = runsTable.__calls.find((call) => call[0] === "insert");
    expect(runInsertCall[1].commit_sha).toBe("sha1");

    const recordInsertCall = recordsTable.__calls.find((call) => call[0] === "insert");
    expect(recordInsertCall[1]).toHaveLength(3);
    expect(recordInsertCall[1][0].run_id).toBe(result.runId);
  });

  it("batches record inserts rather than sending everything in one call for a large manifest", async () => {
    const runsTable = fakeTable({ maybeSingle: { data: null, error: null } });
    const recordsTable = fakeTable({});
    const excludedTable = fakeTable({});
    await syncManifestToSupabase({
      supabaseClient: fakeSupabaseClient({ engineering_brain_runs: runsTable, engineering_brain_records: recordsTable, engineering_brain_excluded: excludedTable }),
      manifest: sampleManifest(1200),
    });
    const insertCalls = recordsTable.__calls.filter((call) => call[0] === "insert");
    expect(insertCalls.length).toBeGreaterThan(1);
    expect(insertCalls.every((call) => call[1].length <= 500)).toBe(true);
    expect(insertCalls.reduce((sum, call) => sum + call[1].length, 0)).toBe(1200);
  });

  it("propagates a record-insert failure rather than silently reporting partial success", async () => {
    const runsTable = fakeTable({ maybeSingle: { data: null, error: null } });
    const recordsTable = fakeTable({ insert: { data: null, error: { message: "insert failed" } } });
    const excludedTable = fakeTable({});
    await expect(syncManifestToSupabase({
      supabaseClient: fakeSupabaseClient({ engineering_brain_runs: runsTable, engineering_brain_records: recordsTable, engineering_brain_excluded: excludedTable }),
      manifest: sampleManifest(3),
    })).rejects.toThrow(/insert failed/);
  });
});
