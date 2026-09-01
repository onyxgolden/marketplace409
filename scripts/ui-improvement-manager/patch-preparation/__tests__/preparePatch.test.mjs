import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { preparePatch, PatchPreparationAuthorityDeniedError } from "../preparePatch.mjs";
import { FileOutOfScopeError } from "../fileScopeGuard.mjs";
import { computeProposalDigest } from "../proposalContracts.mjs";

const OWNER = "jasonmorgan99@gmail.com";
const NOW = "2026-09-01T12:00:00.000Z";

let scratchRoot;
let repoRoot;
let worktreeRoot;
let baseSha;

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

beforeEach(() => {
  scratchRoot = mkdtempSync(path.join(tmpdir(), "fb-ui-34-prepare-"));
  repoRoot = path.join(scratchRoot, "repo");
  worktreeRoot = path.join(scratchRoot, "worktrees");
  execFileSync("mkdir", ["-p", repoRoot]);
  execFileSync("mkdir", ["-p", worktreeRoot]);
  git(["init", "--quiet", "--initial-branch=main"], repoRoot);
  git(["config", "user.email", "test@example.com"], repoRoot);
  git(["config", "user.name", "Test"], repoRoot);
  execFileSync("mkdir", ["-p", path.join(repoRoot, "src/components/home")]);
  writeFileSync(path.join(repoRoot, "src/components/home/HomePetOfWeek.js"), "export default function HomePetOfWeek() { return null; }\n");
  git(["add", "."], repoRoot);
  git(["commit", "--quiet", "-m", "initial"], repoRoot);
  baseSha = git(["rev-parse", "HEAD"], repoRoot).trim();
});

afterEach(() => { rmSync(scratchRoot, { recursive: true, force: true }); });

function proposal(overrides = {}) {
  const base = {
    proposalId: "proposal_1", findingIds: ["finding_1"], objective: "Increase touch target.",
    allowedPaths: ["src/components/home/HomePetOfWeek.js"], forbiddenPaths: [],
    fileEdits: [{ path: "src/components/home/HomePetOfWeek.js", content: "export default function HomePetOfWeek() { return \"patched\"; }\n" }],
  };
  const merged = { ...base, ...overrides };
  return { ...merged, digest: computeProposalDigest(merged) };
}

function approvalFor(p, overrides = {}) {
  return {
    approverId: OWNER, proposalId: p.proposalId, proposalDigest: p.digest,
    grantedAt: "2026-09-01T11:00:00.000Z", expiresAt: "2026-09-01T13:00:00.000Z", ...overrides,
  };
}

