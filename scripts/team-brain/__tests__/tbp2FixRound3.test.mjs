// Team Brain P2 fix round 3 — ChatGPT NO-GO re-review #2 2026-10-26
// (residuals TBP2-002B/006A.1/007B; TBP2-001, TBP2-005, TBP2-003A and
// TBP2-004A stay closed and are not re-litigated here). Every group
// below is a failing-before / passing-after probe at the public
// boundary: it fails against head 88f0876 and passes at the fix-round
// head. Synthetic fixtures only, real local Git repos only, no
// network, no DB, no production writes.

import { describe, it, expect, afterEach } from "vitest";
import { generateKeyPairSync, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEnvelope, verifyEnvelopeSignature } from "../transport/envelope.mjs";
import {
  createRegistry,
  registerKey,
  grantAuthorization,
} from "../transport/registry.mjs";
import { createApi, handleEnvelope } from "../transport/logicalApi.mjs";
import { scanSince, headCommit } from "../transport/gitShadowImporter.mjs";
import { TeamBrainTrustError, CODES } from "../transport/errors.mjs";

const ADMIN = { origin: "jason-admin" };
const T0 = "2026-10-26T12:00:00Z";
const HEAD_A = "a".repeat(40);

function keypair() {
  return generateKeyPairSync("ed25519");
}

function expectCode(fn, code) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.then(
        () => {
          throw new Error(`expected TeamBrainTrustError with code ${code}`);
        },
        (e) => {
          expect(e).toBeInstanceOf(TeamBrainTrustError);
          expect(e.code).toBe(code);
          return e;
        }
      );
    }
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

