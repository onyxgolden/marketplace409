import { describe, expect, it } from "vitest";
import { createCachedGitReader } from "../createCachedGitReader.mjs";

describe("createCachedGitReader", () => {
  it("only calls the underlying reader once per (commit, path) pair", () => {
    let fileCalls = 0;
    const reader = createCachedGitReader({
      readFileAtCommit: () => { fileCalls += 1; return "content"; },
      readMigrationsAtCommit: () => [],
    });
    reader.readFileAtCommit("sha1", "a.js");
    reader.readFileAtCommit("sha1", "a.js");
    reader.readFileAtCommit("sha1", "b.js");
    expect(fileCalls).toBe(2);
  });

  it("only calls the underlying migrations reader once per commit", () => {
    let migrationCalls = 0;
    const reader = createCachedGitReader({
      readFileAtCommit: () => null,
      readMigrationsAtCommit: () => { migrationCalls += 1; return []; },
    });
    reader.readMigrationsAtCommit("sha1");
    reader.readMigrationsAtCommit("sha1");
    reader.readMigrationsAtCommit("sha2");
    expect(migrationCalls).toBe(2);
  });
});
