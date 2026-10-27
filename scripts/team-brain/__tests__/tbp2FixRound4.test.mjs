// Team Brain P2 fix round 4 — ChatGPT NO-GO re-review #3 2026-10-27
// (residuals TBP2-002C and TBP2-007C only; TBP2-001, TBP2-005,
// TBP2-003A, TBP2-004A and TBP2-006A.1 stay closed and are not
// re-litigated here). Every group below is a failing-before /
// passing-after probe at the public boundary: it fails against head
// 7bbde54 and passes at the fix-round head. Synthetic fixtures only,
// real local Git repos only, no network, no DB, no production writes.
//
// TBP2-002C: hidden fields bypass the signature, and a Proxy can
// supply unsigned fields to a handler. The fix inspects ALL own keys
// and descriptors (Reflect.ownKeys, not Object.keys) before reading
// any field, refuses hidden fields and accessors at every record
// position, gives arrays a deliberate policy (length is the one
// standard non-enumerable data property; every other own key is
// refused), and refuses native Proxies trap-free (util.types.isProxy)
// before any reflection or field read, at every entry point.
// TBP2-007C: one bounded-progress contract. The producer returns the
// oldest-first capped window (count + skip + max-count, reversed in
// JS — never git's newest window), resume state is a v2 frontier
// carrying the fully processed lower set plus an optional partial
// commit with its consumed path prefix, and diff records are yielded
// by a generator and stored only up to budget + one discarded
// lookahead record.

import { describe, it, expect, afterEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEnvelope, verifyEnvelopeSignature } from "../transport/envelope.mjs";
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
const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

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

// A handleEnvelope API whose handler records every payload it receives,
// so a probe can prove a handler never observed an unsigned field.
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
  const dir = mkdtempSync(join(tmpdir(), "tb-fixround4-"));
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
function treeWithFiles(repo, entries) {
  // entries: [[name, content], ...] for commands/ — returns a root tree SHA.
  const lines = entries.map(([name, content]) => {
    const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo, input: content, encoding: "utf8" }).trim();
    return `100644 blob ${blob}\t${name}`;
  });
  const sub = execFileSync("git", ["mktree"], { cwd: repo, input: lines.join("\n") + "\n", encoding: "utf8" }).trim();
  return execFileSync("git", ["mktree"], { cwd: repo, input: `040000 tree ${sub}\tcommands\n`, encoding: "utf8" }).trim();
}