// ---------------------------------------------------------------- git --
const createdDirs = [];
afterEach(() => {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function run(repo, args, opts = {}) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", ...opts });
}
function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), "tb-fixround3-"));
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
function sha256Text(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ------------------------------------------------------------ TBP2-002B --
describe("TBP2-002B object entrypoint must admit only the JSON value domain", () => {
  it("an own undefined field added to a signed payload cannot verify", () => {
    const { publicKey, privateKey, keyId, principalId } = setupPrincipal();
    const env = envelopeFor({ principalId, keyId, privateKey, payload: {} });
    const alteredPayload = {};
    alteredPayload.approved = undefined;
    const altered = { ...env, payload: alteredPayload };
    expectCode(() => verifyEnvelopeSignature(altered, publicKey), CODES.MALFORMED_ENVELOPE);
  });

  it("an own function field added to a signed payload cannot verify", () => {
    const { publicKey, privateKey, keyId, principalId } = setupPrincipal();
    const env = envelopeFor({ principalId, keyId, privateKey, payload: {} });
    const alteredPayload = {};
    alteredPayload.approved = () => true;
    const altered = { ...env, payload: alteredPayload };
    expectCode(() => verifyEnvelopeSignature(altered, publicKey), CODES.MALFORMED_ENVELOPE);
  });

  it("an own symbol-valued field added to a signed payload cannot verify", () => {
    const { publicKey, privateKey, keyId, principalId } = setupPrincipal();
    const env = envelopeFor({ principalId, keyId, privateKey, payload: {} });
    const alteredPayload = {};
    alteredPayload.approved = Symbol("approved");
    const altered = { ...env, payload: alteredPayload };
    expectCode(() => verifyEnvelopeSignature(altered, publicKey), CODES.MALFORMED_ENVELOPE);
  });

  it("an own symbol key added to a signed payload cannot verify", () => {
    const { publicKey, privateKey, keyId, principalId } = setupPrincipal();
    const env = envelopeFor({ principalId, keyId, privateKey, payload: {} });
    const alteredPayload = {};
    alteredPayload[Symbol("approved")] = true;
    const altered = { ...env, payload: alteredPayload };
    expectCode(() => verifyEnvelopeSignature(altered, publicKey), CODES.MALFORMED_ENVELOPE);
  });

  it("a nested undefined field and an array undefined element cannot verify", () => {
    const { publicKey, privateKey, keyId, principalId } = setupPrincipal();
    const env = envelopeFor({ principalId, keyId, privateKey, payload: { inner: {} } });
    const nested = {};
    nested.approved = undefined;
    expectCode(
      () => verifyEnvelopeSignature({ ...env, payload: { inner: nested } }, publicKey),
      CODES.MALFORMED_ENVELOPE
    );
    const arr = [];
    arr[0] = undefined;
    expectCode(
      () => verifyEnvelopeSignature({ ...env, payload: { items: arr } }, publicKey),
      CODES.MALFORMED_ENVELOPE
    );
  });

  it("an accessor field cannot verify, and its getter is not invoked by validation", () => {
    const { publicKey, privateKey, keyId, principalId } = setupPrincipal();
    const env = envelopeFor({ principalId, keyId, privateKey, payload: {} });
    let getterCalled = false;
    const alteredPayload = {};
    Object.defineProperty(alteredPayload, "approved", {
      enumerable: true,
      get() {
        getterCalled = true;
        return true;
      },
    });
    expectCode(
      () => verifyEnvelopeSignature({ ...env, payload: alteredPayload }, publicKey),
      CODES.MALFORMED_ENVELOPE
    );
    expect(getterCalled).toBe(false);
  });

  it("class instances, Dates, Maps and bigints in a payload cannot verify", () => {
    const { publicKey, privateKey, keyId, principalId } = setupPrincipal();
    const env = envelopeFor({ principalId, keyId, privateKey, payload: {} });
    class Fake {
      constructor() {
        this.note = "hello";
      }
    }
    expectCode(
      () => verifyEnvelopeSignature({ ...env, payload: new Fake() }, publicKey),
      CODES.MALFORMED_ENVELOPE
    );
    expectCode(
      () => verifyEnvelopeSignature({ ...env, payload: { when: new Date() } }, publicKey),
      CODES.MALFORMED_ENVELOPE
    );
    expectCode(
      () => verifyEnvelopeSignature({ ...env, payload: { m: new Map() } }, publicKey),
      CODES.MALFORMED_ENVELOPE
    );
    expectCode(
      () => verifyEnvelopeSignature({ ...env, payload: { n: 10n } }, publicKey),
      CODES.MALFORMED_ENVELOPE
    );
  });

  it("an altered unsigned field never reaches a handler", () => {
    const { registry, privateKey, keyId, principalId } = setupPrincipal();
    const env = envelopeFor({ principalId, keyId, privateKey, payload: {} });
    const alteredPayload = {};
    alteredPayload.approved = undefined;
    const altered = { ...env, payload: alteredPayload };
    let handlerCalled = false;
    const api = createApi(registry, {
      submit_task: () => {
        handlerCalled = true;
        return { ok: true };
      },
    });
    expectCode(() => handleEnvelope(api, altered), CODES.MALFORMED_ENVELOPE);
    expect(handlerCalled).toBe(false);
  });

  it("a null-prototype JSON-data payload and an ordinary JSON payload still verify", () => {
    const { publicKey, privateKey, keyId, principalId } = setupPrincipal();
    const nullProto = Object.create(null);
    nullProto.note = "hello";
    const env = envelopeFor({ principalId, keyId, privateKey, payload: nullProto });
    expect(() => verifyEnvelopeSignature(env, publicKey)).not.toThrow();
    const plain = envelopeFor({ principalId, keyId, privateKey, payload: { note: "hello", n: 1, ok: true, list: [1, null] } });
    expect(() => verifyEnvelopeSignature(plain, publicKey)).not.toThrow();
  });
});

// ------------------------------------------------------------ TBP2-006A.1 --
describe("TBP2-006A.1 keep-versus-delete merge decisions are preserved", () => {
  function mergeKeepDelete({ currentIsMain = true } = {}) {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/task.md", "base\n", "base");
    run(repo, ["checkout", "-q", "-b", "side"]);
    run(repo, ["rm", "-q", "commands/task.md"]);
    run(repo, ["commit", "-q", "-m", "side deletes"]);
    run(repo, ["checkout", "-q", "main"]);
    writeAndCommit(repo, "commands/task.md", "main keep\n", "main modifies");
    if (!currentIsMain) {
      // Reverse parent order: merge main into side, resolving to main keep.
      run(repo, ["checkout", "-q", "side"]);
      try {
        run(repo, ["merge", "--no-ff", "main", "-m", "merge main"]);
      } catch {
        // conflict expected
      }
    } else {
      try {
        run(repo, ["merge", "--no-ff", "side", "-m", "merge side"]);
      } catch {
        // conflict expected
      }
    }
    // Resolve by keeping "main keep" (the main branch's content).
    writeFileSync(join(repo, "commands/task.md"), "main keep\n");
    run(repo, ["add", "commands/task.md"]);
    run(repo, ["commit", "-q", "-m", "resolve keep"]);
    return { repo, base, mergeCommit: headCommit(repo) };
  }

  it("a modify/delete merge resolved by keeping the file emits MERGE_SELECTED with provenance fields, not a trailing DELETED", () => {
    const { repo, base, mergeCommit } = mergeKeepDelete();
    const { events } = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"] });
    const forPath = events.filter((e) => e.path === "commands/task.md");
    const last = forPath[forPath.length - 1];
    expect(last.eventKind).toBe("MERGE_SELECTED");
    expect(last.introducingCommit).toBe(mergeCommit);
    expect(last.contentSha256).toBe(sha256Text("main keep\n"));
    expect(typeof last.selectedBlob).toBe("string");
    expect(last.selectedBlob.length).toBe(40);
    expect(typeof last.selectedParent).toBe("string");
    expect(Array.isArray(last.selectedParents)).toBe(true);
    expect(last.selectedParents.length).toBeGreaterThan(0);
    expect(typeof last.originalSourceCommit).toBe("string");
  });

  it("the reverse parent order also emits MERGE_SELECTED for the kept file", () => {
    const { repo, base, mergeCommit } = mergeKeepDelete({ currentIsMain: false });
    const { events } = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"] });
    const forPath = events.filter((e) => e.path === "commands/task.md");
    const last = forPath[forPath.length - 1];
    expect(last.eventKind).toBe("MERGE_SELECTED");
    expect(last.introducingCommit).toBe(mergeCommit);
    expect(last.contentSha256).toBe(sha256Text("main keep\n"));
  });

  it("a modify/delete merge resolved by deleting the file emits DELETED at the merge, not MERGE_SELECTED", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/task.md", "base\n", "base");
    run(repo, ["checkout", "-q", "-b", "side"]);
    run(repo, ["rm", "-q", "commands/task.md"]);
    run(repo, ["commit", "-q", "-m", "side deletes"]);
    run(repo, ["checkout", "-q", "main"]);
    writeAndCommit(repo, "commands/task.md", "main keep\n", "main modifies");
    try {
      run(repo, ["merge", "--no-ff", "side", "-m", "merge side"]);
    } catch {
      // conflict expected
    }
    run(repo, ["rm", "-q", "commands/task.md"]);
    run(repo, ["commit", "-q", "-m", "resolve delete"]);
    const mergeCommit = headCommit(repo);
    const { events } = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"] });
    const forPath = events.filter((e) => e.path === "commands/task.md");
    const last = forPath[forPath.length - 1];
    expect(last.eventKind).toBe("DELETED");
    expect(last.introducingCommit).toBe(mergeCommit);
  });

  it("a clean single-content merge still emits no merge event for an unchanged side introduction", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/base.md", "base\n", "base");
    run(repo, ["checkout", "-q", "-b", "side"]);
    const sideCommit = writeAndCommit(repo, "commands/new.md", "new\n", "side adds");
    run(repo, ["checkout", "-q", "main"]);
    writeAndCommit(repo, "commands/other.md", "other\n", "main unrelated");
    run(repo, ["merge", "--no-ff", "side", "-m", "merge side"]);
    const mergeCommit = headCommit(repo);
    const { events } = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"] });
    const atMerge = events.filter((e) => e.path === "commands/new.md" && e.introducingCommit === mergeCommit);
    expect(atMerge.length).toBe(0);
    const atSide = events.filter((e) => e.path === "commands/new.md" && e.introducingCommit === sideCommit);
    expect(atSide.length).toBe(1);
    expect(atSide[0].eventKind).toBe("ADDED");
  });
});

