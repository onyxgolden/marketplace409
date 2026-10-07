// End-to-end regression (Slice 4 review fix): a real git repository on disk, with a committed
// manifest that is actually wrong for the commit it claims. Proves two things through real git and
// filesystem I/O, not mocks: runValidation() detects the mismatch, and it does not write anything --
// neither the manifest it read nor any other file in the repository changes.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { runValidation } from "../validateProductionManifest.mjs";

const tempDirs = [];

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

/** A minimal real repository with one commit, for runValidation to inspect through git. */
function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-slice4-e2e-"));
  tempDirs.push(dir);
  git(["init", "-q"], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "Test"], dir);
  fs.writeFileSync(path.join(dir, "README.md"), "hello\n");
  git(["add", "."], dir);
  git(["-c", "commit.gpgsign=false", "commit", "-q", "-m", "init"], dir);
  const commitSha = git(["rev-parse", "HEAD"], dir).trim();
  return { dir, commitSha };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("runValidation: end-to-end against a real repository", () => {
  it("detects a committed manifest that does not match a fresh build of its own commit, and writes nothing", () => {
    const { dir, commitSha } = makeTempRepo();
    const brainDir = path.join(dir, "engineering-brain");
    fs.mkdirSync(brainDir, { recursive: true });
    const manifestPath = path.join(brainDir, "index-manifest.json");
    // Deliberately wrong: records that a real build of this tiny repo would never produce.
    const staleManifest = {
      schema_version: 1,
      extractor_version: 1,
      commit_sha: commitSha,
      records: [{ source_path: "this/path/does/not/exist.md", source_type: "canonical_document_file", symbol_or_section: null, commit_sha: commitSha, content_hash: "fake", content_tokens: [], authority_level: "canonical_document", version: null, details: null }],
      excluded: [],
      out_of_scope_paths: [],
      deleted_paths: [],
      file_blob_shas: {},
      index_content_hash: "fake",
      generated_at: "2026-01-01T00:00:00.000Z",
      counts: { indexed_total: 1, excluded_total: 0, out_of_scope_total: 0, deleted_total: 0, indexed_by_source_type: {}, indexed_by_authority_level: {} },
      coverage_issues: [],
    };
    const before = JSON.stringify(staleManifest, null, 2) + "\n";
    fs.writeFileSync(manifestPath, before);
    const listingBefore = fs.readdirSync(dir, { recursive: true }).sort();
    const mtimeBefore = fs.statSync(manifestPath).mtimeMs;

    const result = runValidation(dir);

    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/does not accurately reproduce a fresh build of its own recorded commit/);

    // Nothing was written: same bytes, same mtime, same file listing (no index-report.md or anything
    // else appeared).
    expect(fs.readFileSync(manifestPath, "utf8")).toBe(before);
    expect(fs.statSync(manifestPath).mtimeMs).toBe(mtimeBefore);
    expect(fs.readdirSync(dir, { recursive: true }).sort()).toEqual(listingBefore);
  });

  it("fails when there is no committed manifest at all, and still writes nothing", () => {
    const { dir } = makeTempRepo();
    const listingBefore = fs.readdirSync(dir, { recursive: true }).sort();
    const result = runValidation(dir);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/missing/);
    expect(fs.readdirSync(dir, { recursive: true }).sort()).toEqual(listingBefore);
  });
});
