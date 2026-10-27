// Team Brain P2 fix round 5 — ChatGPT NO-GO re-review #4 2026-10-27
// (residuals TBP2-007D, TBP2-002D, TBP2-007E only; TBP2-001, TBP2-005,
// TBP2-003A, TBP2-004A, TBP2-006A.1, TBP2-002C and TBP2-007C ordering
// stay closed and are not re-litigated here). Every group below is a
// failing-before / passing-after probe at the public boundary: it
// fails against head 41bf751 and passes at the fix-round head.
// Synthetic fixtures only, real local Git repos only, no network,
// no DB, no production writes.
//
// TBP2-007D: frontier v2 serializes the whole accounted list and
// expands it into one Git ^<sha> argument per processed commit, so
// the continuation mechanism itself grows without bound. The fix is
// frontier v3: an accounted COUNT (not a list) within the fixed
// (head, base) range, a boundary-commit check proving the count
// maps to the same prefix, and a Git argument set of exactly [head,
// ^base]. Frontier size is capped explicitly (512 bytes).
// TBP2-002D: handleEnvelope read envelope.operation (tier + handler
// lookup) and verifyAndAuthorize read envelope.key_id (resolveKey)
// before descriptor validation, so an ordinary accessor getter
// executed before admission. The fix runs the shared closed,
// descriptor-safe validateEnvelope before ANY field read on both
// public paths — the same validator, not a parallel one.
// TBP2-007E: collectCommitPaths stored every skipped path in seen
// and in per-parent status maps, so a resumed poll retained the
// whole consumed prefix alongside its new paths (102 retained for
// a 100-file budget). The fix resumes by stream position (parent
// index + stream offset, counted never stored); skipped parents are
// never iterated, and a later parent's duplicate of a skipped
// parent is detected by a bounded per-path Git membership query.

import { describe, it, expect, afterEach } from "vitest";
import { generateKeyPairSync, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEnvelope } from "../transport/envelope.mjs";
import {
  createRegistry,
  registerKey,
  grantAuthorization,
  verifyAndAuthorize,
} from "../transport/registry.mjs";
import { createApi, handleEnvelope } from "../transport/logicalApi.mjs";
import { scanSince, headCommit } from "../transport/gitShadowImporter.mjs";
import { TeamBrainTrustError, CODES } from "../transport/errors.mjs";

const ADMIN = { origin: "jason-admin" };
const T0 = "2026-10-26T12:00:00Z";

function keypair() {
  return generateKeyPairSync("ed25519");
}

function expectCode(fn, code) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(TeamBrainTrustError);
    expect(e.code).toBe(code);
    return e;
  }
  throw new Error(`expected TeamBrainTrustError with code ${code}`);
}

function setupPrincipal({ principalId = "muse", grantedOps = ["submit_task"], resourceScope = "*" } = {}) {
  const registry = createRegistry();
  const { publicKey, privateKey } = keypair();
  const keyId = `${principalId}-key`;
  registerKey(registry, ADMIN, { keyId, principalId, publicKey, registeredBy: "jason-admin" });
  grantAuthorization(registry, ADMIN, {
    grantId: `grant-${principalId}`,
    principalId,
    resourceRepo: "onyxgolden/forge-ai-drop",
    resourceScope,
    allowedOperations: grantedOps,
  });
  return { registry, publicKey, privateKey, keyId, principalId };
}

function envelopeFor({ principalId, keyId, privateKey, operation = "submit_task", resource, payload, operationId, nonce, issuedAt }) {
  return buildEnvelope(
    {
      operationId: operationId ?? `op-${principalId}-1`,
      principalId,
      keyId,
      issuedAt: issuedAt ?? T0,
      operation,
      resource: resource ?? { repo: "onyxgolden/forge-ai-drop", scope: "lane-a" },
      nonce: nonce ?? "n1",
      payload: payload ?? { note: "hello" },
    },
    privateKey
  );
}