// ------------------------------------------------------------ TBP2-002C --
describe("TBP2-002C hidden fields must not bypass the signature", () => {
  it("a non-enumerable payload field added to a signed empty payload cannot verify, and the handler never sees it", () => {
    const { api, privateKey, keyId, principalId, received } = setupApi();
    const env = envelopeFor({ principalId, keyId, privateKey, payload: {} });
    Object.defineProperty(env.payload, "approved", { value: true, enumerable: false, writable: true, configurable: true });
    expectCode(() => handleEnvelope(api, env), CODES.MALFORMED_ENVELOPE);
    expect(received).toHaveLength(0);
    // The verdict's exact observation — the handler must never observe
    // the hidden field — is impossible here because validation refuses
    // the envelope before dispatch. The raw object still carries it
    // (that is the collision), which is why refusal is the fix.
    expect(Object.hasOwn(env.payload, "approved")).toBe(true);
  });

  it("a non-enumerable field on a nested payload record cannot verify", () => {
    const { publicKey, privateKey, keyId, principalId } = setupPrincipal();
    const env = envelopeFor({ principalId, keyId, privateKey, payload: { outer: { a: 1 } } });
    Object.defineProperty(env.payload.outer, "hidden", { value: true, enumerable: false, writable: true, configurable: true });
    expectCode(() => verifyEnvelopeSignature(env, publicKey), CODES.MALFORMED_ENVELOPE);
  });

  it("a non-enumerable extra field on a payload array cannot verify", () => {
    const { publicKey, privateKey, keyId, principalId } = setupPrincipal();
    const env = envelopeFor({ principalId, keyId, privateKey, payload: { items: [1, 2] } });
    Object.defineProperty(env.payload.items, "extra", { value: 99, enumerable: false, writable: true, configurable: true });
    expectCode(() => verifyEnvelopeSignature(env, publicKey), CODES.MALFORMED_ENVELOPE);
  });

  it("a non-enumerable array element cannot verify", () => {
    const { publicKey, privateKey, keyId, principalId } = setupPrincipal();
    const env = envelopeFor({ principalId, keyId, privateKey, payload: { items: [1, 2] } });
    Object.defineProperty(env.payload.items, "0", { value: 1, enumerable: false, writable: true, configurable: true });
    expectCode(() => verifyEnvelopeSignature(env, publicKey), CODES.MALFORMED_ENVELOPE);
  });

  it("a non-enumerable envelope field cannot verify", () => {
    const { publicKey, privateKey, keyId, principalId } = setupPrincipal();
    const env = envelopeFor({ principalId, keyId, privateKey });
    Object.defineProperty(env, "extra", { value: "x", enumerable: false, writable: true, configurable: true });
    expectCode(() => verifyEnvelopeSignature(env, publicKey), CODES.MALFORMED_ENVELOPE);
  });

  it("a non-enumerable resource field cannot verify", () => {
    const { publicKey, privateKey, keyId, principalId } = setupPrincipal();
    const env = envelopeFor({ principalId, keyId, privateKey });
    Object.defineProperty(env.resource, "extra", { value: "x", enumerable: false, writable: true, configurable: true });
    expectCode(() => verifyEnvelopeSignature(env, publicKey), CODES.MALFORMED_ENVELOPE);
  });

  it("a hidden reviewed_head on a signed task must NOT satisfy an unsigned head pin", () => {
    const { api, privateKey, keyId, principalId, received } = setupApi();
    // Signed task whose resource carries no head at all.
    const env = envelopeFor({
      principalId,
      keyId,
      privateKey,
      resource: { repo: "onyxgolden/forge-ai-drop", scope: "lane-a" },
    });
    // The verdict's executed attack: a hidden head, never signed, that
    // validateResource would read and accept and the pin would match.
    Object.defineProperty(env.resource, "reviewed_head", { value: HEAD_B, enumerable: false, writable: true, configurable: true });
    expectCode(
      () => handleEnvelope(api, env, { resource: { repo: "onyxgolden/forge-ai-drop", reviewed_head: HEAD_B } }),
      CODES.MALFORMED_ENVELOPE
    );
    expect(received).toHaveLength(0);
  });

  it("a legitimately signed head still satisfies its pin", () => {
    const { api, privateKey, keyId, principalId, received } = setupApi();
    const env = envelopeFor({
      principalId,
      keyId,
      privateKey,
      resource: { repo: "onyxgolden/forge-ai-drop", scope: "lane-a", reviewed_head: HEAD_B },
    });
    const result = handleEnvelope(api, env, { resource: { repo: "onyxgolden/forge-ai-drop", reviewed_head: HEAD_B } });
    expect(result).toEqual({ ok: true });
    expect(received).toHaveLength(1);
  });

  it("a non-enumerable outer expected-pin field is refused, not silently ignored", () => {
    const { registry, privateKey, keyId, principalId } = setupPrincipal();
    const env = envelopeFor({ principalId, keyId, privateKey });
    const expected = { resource: { repo: "onyxgolden/forge-ai-drop", reviewed_head: HEAD_B } };
    Object.defineProperty(expected, "reviewed_head", { value: HEAD_A, enumerable: false, writable: true, configurable: true });
    expectCode(() => verifyAndAuthorize(registry, env, expected), CODES.MALFORMED_ENVELOPE);
  });

  it("a getter on a payload field is refused without being invoked", () => {
    const { publicKey, privateKey, keyId, principalId } = setupPrincipal();
    const env = envelopeFor({ principalId, keyId, privateKey, payload: {} });
    let invoked = false;
    Object.defineProperty(env.payload, "approved", {
      enumerable: true,
      configurable: true,
      get() {
        invoked = true;
        return true;
      },
    });
    expectCode(() => verifyEnvelopeSignature(env, publicKey), CODES.MALFORMED_ENVELOPE);
    expect(invoked).toBe(false);
  });

  it("a Proxy envelope is refused without executing any trap", () => {
    const { api, privateKey, keyId, principalId, received } = setupApi();
    const env = envelopeFor({ principalId, keyId, privateKey });
    const traps = { get: 0, set: 0, has: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, defineProperty: 0, deleteProperty: 0 };
    const proxy = new Proxy(env, {
      get(t, p, r) { traps.get += 1; return Reflect.get(t, p, r); },
      set(t, p, v, r) { traps.set += 1; return Reflect.set(t, p, v, r); },
      has(t, p) { traps.has += 1; return Reflect.has(t, p); },
      ownKeys(t) { traps.ownKeys += 1; return Reflect.ownKeys(t); },
      getOwnPropertyDescriptor(t, p) { traps.getOwnPropertyDescriptor += 1; return Reflect.getOwnPropertyDescriptor(t, p); },
      getPrototypeOf(t) { traps.getPrototypeOf += 1; return Reflect.getPrototypeOf(t); },
      defineProperty(t, p, d) { traps.defineProperty += 1; return Reflect.defineProperty(t, p, d); },
      deleteProperty(t, p) { traps.deleteProperty += 1; return Reflect.deleteProperty(t, p); },
    });
    expectCode(() => handleEnvelope(api, proxy), CODES.MALFORMED_ENVELOPE);
    expect(received).toHaveLength(0);
    expect(Object.values(traps).every((n) => n === 0)).toBe(true);
  });

  it("a Proxy payload is refused without executing any trap", () => {
    const { publicKey, privateKey, keyId, principalId } = setupPrincipal();
    const env = envelopeFor({ principalId, keyId, privateKey, payload: {} });
    const traps = { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 };
    const payloadProxy = new Proxy(
      {},
      {
        get(t, p, r) { traps.get += 1; return Reflect.get(t, p, r); },
        ownKeys(t) { traps.ownKeys += 1; return Reflect.ownKeys(t); },
        getOwnPropertyDescriptor(t, p) { traps.getOwnPropertyDescriptor += 1; return Reflect.getOwnPropertyDescriptor(t, p); },
        getPrototypeOf(t) { traps.getPrototypeOf += 1; return Reflect.getPrototypeOf(t); },
      }
    );
    env.payload = payloadProxy;
    expectCode(() => verifyEnvelopeSignature(env, publicKey), CODES.MALFORMED_ENVELOPE);
    expect(Object.values(traps).every((n) => n === 0)).toBe(true);
  });

  it("JSON-domain positives still verify: null-prototype records, nested arrays and records", () => {
    const { publicKey, privateKey, keyId, principalId } = setupPrincipal();
    const nullProto = Object.create(null);
    nullProto.note = "hello";
    const env1 = envelopeFor({ principalId, keyId, privateKey, payload: nullProto });
    expect(verifyEnvelopeSignature(env1, publicKey)).toBe(true);
    const env2 = envelopeFor({
      principalId,
      keyId,
      privateKey,
      payload: { items: [1, "two", { three: 3 }], nested: { arr: [], deep: { x: null } } },
      operationId: "op-muse-2",
      nonce: "n2",
    });
    expect(verifyEnvelopeSignature(env2, publicKey)).toBe(true);
  });
});

