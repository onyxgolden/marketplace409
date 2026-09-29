import { describe, expect, it } from "vitest";
import { verifySync, SyncVerificationError } from "../verifySync.mjs";

function fakeQuery(result) {
  const calls = [];
  const builder = {
    select: (...args) => { calls.push(["select", args]); return builder; },
    eq: (...args) => { calls.push(["eq", args]); return builder; },
    maybeSingle: () => Promise.resolve(result),
    then: (resolve) => resolve(result),
  };
  builder.__calls = calls;
  return builder;
}

function fakeClient({ runResult, recordCountResult, excludedCountResult, bugFixCountResult }) {
  return {
    from: (table) => {
      if (table === "engineering_brain_runs") return fakeQuery(runResult);
      if (table === "engineering_brain_records") return fakeQuery(recordCountResult);
      if (table === "engineering_brain_excluded") return fakeQuery(excludedCountResult);
      if (table === "engineering_brain_bug_fixes") return fakeQuery(bugFixCountResult);
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function bugRecords(n) {
  return Array.from({ length: n }, (_, i) => ({ sha: `s${i}`, subject: "fix: x" }));
}

function sampleManifest(recordCount, excludedCount) {
  return {
    commit_sha: "sha1",
    index_content_hash: "hash1",
    records: Array.from({ length: recordCount }, () => ({})),
    excluded: Array.from({ length: excludedCount }, () => ({})),
  };
}

describe("verifySync", () => {
  it("passes when Supabase's counts match the manifest exactly", async () => {
    const client = fakeClient({
      runResult: { data: { id: "run_1" }, error: null },
      recordCountResult: { count: 3, error: null },
      excludedCountResult: { count: 1, error: null },
      bugFixCountResult: { count: 2, error: null },
    });
    const result = await verifySync({ supabaseClient: client, manifest: sampleManifest(3, 1), bugCatalogRecords: bugRecords(2) });
    expect(result).toEqual({ runId: "run_1", recordCount: 3, excludedCount: 1, bugFixCount: 2 });
  });

  it("throws when no matching run exists in Supabase at all", async () => {
    const client = fakeClient({
      runResult: { data: null, error: null },
      recordCountResult: { count: 0, error: null },
      excludedCountResult: { count: 0, error: null },
      bugFixCountResult: { count: 0, error: null },
    });
    await expect(verifySync({ supabaseClient: client, manifest: sampleManifest(3, 1), bugCatalogRecords: bugRecords(2) }))
      .rejects.toThrow(SyncVerificationError);
  });

  it("fails loudly on a record count mismatch rather than reporting false success", async () => {
    const client = fakeClient({
      runResult: { data: { id: "run_1" }, error: null },
      recordCountResult: { count: 2, error: null }, // manifest says 3 -- a batch silently dropped a row
      excludedCountResult: { count: 1, error: null },
      bugFixCountResult: { count: 2, error: null },
    });
    await expect(verifySync({ supabaseClient: client, manifest: sampleManifest(3, 1), bugCatalogRecords: bugRecords(2) }))
      .rejects.toThrow(/record count mismatch/);
  });

  it("fails loudly on an excluded count mismatch", async () => {
    const client = fakeClient({
      runResult: { data: { id: "run_1" }, error: null },
      recordCountResult: { count: 3, error: null },
      excludedCountResult: { count: 0, error: null },
      bugFixCountResult: { count: 2, error: null },
    });
    await expect(verifySync({ supabaseClient: client, manifest: sampleManifest(3, 1), bugCatalogRecords: bugRecords(2) }))
      .rejects.toThrow(/excluded count mismatch/);
  });

  it("treats a manifest with no excluded entries as expecting exactly zero, not skipping the check", async () => {
    const client = fakeClient({
      runResult: { data: { id: "run_1" }, error: null },
      recordCountResult: { count: 3, error: null },
      excludedCountResult: { count: 0, error: null },
      bugFixCountResult: { count: 0, error: null },
    });
    const manifest = { commit_sha: "sha1", index_content_hash: "hash1", records: [{}, {}, {}] };
    const result = await verifySync({ supabaseClient: client, manifest, bugCatalogRecords: [] });
    expect(result.excludedCount).toBe(0);
  });

  it("fails loudly on a bug-fix count mismatch rather than reporting false success", async () => {
    const client = fakeClient({
      runResult: { data: { id: "run_1" }, error: null },
      recordCountResult: { count: 3, error: null },
      excludedCountResult: { count: 1, error: null },
      bugFixCountResult: { count: 1, error: null }, // git history has 2 -- a batch silently dropped a row
    });
    await expect(verifySync({ supabaseClient: client, manifest: sampleManifest(3, 1), bugCatalogRecords: bugRecords(2) }))
      .rejects.toThrow(/bug-fix count mismatch/);
  });
});