describe("preparePatch", () => {
  it("prepares a patch end-to-end: creates a worktree, applies the edit, captures the diff, and cleans up", async () => {
    const p = proposal();
    const result = await preparePatch({ proposal: p, approval: approvalFor(p), callerEmail: OWNER, repoRoot, baseSha, now: NOW, worktreeRoot });
    expect(result.diffText).toContain("patched");
    expect(result.files).toHaveLength(1);
    expect(result.files[0].isNewFile).toBe(false);
    expect(result.files[0].beforeHash).toMatch(/^sha256:/);
    expect(result.files[0].afterHash).toMatch(/^sha256:/);
    expect(existsSync(result.worktreePath)).toBe(false); // cleaned up by default
    expect(git(["rev-parse", "HEAD"], repoRoot).trim()).toBe(baseSha); // source repo never touched
  });

  it("keeps the worktree on disk when keepWorktree is true, with the edit actually written", async () => {
    const p = proposal();
    const result = await preparePatch({ proposal: p, approval: approvalFor(p), callerEmail: OWNER, repoRoot, baseSha, now: NOW, worktreeRoot, keepWorktree: true });
    expect(existsSync(result.worktreePath)).toBe(true);
    expect(readFileSync(path.join(result.worktreePath, "src/components/home/HomePetOfWeek.js"), "utf8")).toContain("patched");
  });

  it("never runs git commit or git push -- rule 7", async () => {
    const p = proposal();
    const result = await preparePatch({ proposal: p, approval: approvalFor(p), callerEmail: OWNER, repoRoot, baseSha, now: NOW, worktreeRoot, keepWorktree: true });
    for (const command of result.commands) {
      expect(command.command).not.toMatch(/\bcommit\b/);
      expect(command.command).not.toMatch(/\bpush\b/);
    }
    // Also confirm no commit was actually made in the worktree beyond the base commit.
    expect(git(["log", "--oneline"], result.worktreePath).trim().split("\n")).toHaveLength(1);
  });

  it("denies preparation for an unrelated caller before ever creating a worktree", async () => {
    const p = proposal();
    await expect(preparePatch({ proposal: p, approval: approvalFor(p, { approverId: "stranger@example.com" }), callerEmail: "stranger@example.com", repoRoot, baseSha, now: NOW, worktreeRoot }))
      .rejects.toThrow(PatchPreparationAuthorityDeniedError);
  });

  // Required test: out-of-scope file modification (end-to-end, not just the unit-level guard)
  it("refuses and cleans up when a fileEdit somehow targets a path outside the approved allowlist", async () => {
    // A proposal cannot itself be constructed this way (proposalContracts.mjs's own validation
    // requires every fileEdits path to be within allowedPaths) -- this proves preparePatch.mjs's own
    // independent re-check catches it too, defense in depth, exactly as documented in its header.
    const p = proposal();
    const tampered = { ...p, allowedPaths: ["src/components/home/HomePetOfWeek.js"], fileEdits: [{ path: "src/components/home/HomeCategories.js", content: "x" }] };
    await expect(preparePatch({ proposal: tampered, approval: approvalFor(p), callerEmail: OWNER, repoRoot, baseSha, now: NOW, worktreeRoot }))
      .rejects.toThrow(FileOutOfScopeError);
  });

  // Required test: prohibited-file modification (end-to-end)
  it("refuses a fileEdit targeting a permanently protected path even if listed in allowedPaths", async () => {
    execFileSync("mkdir", ["-p", path.join(repoRoot, "supabase/migrations")]);
    writeFileSync(path.join(repoRoot, "supabase/migrations/x.sql"), "-- noop\n");
    git(["add", "."], repoRoot);
    git(["commit", "--quiet", "-m", "add migration"], repoRoot);
    const shaWithMigration = git(["rev-parse", "HEAD"], repoRoot).trim();

    const draft = {
      proposalId: "proposal_2", findingIds: ["finding_1"], objective: "x",
      allowedPaths: ["supabase/migrations/x.sql"], forbiddenPaths: [],
      fileEdits: [{ path: "supabase/migrations/x.sql", content: "drop table users;\n" }],
    };
    const p = { ...draft, digest: computeProposalDigest(draft) };
    await expect(preparePatch({ proposal: p, approval: approvalFor(p), callerEmail: OWNER, repoRoot, baseSha: shaWithMigration, now: NOW, worktreeRoot }))
      .rejects.toThrow(FileOutOfScopeError);
  });

  // Required test: exact retry
  it("exact retry: preparing the same approved proposal twice produces identical file hashes and diff content", async () => {
    const p = proposal();
    const first = await preparePatch({ proposal: p, approval: approvalFor(p), callerEmail: OWNER, repoRoot, baseSha, now: NOW, worktreeRoot });
    const second = await preparePatch({ proposal: p, approval: approvalFor(p), callerEmail: OWNER, repoRoot, baseSha, now: NOW, worktreeRoot });
    expect(second.diffHash).toBe(first.diffHash);
    expect(second.files[0].afterHash).toBe(first.files[0].afterHash);
    // But the branch/worktree identity is still fresh each time -- a retry never reuses state.
    expect(second.branchName).not.toBe(first.branchName);
    expect(second.worktreePath).not.toBe(first.worktreePath);
  });

  it("cleans up the worktree even when preparation fails partway through", async () => {
    const p = proposal();
    const tampered = { ...p, fileEdits: [{ path: "src/components/home/HomeCategories.js", content: "x" }] };
    let worktreePathAttempted;
    try {
      await preparePatch({
        proposal: tampered, approval: approvalFor(p), callerEmail: OWNER, repoRoot, baseSha, now: NOW, worktreeRoot, keepWorktree: true,
      });
    } catch (error) {
      // FileOutOfScopeError doesn't carry the worktree path, so confirm cleanup indirectly: no
      // fb-ui-patch-* directories were left behind in worktreeRoot after the failure.
      expect(error).toBeInstanceOf(FileOutOfScopeError);
    }
    const leftoverEntries = existsSync(worktreeRoot) ? execFileSync("ls", [worktreeRoot], { encoding: "utf8" }).trim() : "";
    expect(leftoverEntries).toBe("");
  });
});