// ------------------------------------------------------------ TBP2-007C --
describe("TBP2-007C bounded producer and resume state", () => {
  it("a 2,001-commit range sees the oldest ask first and reaches the tail only on resume, with no false caught-up", () => {
    const repo = initRepo();
    const seed = writeAndCommit(repo, "commands/seed.md", "seed\n", "seed");
    const seedTree = run(repo, ["rev-parse", `${seed}^{tree}`]).trim();
    // First pending commit adds the oldest ask.
    const oldestTree = treeWithFiles(repo, [
      ["seed.md", "seed\n"],
      ["oldest.md", "oldest\n"],
    ]);
    let parent = run(repo, ["commit-tree", oldestTree, "-p", seed, "-m", "oldest"]).trim();
    // 1,999 intermediates with the same tree: empty in scope.
    for (let i = 0; i < 1999; i += 1) {
      parent = run(repo, ["commit-tree", oldestTree, "-p", parent, "-m", `empty-${i}`]).trim();
    }
    const tailTree = treeWithFiles(repo, [
      ["seed.md", "seed\n"],
      ["oldest.md", "oldest\n"],
      ["tail.md", "tail\n"],
    ]);
    const tailCommit = run(repo, ["commit-tree", tailTree, "-p", parent, "-m", "tail"]).trim();
    run(repo, ["update-ref", "refs/heads/main", tailCommit]);
    const head = headCommit(repo);

    const first = scanSince(repo, { cursorCommit: seed, scopePaths: ["commands/"] });
    expect(first.truncated).toBe(true);
    expect(typeof first.resumeFrontier).toBe("string");
    // Fix round 5 migrated the frontier format v2 -> v3 (bounded
    // count-plus-position instead of a serialized accounted list);
    // the behavioral assertions below (three polls, oldest first,
    // tail only on resume, no false caught-up) are unchanged.
    expect(first.resumeFrontier.startsWith("tb-frontier:v5:")).toBe(true);
    expect(first.newCursor).toBe(seed);
    expect(first.newCursor).not.toBe(head);
    expect(first.events.map((e) => e.path)).toEqual(["commands/oldest.md"]);

    // 2,001 pending needs three polls (1,000 + 1,000 + 1): the second
    // window is intermediates only (empty in scope), and the tail
    // arrives only in the third poll.
    const second = scanSince(repo, { cursorCommit: first.resumeFrontier, scopePaths: ["commands/"] });
    expect(second.truncated).toBe(true);
    expect(typeof second.resumeFrontier).toBe("string");
    expect(second.events).toEqual([]);
    const third = scanSince(repo, { cursorCommit: second.resumeFrontier, scopePaths: ["commands/"] });
    expect(third.truncated).toBe(false);
    expect(third.resumeFrontier).toBeNull();
    expect(third.newCursor).toBe(head);
    expect(third.events.map((e) => e.path)).toEqual(["commands/tail.md"]);
  }, 120000);

  it("a branching DAG sees side and main asks once each in a single poll", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/base.md", "base\n", "base");
    run(repo, ["checkout", "-q", "-b", "side"]);
    writeAndCommit(repo, "commands/side.md", "side\n", "side adds");
    run(repo, ["checkout", "-q", "main"]);
    writeAndCommit(repo, "commands/main.md", "main\n", "main adds");
    run(repo, ["merge", "-q", "--no-ff", "side", "-m", "merge side"]);
    const result = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"] });
    expect(result.truncated).toBe(false);
    const paths = result.events.map((e) => e.path).sort();
    expect(paths).toEqual(["commands/main.md", "commands/side.md"]);
  });

  it("crash/replay: replaying the same frontier returns identical events, then completes", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/base.md", "base\n", "base");
    writeAndCommit(repo, "commands/a.md", "a\n", "a");
    writeAndCommit(repo, "commands/b.md", "b\n", "b");
    const head = headCommit(repo);
    const opts = { scopePaths: ["commands/"], maxChangedFilesPerPoll: 1 };
    const first = scanSince(repo, { cursorCommit: base, ...opts });
    expect(first.truncated).toBe(true);
    expect(first.events.map((e) => e.path)).toEqual(["commands/a.md"]);
    // Crash replay: the same frontier again gives the same first window.
    const replay = scanSince(repo, { cursorCommit: first.resumeFrontier, ...opts });
    expect(replay.events.map((e) => e.path)).toEqual(["commands/b.md"]);
    expect(replay.truncated).toBe(false);
    expect(replay.newCursor).toBe(head);
    // And replaying that frontier again is identical, not a duplicate.
    const replayAgain = scanSince(repo, { cursorCommit: first.resumeFrontier, ...opts });
    expect(replayAgain.events.map((e) => e.path)).toEqual(["commands/b.md"]);
    expect(replayAgain.newCursor).toBe(head);
  });

  it("a frontier is refused when the head moved, the scope changed, or it is a legacy v1 frontier", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/base.md", "base\n", "base");
    writeAndCommit(repo, "commands/a.md", "a\n", "a");
    writeAndCommit(repo, "commands/b.md", "b\n", "b");
    const head = headCommit(repo);
    const first = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"], maxChangedFilesPerPoll: 1 });
    expect(first.truncated).toBe(true);
    expect(typeof first.resumeFrontier).toBe("string");
    // Scope changed first (head still unmoved, so the scope check is
    // the one that fires): the same frontier under a different scope.
    expectCode(
      () => scanSince(repo, { cursorCommit: first.resumeFrontier, scopePaths: ["other/"] }),
      CODES.INTAKE_BLOCKED
    );
    // Head moved: a new commit lands after the frontier was built.
    writeAndCommit(repo, "commands/c.md", "c\n", "c");
    expectCode(
      () => scanSince(repo, { cursorCommit: first.resumeFrontier, scopePaths: ["commands/"] }),
      CODES.INTAKE_BLOCKED
    );
    // Legacy v1: rejected outright, never reinterpreted as a v2 frontier.
    expectCode(
      () => scanSince(repo, { cursorCommit: `tb-frontier:v1:${head}:${"0".repeat(64)}:`, scopePaths: ["commands/"] }),
      CODES.INTAKE_BLOCKED
    );
  });

  it("a small range below the cap completes in a single poll", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/base.md", "base\n", "base");
    writeAndCommit(repo, "commands/a.md", "a\n", "a");
    writeAndCommit(repo, "commands/b.md", "b\n", "b");
    const head = headCommit(repo);
    const result = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"] });
    expect(result.truncated).toBe(false);
    expect(result.newCursor).toBe(head);
    expect(result.resumeFrontier).toBeNull();
    expect(result.events.map((e) => e.path)).toEqual(["commands/a.md", "commands/b.md"]);
  });
});

