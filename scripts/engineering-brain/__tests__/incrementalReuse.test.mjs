import { describe, expect, it } from "vitest";
import { partitionFilesForIncrementalBuild, findDeletedPaths } from "../incrementalReuse.mjs";

const EXTRACTOR_VERSION = 7;

function fakeManifest({ fileBlobShas, records, extractorVersion = EXTRACTOR_VERSION }) {
  return { file_blob_shas: fileBlobShas, records, extractor_version: extractorVersion };
}

describe("incremental content hashes", () => {
  it("with no previous manifest, every file needs full processing", () => {
    const files = [{ path: "a.js", blobSha: "sha-a" }, { path: "b.js", blobSha: "sha-b" }];
    const { toProcess, reusableRecordsByPath } = partitionFilesForIncrementalBuild(files, null, EXTRACTOR_VERSION);
    expect(toProcess).toEqual(files);
    expect(reusableRecordsByPath.size).toBe(0);
  });

  it("a file whose git blob sha is unchanged from the previous manifest is reused, not reprocessed", () => {
    const previous = fakeManifest({
      fileBlobShas: { "a.js": "sha-a", "b.js": "sha-b" },
      records: [
        { source_path: "a.js", source_type: "application_source_file", symbol_or_section: null },
        { source_path: "b.js", source_type: "application_source_file", symbol_or_section: null },
      ],
    });
    const files = [{ path: "a.js", blobSha: "sha-a" }, { path: "b.js", blobSha: "sha-b-CHANGED" }];
    const { toProcess, reusableRecordsByPath } = partitionFilesForIncrementalBuild(files, previous, EXTRACTOR_VERSION);

    expect(toProcess.map((f) => f.path)).toEqual(["b.js"]);
    expect(reusableRecordsByPath.has("a.js")).toBe(true);
    expect(reusableRecordsByPath.get("a.js")).toHaveLength(1);
  });

  it("SQL migrations are never reused even when their blob sha is unchanged -- a later migration can still change what 'current' means for an object an earlier, untouched migration defined", () => {
    const previous = fakeManifest({
      fileBlobShas: { "supabase/migrations/0001_init.sql": "sha-migration" },
      records: [{ source_path: "supabase/migrations/0001_init.sql", source_type: "sql_migration_file", symbol_or_section: null }],
    });
    const files = [{ path: "supabase/migrations/0001_init.sql", blobSha: "sha-migration" }];
    const { toProcess } = partitionFilesForIncrementalBuild(files, previous, EXTRACTOR_VERSION);
    expect(toProcess).toEqual(files);
  });

  it("deleted-source handling: a path present in the previous manifest but absent from the current tree is reported as deleted", () => {
    const previous = fakeManifest({
      fileBlobShas: { "a.js": "sha-a", "removed.js": "sha-removed" },
      records: [],
    });
    const files = [{ path: "a.js", blobSha: "sha-a" }];
    expect(findDeletedPaths(files, previous)).toEqual(["removed.js"]);
  });

  it("a deleted file's prior records are never carried forward as reusable", () => {
    const previous = fakeManifest({
      fileBlobShas: { "removed.js": "sha-removed" },
      records: [{ source_path: "removed.js", source_type: "application_source_file", symbol_or_section: null }],
    });
    const files = [];
    const { reusableRecordsByPath } = partitionFilesForIncrementalBuild(files, previous, EXTRACTOR_VERSION);
    expect(reusableRecordsByPath.size).toBe(0);
  });

  it("an extractor version mismatch forces a full rebuild even when every file's blob sha is unchanged -- fixing an extraction bug must actually take effect", () => {
    const previous = fakeManifest({
      fileBlobShas: { "a.js": "sha-a" },
      records: [{ source_path: "a.js", source_type: "application_source_file", symbol_or_section: null }],
      extractorVersion: EXTRACTOR_VERSION - 1,
    });
    const files = [{ path: "a.js", blobSha: "sha-a" }];
    const { toProcess, reusableRecordsByPath } = partitionFilesForIncrementalBuild(files, previous, EXTRACTOR_VERSION);
    expect(toProcess).toEqual(files);
    expect(reusableRecordsByPath.size).toBe(0);
  });
});