// ------------------------------------------------------------ TBP2-007B --
describe("TBP2-007B one bounded-scan contract: monotonic clock, early charging, resumable commit cap", () => {
  it("a backward wall-clock adjustment does not extend the poll deadline", () => {
    const repo = initRepo();
    let cursor = writeAndCommit(repo, "commands/f0.md", "f0\n", "f0");
    for (let i = 1; i < 8; i += 1) {
      writeAndCommit(repo, `commands/f${i}.md`, `f${i}\n`, `f${i}`);
    }
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const shimDir = mkdtempSync(join(tmpdir(), "tb-gitshim3-"));
    createdDirs.push(shimDir);
    const shimPath = join(shimDir, "git");
    writeFileSync(shimPath, `#!/bin/sh\nsleep 0.35\nexec ${realGit} "$@"\n`);
    chmodSync(shimPath, 0o755);
    const originalPath = process.env.PATH;
    const originalNow = Date.now;
    // Freeze wall-clock time: a Date.now-based deadline would never fire.
    Date.now = () => 1700000000000;
    process.env.PATH = `${shimDir}:${originalPath}`;
    let result = null;
    let scanError = null;
    try {
      result = scanSince(repo, { cursorCommit: cursor, scopePaths: ["commands/"], pollDeadlineMs: 500 });
    } catch (e) {
      scanError = e;
    } finally {
      Date.now = originalNow;
      process.env.PATH = originalPath;
    }
    if (scanError) {
      // A git call straddling the deadline surfacing as INTAKE_BLOCKED is
      // also a safe incomplete state, never a false complete advance.
      expect(scanError).toBeInstanceOf(TeamBrainTrustError);
      expect(scanError.code).toBe(CODES.INTAKE_BLOCKED);
    } else {
      expect(result.truncated).toBe(true);
    }
  }, 60000);

  it("candidate storage stops at the changed-files cap: the third path is never stored", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/base.md", "base\n", "base");
    const full = join(repo, "commands");
    writeFileSync(join(full, "a.md"), "a\n");
    writeFileSync(join(full, "b.md"), "b\n");
    writeFileSync(join(full, "c.md"), "c\n");
    run(repo, ["add", "commands/a.md", "commands/b.md", "commands/c.md"]);
    run(repo, ["commit", "-q", "-m", "three files"]);
    const originalSet = Map.prototype.set;
    const storedKeys = [];
    Map.prototype.set = function (k, v) {
      storedKeys.push(k);
      return originalSet.call(this, k, v);
    };
    try {
      const result = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"], maxChangedFilesPerPoll: 1 });
      expect(result.truncated).toBe(true);
      expect(result.events.length).toBeLessThanOrEqual(1);
      expect(storedKeys).not.toContain("commands/c.md");
    } finally {
      Map.prototype.set = originalSet;
    }
  });

  it("a 1,001-commit range resumes past the commit cap and eventually reaches the tail ask", () => {
    const repo = initRepo();
    const seed = writeAndCommit(repo, "commands/seed.md", "seed\n", "seed");
    // Build a 1,001-commit chain after the seed with commit-tree: 1,000
    // empty commits (same tree, parent chain), then a final commit
    // adding commands/tail.md.
    const seedTree = run(repo, ["rev-parse", `${seed}^{tree}`]).trim();
    let parent = seed;
    for (let i = 0; i < 1000; i += 1) {
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
    expect(first.resumeFrontier.length).toBeGreaterThan(0);
    // A second poll from the frontier reaches the tail ask.
    const second = scanSince(repo, { cursorCommit: first.resumeFrontier, scopePaths: ["commands/"] });
    const tailEvents = second.events.filter((e) => e.path === "commands/tail.md");
    expect(tailEvents.length).toBe(1);
    expect(tailEvents[0].eventKind).toBe("ADDED");
    expect(second.truncated).toBe(false);
    expect(second.newCursor).toBe(head);
    // Incompatible frontier refusals: head moved, and scope changed.
    writeAndCommit(repo, "commands/after.md", "after\n", "after");
    expect(() => scanSince(repo, { cursorCommit: first.resumeFrontier, scopePaths: ["commands/"] })).toThrow(
      TeamBrainTrustError
    );
    expect(() =>
      scanSince(repo, { cursorCommit: first.resumeFrontier, scopePaths: ["other/"] })
    ).toThrow(TeamBrainTrustError);
  }, 120000);
});