describe("TBP2-007C cap continuation at every exhaustion point", () => {
  it("file cap: two asks in separate commits progress via the frontier (the verdict's example)", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/base.md", "base\n", "base");
    writeAndCommit(repo, "commands/a.md", "a\n", "a");
    writeAndCommit(repo, "commands/b.md", "b\n", "b");
    const head = headCommit(repo);
    const first = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"], maxChangedFilesPerPoll: 1 });
    expect(first.events.map((e) => e.path)).toEqual(["commands/a.md"]);
    expect(first.truncated).toBe(true);
    expect(first.newCursor).toBe(base);
    expect(typeof first.resumeFrontier).toBe("string");
    const second = scanSince(repo, { cursorCommit: first.resumeFrontier, scopePaths: ["commands/"], maxChangedFilesPerPoll: 1 });
    expect(second.events.map((e) => e.path)).toEqual(["commands/b.md"]);
    expect(second.truncated).toBe(false);
    expect(second.newCursor).toBe(head);
  });

  it("a partially processed commit progresses path by path under a one-file budget", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/base.md", "base\n", "base");
    writeFilesAndCommit(
      repo,
      [
        ["commands/a.md", "a\n"],
        ["commands/b.md", "b\n"],
        ["commands/c.md", "c\n"],
      ],
      "three files"
    );
    const head = headCommit(repo);
    const opts = { scopePaths: ["commands/"], maxChangedFilesPerPoll: 1 };
    const first = scanSince(repo, { cursorCommit: base, ...opts });
    expect(first.events.map((e) => e.path)).toEqual(["commands/a.md"]);
    expect(first.truncated).toBe(true);
    const second = scanSince(repo, { cursorCommit: first.resumeFrontier, ...opts });
    expect(second.events.map((e) => e.path)).toEqual(["commands/b.md"]);
    expect(second.truncated).toBe(true);
    const third = scanSince(repo, { cursorCommit: second.resumeFrontier, ...opts });
    expect(third.events.map((e) => e.path)).toEqual(["commands/c.md"]);
    expect(third.truncated).toBe(false);
    expect(third.newCursor).toBe(head);
  });

  it("record cap: maxRecordsPerBatch=1 progresses across commits", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/base.md", "base\n", "base");
    writeAndCommit(repo, "commands/a.md", "a\n", "a");
    writeAndCommit(repo, "commands/b.md", "b\n", "b");
    const head = headCommit(repo);
    const opts = { scopePaths: ["commands/"], maxRecordsPerBatch: 1 };
    const first = scanSince(repo, { cursorCommit: base, ...opts });
    expect(first.events.map((e) => e.path)).toEqual(["commands/a.md"]);
    expect(first.truncated).toBe(true);
    const second = scanSince(repo, { cursorCommit: first.resumeFrontier, ...opts });
    expect(second.events.map((e) => e.path)).toEqual(["commands/b.md"]);
    expect(second.truncated).toBe(false);
    expect(second.newCursor).toBe(head);
  });

  it("byte cap: maxPollBytes progresses across commits", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/base.md", "base\n", "base");
    writeAndCommit(repo, "commands/a.md", "a\n", "a");
    writeAndCommit(repo, "commands/b.md", "b\n", "b");
    const head = headCommit(repo);
    // Each file is 2 bytes; a 3-byte poll budget admits the first file
    // (2 bytes) but truncates before the second (2 + 2 > 3).
    const opts = { scopePaths: ["commands/"], maxPollBytes: 3 };
    const first = scanSince(repo, { cursorCommit: base, ...opts });
    expect(first.events.map((e) => e.path)).toEqual(["commands/a.md"]);
    expect(first.truncated).toBe(true);
    const second = scanSince(repo, { cursorCommit: first.resumeFrontier, ...opts });
    expect(second.events.map((e) => e.path)).toEqual(["commands/b.md"]);
    expect(second.truncated).toBe(false);
    expect(second.newCursor).toBe(head);
  });
});