function setupApi({ principalId = "muse" } = {}) {
  const { registry, publicKey, privateKey, keyId } = setupPrincipal({ principalId });
  const received = [];
  const api = createApi(registry, {
    submit_task: (payload) => {
      received.push(payload);
      return { ok: true };
    },
  });
  return { api, registry, publicKey, privateKey, keyId, principalId, received };
}

// ---------------------------------------------------------------- git --
const createdDirs = [];
afterEach(() => {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function run(repo, args, opts = {}) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", ...opts });
}
function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), "tb-fixround5-"));
  createdDirs.push(dir);
  run(dir, ["init", "-q", "-b", "main"]);
  run(dir, ["config", "user.email", "test@example.com"]);
  run(dir, ["config", "user.name", "Test"]);
  return dir;
}
function writeAndCommit(repo, relPath, content, message) {
  const full = join(repo, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  run(repo, ["add", relPath]);
  run(repo, ["commit", "-q", "-m", message]);
  return headCommit(repo);
}
function writeFilesAndCommit(repo, files, message) {
  for (const [relPath, content] of files) {
    const full = join(repo, relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
    run(repo, ["add", relPath]);
  }
  run(repo, ["commit", "-q", "-m", message]);
  return headCommit(repo);
}
// Runs scanSince with Map.prototype.set instrumented, so the test can
// assert exactly which scoped paths were RETAINED in status maps
// during that poll (the TBP2-007E observable). Returns { result,
// mapPaths } where mapPaths is the set of scoped path arguments seen.
function scanInstrumented(repo, opts) {
  const mapPaths = new Set();
  const originalSet = Map.prototype.set;
  Map.prototype.set = function (k, v) {
    if (typeof k === "string" && k.startsWith("commands/")) mapPaths.add(k);
    return originalSet.call(this, k, v);
  };
  try {
    return { result: scanSince(repo, opts), mapPaths };
  } finally {
    Map.prototype.set = originalSet;
  }
}

// ------------------------------------------------------------ TBP2-002D --
describe("TBP2-002D accessors must never execute before admission", () => {
  it("an operation accessor getter is never invoked by handleEnvelope", () => {
    const { api, privateKey, keyId, principalId, received } = setupApi();
    const env = envelopeFor({ principalId, keyId, privateKey });
    let invocations = 0;
    Object.defineProperty(env, "operation", {
      get() {
        invocations += 1;
        return "submit_task";
      },
      enumerable: true,
      configurable: true,
    });
    expectCode(() => handleEnvelope(api, env), CODES.MALFORMED_ENVELOPE);
    expect(invocations).toBe(0);
    expect(received).toHaveLength(0);
  });

  it("a key_id accessor getter is never invoked by verifyAndAuthorize", () => {
    const { registry, privateKey, keyId, principalId } = setupPrincipal();
    const env = envelopeFor({ principalId, keyId, privateKey });
    let invocations = 0;
    Object.defineProperty(env, "key_id", {
      get() {
        invocations += 1;
        return keyId;
      },
      enumerable: true,
      configurable: true,
    });
    expectCode(() => verifyAndAuthorize(registry, env), CODES.MALFORMED_ENVELOPE);
    expect(invocations).toBe(0);
  });

  it("valid signed envelopes still dispatch after admission-first", () => {
    const { api, privateKey, keyId, principalId, received } = setupApi();
    const env = envelopeFor({ principalId, keyId, privateKey });
    const result = handleEnvelope(api, env);
    expect(result).toEqual({ ok: true });
    expect(received).toHaveLength(1);
  });
});

// ------------------------------------------------------------ TBP2-007D --
describe("TBP2-007D frontier and Git arguments must stay bounded", () => {
  it("frontier size stays under the explicit cap and does not grow with pages", () => {
    const repo = initRepo();
    const seed = writeAndCommit(repo, "commands/seed.md", "seed\n", "seed");
    // 2,000 empty commits plus a tail ask: three pages at the 1,000
    // commit cap. Under v2 the first frontier alone would carry
    // 1,000 SHAs (~41,000 chars) and the second ~82,000.
    const seedTree = run(repo, ["rev-parse", `${seed}^{tree}`]).trim();
    let parent = seed;
    for (let i = 0; i < 2000; i += 1) {
      parent = run(repo, ["commit-tree", seedTree, "-p", parent, "-m", `empty-${i}`]).trim();
    }
    const seedBlob = run(repo, ["rev-parse", `${seed}:commands/seed.md`]).trim();
    const tailBlob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo, input: "tail\n", encoding: "utf8" }).trim();
    const commandsSubtree = execFileSync("git", ["mktree"], {
      cwd: repo,
      input: `100644 blob ${seedBlob}\tseed.md\n100644 blob ${tailBlob}\ttail.md\n`,
      encoding: "utf8",
    }).trim();
    const rootTree = execFileSync("git", ["mktree"], {
      cwd: repo,
      input: `040000 tree ${commandsSubtree}\tcommands\n`,
      encoding: "utf8",
    }).trim();
    const tailCommit = run(repo, ["commit-tree", rootTree, "-p", parent, "-m", "tail"]).trim();
    run(repo, ["update-ref", "refs/heads/main", tailCommit]);
    const head = headCommit(repo);
    const first = scanSince(repo, { cursorCommit: seed, scopePaths: ["commands/"] });
    expect(first.truncated).toBe(true);
    expect(typeof first.resumeFrontier).toBe("string");
    expect(first.resumeFrontier.length).toBeLessThanOrEqual(512);
    const second = scanSince(repo, { cursorCommit: first.resumeFrontier, scopePaths: ["commands/"] });
    expect(second.truncated).toBe(true);
    expect(typeof second.resumeFrontier).toBe("string");
    expect(second.resumeFrontier.length).toBeLessThanOrEqual(512);
    // Same format, same field widths: no growth with pages at all.
    expect(second.resumeFrontier.length).toBe(first.resumeFrontier.length);
    const third = scanSince(repo, { cursorCommit: second.resumeFrontier, scopePaths: ["commands/"] });
    expect(third.truncated).toBe(false);
    expect(third.newCursor).toBe(head);
    const tailEvents = third.events.filter((e) => e.path === "commands/tail.md");
    expect(tailEvents.length).toBe(1);
    expect(tailEvents[0].eventKind).toBe("ADDED");
  }, 180000);

  it("a legacy v2 frontier is refused, not reinterpreted", () => {
    const repo = initRepo();
    const seed = writeAndCommit(repo, "commands/seed.md", "seed\n", "seed");
    writeAndCommit(repo, "commands/next.md", "next\n", "next");
    const head = headCommit(repo);
    const scopeHash = createHash("sha256").update(JSON.stringify(["commands/"]), "utf8").digest("hex");
    const legacy = `tb-frontier:v2:${head}:${scopeHash}:${seed}:::`;
    expectCode(() => scanSince(repo, { cursorCommit: legacy, scopePaths: ["commands/"] }), CODES.INTAKE_BLOCKED);
  });
});

