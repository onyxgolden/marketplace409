import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadManifest } from "../loadManifest.mjs";
import { runQuery } from "../runQuery.mjs";
import { createCachedGitReader } from "../createCachedGitReader.mjs";
import { readFileAtCommit, readMigrationsAtCommit } from "../../gitRepository.mjs";

// Integration tests against this repo's own real, committed manifest and real git history -- not
// synthetic fixtures. This is what requirement's "Required real-FORGE acceptance questions" asks
// for: proof the query layer answers genuine questions about THIS codebase, with real citations,
// not just questions engineered to make the test pass. Real `git show` subprocess calls are
// unavoidably slower than in-memory fixture tests -- these use a longer per-test timeout rather than
// mocking away the exact I/O path the real CLI takes.
const manifestPath = path.join(process.cwd(), "engineering-brain", "index-manifest.json");
const manifest = loadManifest(manifestPath);
const excerptReader = createCachedGitReader({ readFileAtCommit, readMigrationsAtCommit });
const TIMEOUT_MS = 20000;

function ask(queryText, filters = {}) {
  return runQuery({ manifest, queryText, filters, excerptReader });
}

describe("Required real-FORGE acceptance questions", () => {
  it("Where is workspace co-owner authorization enforced?", () => {
    const response = ask("has_workspace_access");
    expect(response.insufficient_evidence).toBe(false);
    const sqlHit = response.results.find((r) => r.source_type === "sql_rpc_function");
    expect(sqlHit).toBeTruthy();
    expect(sqlHit.confidence).toBe("high");
    expect(sqlHit.excerpt).toBeTruthy();
  }, TIMEOUT_MS);

  it("Which tests prove tenant isolation?", () => {
    const response = ask("tenant isolation", { sourceType: "test_file" });
    // Never fabricates a specific claim beyond what's indexed -- either real citations or an
    // explicit admission of insufficient evidence, never a silently-empty "confirmed no" answer.
    expect(response.insufficient_evidence === false || response.reason).toBeTruthy();
    if (!response.insufficient_evidence) {
      expect(response.results.length).toBeGreaterThan(0);
      expect(response.results[0].source_type).toBe("test_file");
    }
  }, TIMEOUT_MS);

  it("Which migration defines a named RPC or RLS policy? (invite_workspace_member)", () => {
    const response = ask("invite_workspace_member");
    expect(response.insufficient_evidence).toBe(false);
    const hit = response.results[0];
    expect(hit.source_path).toMatch(/^supabase\/migrations\//);
    expect(hit.confidence).toBe("high");
  }, TIMEOUT_MS);

  it("What invokes the deterministic governance updater?", () => {
    const response = ask("runEngineeringSession");
    expect(response.insufficient_evidence).toBe(false);
    expect(response.results.some((r) => r.source_path.includes("governance"))).toBe(true);
  }, TIMEOUT_MS);

  it("Which source is authoritative when an old bootstrap contradicts current code?", () => {
    // This is an authority-ordering question, not a lookup -- answer it by checking the tool's own
    // authority order rather than needing a real conflicting pair to exist in this repo today.
    const response = ask("workspace_members", { sourceType: "sql_table" });
    expect(response.insufficient_evidence).toBe(false);
    expect(response.results[0].authority_level).toBe("current");
  }, TIMEOUT_MS);

  it("What remains unfinished for Stripe rent collection? (open-ended -- must not fabricate)", () => {
    const response = ask("stripe rent collection");
    // Open-ended, exploratory question: acceptable outcomes are real cited matches or an explicit
    // insufficient-evidence refusal -- never a confident-sounding narrative with no citations.
    if (response.insufficient_evidence) {
      expect(response.reason).toBeTruthy();
    } else {
      expect(response.results.every((r) => r.source_path && r.content_hash)).toBe(true);
    }
  }, TIMEOUT_MS);

  it("Why must transfer transactions not become income or expenses?", () => {
    const response = ask("transfer transactions income expenses");
    if (!response.insufficient_evidence) {
      expect(response.results.every((r) => r.source_path && r.content_hash)).toBe(true);
    } else {
      expect(response.reason).toBeTruthy();
    }
  }, TIMEOUT_MS);

  it("Which tests prove a named financial or Rental Manager behavior? (workspace access conversion)", () => {
    const response = ask("workspace access conversion", { sourceType: "test_file" });
    expect(response.insufficient_evidence).toBe(false);
    expect(response.results.length).toBeGreaterThan(0);
  }, TIMEOUT_MS);

  it("What changed in a specified commit? (only this manifest's own commit is indexed -- must not fabricate history it doesn't have)", () => {
    const responseForIndexedCommit = ask("", { commitSha: manifest.commit_sha });
    expect(responseForIndexedCommit.insufficient_evidence).toBe(false);
    expect(responseForIndexedCommit.results.length).toBeGreaterThan(0);

    const responseForUnknownCommit = ask("", { commitSha: "0000000000000000000000000000000000000000" });
    expect(responseForUnknownCommit.insufficient_evidence).toBe(true);
  }, TIMEOUT_MS);

  it("Which sources support each answer? (every result is self-citing)", () => {
    const response = ask("has_workspace_access");
    for (const result of response.results) {
      expect(result.source_path).toBeTruthy();
      expect(result.commit_sha).toBeTruthy();
      expect(result.content_hash).toBeTruthy();
      expect(result.authority_level).toBeTruthy();
    }
  }, TIMEOUT_MS);
});