describe("TBP2-007C diff admission is bounded at the producer", () => {
  it("with a one-file budget and three changed paths, no {status,path} record and no Map key beyond the budget is ever stored", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/base.md", "base\n", "base");
    writeFilesAndCommit(
      repo,
      [
        ["commands/a.md", "a\n"],
        ["commands/b.md", "b\n"],
        ["commands/c.md", "c\n"],
      ],
      "three files"
    );
    const originalPush = Array.prototype.push;
    const originalMapSet = Map.prototype.set;
    const pushedRecords = [];
    const storedKeys = [];
    Array.prototype.push = function (...args) {
      for (const arg of args) {
        if (arg && typeof arg === "object" && typeof arg.status === "string" && typeof arg.path === "string") {
          pushedRecords.push(arg);
        }
      }
      return originalPush.apply(this, args);
    };
    Map.prototype.set = function (k, v) {
      storedKeys.push(k);
      return originalMapSet.call(this, k, v);
    };
    try {
      const result = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"], maxChangedFilesPerPoll: 1 });
      expect(result.truncated).toBe(true);
      expect(result.events.length).toBeLessThanOrEqual(1);
      // No {status,path} record is ever created: the generator yields
      // tuples, pathOrder stores strings, events store eventKind.
      expect(pushedRecords).toHaveLength(0);
      // The lookahead record (b.md) is discarded, not stored, and the
      // third path (c.md) is never even scanned past the stop.
      expect(storedKeys).not.toContain("commands/b.md");
      expect(storedKeys).not.toContain("commands/c.md");
    } finally {
      Array.prototype.push = originalPush;
      Map.prototype.set = originalMapSet;
    }
  });
});