// ------------------------------------------------------------ TBP2-007E --
describe("TBP2-007E retained candidates must stay within budget on resume", () => {
  it("a 102-file commit retains only its new paths on the second page", () => {
    const repo = initRepo();
    const seed = writeAndCommit(repo, "commands/seed.md", "seed\n", "seed");
    const files = [];
    for (let i = 0; i < 102; i += 1) files.push([`commands/f${String(i).padStart(3, "0")}.md`, `body ${i}\n`]);
    writeFilesAndCommit(repo, files, "102 files");
    const first = scanSince(repo, { cursorCommit: seed, scopePaths: ["commands/"] });
    expect(first.truncated).toBe(true);
    expect(first.events.length).toBe(100);
    const firstPaths = new Set(first.events.map((e) => e.path));
    const { result: second, mapPaths } = scanInstrumented(repo, {
      cursorCommit: first.resumeFrontier,
      scopePaths: ["commands/"],
    });
    expect(second.truncated).toBe(false);
    expect(second.events.length).toBe(2);
    // The verdict's exact observation: under the old skipped-prefix
    // retention, poll 2 stored 102 distinct scoped paths; now it
    // stores only the 2 newly admitted ones — never a prefix path.
    expect(mapPaths.size).toBeLessThanOrEqual(100);
    for (const p of mapPaths) expect(firstPaths.has(p)).toBe(false);
    const allPaths = new Set([...firstPaths, ...second.events.map((e) => e.path)]);
    expect(allPaths.size).toBe(102);
  });

  it("a merge partial resumed past its first parent emits no duplicate and retains no prefix", () => {
    const repo = initRepo();
    const seed = writeAndCommit(repo, "commands/x.md", "v0\n", "seed");
    // Side branch: x -> p1, plus b.md.
    run(repo, ["checkout", "-q", "-b", "side"]);
    writeAndCommit(repo, "commands/x.md", "p1\n", "side x");
    writeAndCommit(repo, "commands/b.md", "b\n", "side b");
    // Main branch: x -> p0, plus a.md.
    run(repo, ["checkout", "-q", "main"]);
    writeAndCommit(repo, "commands/x.md", "p0\n", "main x");
    writeAndCommit(repo, "commands/a.md", "a\n", "main a");
    // Merge, resolving x.md to content differing from BOTH parents
    // (a true merge resolution: x differs from both parents' blobs).
    let merged = false;
    try {
      run(repo, ["merge", "--no-ff", "side", "-m", "merge"]);
      merged = true;
    } catch {
      // Conflict on x.md is expected; resolve it explicitly.
    }
    if (!merged) {
      writeFileSync(join(repo, "commands/x.md"), "merged\n");
      run(repo, ["add", "commands/x.md"]);
      run(repo, ["commit", "-q", "-m", "merge"]);
    }
    const head = headCommit(repo);
    // Drive polls at a 2-file budget until caught up, instrumenting
    // every poll's retained status-map paths.
    let cursor = seed;
    const mergeEvents = [];
    let mergeResumeMapPaths = null;
    let mergeResumePoll = null;
    for (let i = 0; i < 10; i += 1) {
      const { result, mapPaths } = scanInstrumented(repo, {
        cursorCommit: cursor,
        scopePaths: ["commands/"],
        maxChangedFilesPerPoll: 2,
      });
      const mEvents = result.events.filter((e) => e.introducingCommit === head);
      if (mEvents.length > 0) mergeEvents.push(...mEvents);
      // The poll that resumes the merge commit is the one whose
      // frontier (from the previous poll) names the merge commit as
      // a partial: it is the first poll after the merge's first page.
      // Detect it as the poll after a truncated poll that already
      // produced merge events but did not complete the merge.
      if (mergeEvents.length > 0 && result.truncated === false && mergeResumeMapPaths === null) {
        mergeResumeMapPaths = mapPaths;
        mergeResumePoll = i;
      }
      if (!result.truncated) {
        expect(result.newCursor).toBe(head);
        break;
      }
      cursor = result.resumeFrontier;
    }
    // The merge emits exactly one event (x.md MODIFIED: a.md and b.md
    // are clean introduction visibility, silent by design). The
    // query-deduped resume must NOT re-emit x.md a second time.
    const xEvents = mergeEvents.filter((e) => e.path === "commands/x.md");
    expect(xEvents.length).toBe(1);
    expect(xEvents[0].eventKind).toBe("MODIFIED");
    // Retention on the merge's resume poll: only paths admitted in
    // that poll, never the prefix (b.md, x.md) from the first page.
    expect(mergeResumePoll).not.toBeNull();
    expect(mergeResumeMapPaths.size).toBeLessThanOrEqual(2);
    expect(mergeResumeMapPaths.has("commands/b.md")).toBe(false);
    expect(mergeResumeMapPaths.has("commands/x.md")).toBe(false);
  }, 120000);
});
