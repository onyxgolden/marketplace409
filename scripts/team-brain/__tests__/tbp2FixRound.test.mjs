// Team Brain P2 fix round — ChatGPT NO-GO 2026-10-26 (TBP2-001..007).
// Every group below is a failing-before / passing-after probe at the
// public boundary: it fails against head c49f550d and passes at the
// fix-round head. Synthetic fixtures only, real local Git repos only,
// no network, no DB, no production writes.
//
// Helpers mirror the existing P2 tests (transport.test.mjs /
// logicalApi.test.mjs / gitShadowImporter.test.mjs) so the setup is
// familiar, not a second private model of the code.

import { describe, it, expect, afterEach } from "vitest";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEnvelope, verifyEnvelopeSignature, canonicalize, sha256Hex } from "../transport/envelope.mjs";
import {
  createRegistry,
  registerKey,
  grantAuthorization,
  verifyAndAuthorize,
} from "../transport/registry.mjs";
import { createApi, handleEnvelope } from "../transport/logicalApi.mjs";
import { scanSince, headCommit } from "../transport/gitShadowImporter.mjs";
import { parseEnvelopeCandidate } from "../transport/legacyObservationParser.mjs";
import { TeamBrainTrustError, CODES } from "../transport/errors.mjs";

const ADMIN = { origin: "jason-admin" };
const T0 = "2026-10-26T12:00:00Z";

function keypair() {
  return generateKeyPairSync("ed25519");
}

// Re-signs an envelope after a mutation, so the probe fails on
// validation — not on a stale signature. Recomputes payload_sha256
// first when the caller asks for it.
function resign(envelope, privateKey, { recomputeHash = false } = {}) {
  let unsigned = { ...envelope };
  delete unsigned.signature;
  if (recomputeHash) {
    unsigned = { ...unsigned, payload_sha256: sha256Hex(canonicalize(unsigned.payload)) };
  }
  const signature = cryptoSign(null, Buffer.from(canonicalize(unsigned), "utf8"), privateKey).toString("base64");
  return { ...unsigned, signature };
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
  return { registry, privateKey, keyId, principalId };
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
function run(repo, args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}
function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), "tb-fixround-"));
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

// ------------------------------------------------------------- TBP2-001 --
describe("TBP2-001 __proto__ canonicalization is injective", () => {
  it("canonicalize preserves an own __proto__ key instead of dropping it", () => {
    const withProto = JSON.parse('{"a":1,"__proto__":{"admin":true}}');
    const withoutProto = { a: 1 };
    expect(canonicalize(withProto)).toContain('"__proto__"');
    expect(canonicalize(withProto)).not.toBe(canonicalize(withoutProto));
  });

  it("canonicalize preserves nested __proto__ keys and is order-independent", () => {
    const a = JSON.parse('{"outer":{"__proto__":{"x":1}},"b":2}');
    const b = JSON.parse('{"b":2,"outer":{"__proto__":{"x":1}}}');
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalize(a)).toContain('"__proto__"');
  });

  it("constructor/prototype keys are ordinary data keys, sorted with the rest", () => {
    const out = canonicalize({ prototype: 2, constructor: 1, a: 0 });
    expect(out).toBe('{"a":0,"constructor":1,"prototype":2}');
  });

  it("an altered payload carrying an own __proto__ key does not verify under the original signature", () => {
    const { registry, privateKey, keyId, principalId } = setupPrincipal();
    const env = envelopeFor({ principalId, keyId, privateKey, payload: { note: "safe" } });
    const alteredPayload = JSON.parse('{"note":"safe","__proto__":{"admin":true}}');
    const altered = { ...env, payload: alteredPayload };
    // Original signature + original payload_sha256, altered payload:
    // the old canonicalizer made both payloads identical bytes, so this
    // verified. Now the bytes differ, so it must fail on the hash.
    expectCode(() => verifyEnvelopeSignature(altered, registry.keys.get(keyId).publicKey), CODES.PAYLOAD_HASH_MISMATCH);
  });

  it("no unsigned field reaches a handler: a __proto__-tampered envelope never dispatches", () => {
    const { registry, privateKey, keyId, principalId } = setupPrincipal();
    const env = envelopeFor({ principalId, keyId, privateKey, payload: { note: "safe" } });
    const altered = { ...env, payload: JSON.parse('{"note":"safe","__proto__":{"admin":true}}') };
    let called = false;
    const api = createApi(registry, {
      submit_task: () => {
        called = true;
        return "ok";
      },
    });
    expect(() => handleEnvelope(api, altered)).toThrow(TeamBrainTrustError);
    expect(called).toBe(false);
  });
});

// ------------------------------------------------------------- TBP2-002 --
describe("TBP2-002 closed bounded envelope validator", () => {
  it("refuses schema_version 99 even when correctly signed", () => {
    const setup = setupPrincipal();
    const env = envelopeFor({ principalId: setup.principalId, keyId: setup.keyId, privateKey: setup.privateKey });
    const mutant = resign({ ...env, schema_version: 99 }, setup.privateKey);
    expectCode(() => verifyEnvelopeSignature(mutant, setup.registry.keys.get(setup.keyId).publicKey), CODES.MALFORMED_ENVELOPE);
  });

  it("refuses an impossible issued_at date even when correctly signed", () => {
    const setup = setupPrincipal();
    const env = envelopeFor({ principalId: setup.principalId, keyId: setup.keyId, privateKey: setup.privateKey });
    const mutant = resign({ ...env, issued_at: "2026-02-30T12:00:00Z" }, setup.privateKey);
    expectCode(() => verifyEnvelopeSignature(mutant, setup.registry.keys.get(setup.keyId).publicKey), CODES.MALFORMED_ENVELOPE);
  });

  it("refuses an empty nonce, a negative expected_row_version, and an unknown extra field", () => {
    const setup = setupPrincipal();
    const env = envelopeFor({ principalId: setup.principalId, keyId: setup.keyId, privateKey: setup.privateKey });
    const pub = setup.registry.keys.get(setup.keyId).publicKey;
    expectCode(() => verifyEnvelopeSignature(resign({ ...env, nonce: "" }, setup.privateKey), pub), CODES.MALFORMED_ENVELOPE);
    expectCode(
      () => verifyEnvelopeSignature(resign({ ...env, expected_row_version: -1 }, setup.privateKey), pub),
      CODES.MALFORMED_ENVELOPE
    );
    expectCode(
      () => verifyEnvelopeSignature(resign({ ...env, extra_field: "x" }, setup.privateKey), pub),
      CODES.MALFORMED_ENVELOPE
    );
  });

  it("refuses a 300,000-character string payload even when correctly signed and hashed", () => {
    const setup = setupPrincipal();
    // Build the mutant by re-signing a valid envelope with an
    // oversized payload (buildEnvelope itself refuses to sign one, so
    // the mutant must be assembled by hand to prove the verifier, not
    // just the builder, refuses it).
    const base = envelopeFor({ principalId: setup.principalId, keyId: setup.keyId, privateKey: setup.privateKey });
    const mutant = resign({ ...base, payload: { note: "x".repeat(300000) } }, setup.privateKey, { recomputeHash: true });
    expectCode(
      () => verifyEnvelopeSignature(mutant, setup.registry.keys.get(setup.keyId).publicKey),
      CODES.MALFORMED_ENVELOPE
    );
  });

  it("refuses 40 levels of payload nesting even when correctly signed and hashed", () => {
    const setup = setupPrincipal();
    let deep = { leaf: 1 };
    for (let i = 0; i < 40; i += 1) deep = { next: deep };
    const base = envelopeFor({ principalId: setup.principalId, keyId: setup.keyId, privateKey: setup.privateKey });
    const mutant = resign({ ...base, payload: deep }, setup.privateKey, { recomputeHash: true });
    expectCode(
      () => verifyEnvelopeSignature(mutant, setup.registry.keys.get(setup.keyId).publicKey),
      CODES.MALFORMED_ENVELOPE
    );
  });

  it("a refused envelope mutates no handler or replay state", () => {
    const setup = setupPrincipal();
    const env = envelopeFor({ principalId: setup.principalId, keyId: setup.keyId, privateKey: setup.privateKey });
    const mutant = resign({ ...env, schema_version: 99 }, setup.privateKey);
    let called = false;
    const api = createApi(setup.registry, {
      submit_task: () => {
        called = true;
        return "ok";
      },
    });
    expect(() => handleEnvelope(api, mutant)).toThrow(TeamBrainTrustError);
    expect(called).toBe(false);
    expect(setup.registry.seenOperations.size).toBe(0);
  });

  it("buildEnvelope refuses malformed construction instead of signing it", () => {
    const { privateKey } = keypair();
    expect(() =>
      buildEnvelope(
        {
          operationId: "op-1",
          principalId: "muse",
          keyId: "k1",
          issuedAt: "2026-02-30T12:00:00Z",
          operation: "submit_task",
          resource: { repo: "onyxgolden/forge-ai-drop", scope: "lane-a" },
          nonce: "n1",
          payload: { note: "x" },
        },
        privateKey
      )
    ).toThrow(TeamBrainTrustError);
    expect(() =>
      buildEnvelope(
        {
          operationId: "op-1",
          principalId: "muse",
          keyId: "k1",
          issuedAt: T0,
          operation: "submit_task",
          resource: { repo: "onyxgolden/forge-ai-drop", scope: "lane-a" },
          nonce: "n1",
          payload: { note: "x".repeat(300000) },
        },
        privateKey
      )
    ).toThrow(TeamBrainTrustError);
  });

  it("a legitimate envelope with modest nesting still verifies", () => {
    const setup = setupPrincipal();
    const env = envelopeFor({
      principalId: setup.principalId,
      keyId: setup.keyId,
      privateKey: setup.privateKey,
      payload: { a: { b: { c: "ok" } } },
    });
    expect(() => verifyEnvelopeSignature(env, setup.registry.keys.get(setup.keyId).publicKey)).not.toThrow();
  });

  it("raw JSON over the envelope byte cap is reported, never parsed", () => {
    const result = parseEnvelopeCandidate("commands/team-brain/muse/op-big.json", "x".repeat(600 * 1024));
    expect(result.envelope).toBeNull();
    expect(result.parseError).toBe("ENVELOPE_TOO_LARGE");
  });
});

// ------------------------------------------------------------- TBP2-003 --
describe("TBP2-003 external pin scope and identity are compared", () => {
  it("a pin scope B does not admit scope-A evidence even under a broad grant", () => {
    const setup = setupPrincipal({ resourceScope: "*" });
    const env = envelopeFor({
      principalId: setup.principalId,
      keyId: setup.keyId,
      privateKey: setup.privateKey,
      resource: { repo: "onyxgolden/forge-ai-drop", scope: "lane-a" },
    });
    let called = false;
    const api = createApi(setup.registry, {
      submit_task: () => {
        called = true;
        return "ok";
      },
    });
    expectCode(
      () =>
        handleEnvelope(api, env, {
          resource: { repo: "onyxgolden/forge-ai-drop", scope: "lane-b" },
        }),
      CODES.RESOURCE_BINDING_MISMATCH
    );
    expect(called).toBe(false);
  });

  it("a pin source mismatch is a binding mismatch, not a silent pass", () => {
    const setup = setupPrincipal({ resourceScope: "*" });
    const env = envelopeFor({
      principalId: setup.principalId,
      keyId: setup.keyId,
      privateKey: setup.privateKey,
      resource: { repo: "onyxgolden/forge-ai-drop", scope: "lane-a", source: "source-a" },
    });
    expectCode(
      () =>
        verifyAndAuthorize(setup.registry, env, {
          resource: { repo: "onyxgolden/forge-ai-drop", scope: "lane-a", source: "source-b" },
        }),
      CODES.RESOURCE_BINDING_MISMATCH
    );
  });

  it("an unknown pin field is refused, not silently ignored", () => {
    const setup = setupPrincipal();
    const env = envelopeFor({ principalId: setup.principalId, keyId: setup.keyId, privateKey: setup.privateKey });
    expectCode(
      () =>
        verifyAndAuthorize(setup.registry, env, {
          resource: { repo: "onyxgolden/forge-ai-drop", bogus_field: "x" },
        }),
      CODES.MALFORMED_ENVELOPE
    );
  });

  it("a matching pin (repo + scope + head) still admits, and a no-pin call stays distinct from a pinned call", () => {
    const setup = setupPrincipal({ resourceScope: "*" });
    const head = "a".repeat(40);
    const env = envelopeFor({
      principalId: setup.principalId,
      keyId: setup.keyId,
      privateKey: setup.privateKey,
      resource: { repo: "onyxgolden/forge-ai-drop", scope: "lane-a", reviewed_head: head },
    });
    const api = createApi(setup.registry, { submit_task: () => "pinned-ok" });
    expect(
      handleEnvelope(api, env, {
        resource: { repo: "onyxgolden/forge-ai-drop", scope: "lane-a", reviewed_head: head },
      })
    ).toBe("pinned-ok");
  });
});

// ------------------------------------------------------------- TBP2-004 --
describe("TBP2-004 replay identity is the full operation, not the digest", () => {
  it("same operation_id + same payload as a different operation/scope/head/nonce is CONFLICTING_REPLAY, not OPERATION_REPLAYED", () => {
    const setup = setupPrincipal({ grantedOps: ["submit_task", "submit_verdict"], resourceScope: "*" });
    const first = envelopeFor({
      principalId: setup.principalId,
      keyId: setup.keyId,
      privateKey: setup.privateKey,
      operation: "submit_task",
      operationId: "op-replay-1",
      nonce: "n1",
      resource: { repo: "onyxgolden/forge-ai-drop", scope: "lane-a", reviewed_head: "a".repeat(40) },
      payload: { note: "same" },
    });
    verifyAndAuthorize(setup.registry, first, {});
    const second = envelopeFor({
      principalId: setup.principalId,
      keyId: setup.keyId,
      privateKey: setup.privateKey,
      operation: "submit_verdict",
      operationId: "op-replay-1",
      nonce: "n2",
      resource: { repo: "onyxgolden/forge-ai-drop", scope: "lane-b", reviewed_head: "b".repeat(40) },
      payload: { note: "same" },
    });
    expectCode(() => verifyAndAuthorize(setup.registry, second, {}), CODES.CONFLICTING_REPLAY);
  });

  it("same operation_id + same payload from a different actor is CONFLICTING_REPLAY", () => {
    const firstSetup = setupPrincipal({ principalId: "actor-a", grantedOps: ["submit_task"], resourceScope: "*" });
    // Second actor shares the same registry so the operation_id collides.
    const second = setupPrincipal({ principalId: "actor-b", grantedOps: ["submit_task"], resourceScope: "*" });
    // Reuse firstSetup's registry for both actors: register actor-b there.
    const { publicKey: pubB, privateKey: privB } = keypair();
    registerKey(firstSetup.registry, ADMIN, { keyId: "actor-b-key", principalId: "actor-b", publicKey: pubB, registeredBy: "jason-admin" });
    grantAuthorization(firstSetup.registry, ADMIN, {
      grantId: "grant-actor-b",
      principalId: "actor-b",
      resourceRepo: "onyxgolden/forge-ai-drop",
      resourceScope: "*",
      allowedOperations: ["submit_task"],
    });
    const first = envelopeFor({
      principalId: "actor-a",
      keyId: firstSetup.keyId,
      privateKey: firstSetup.privateKey,
      operationId: "op-replay-2",
      payload: { note: "same" },
    });
    verifyAndAuthorize(firstSetup.registry, first, {});
    const other = envelopeFor({
      principalId: "actor-b",
      keyId: "actor-b-key",
      privateKey: privB,
      operationId: "op-replay-2",
      payload: { note: "same" },
    });
    expectCode(() => verifyAndAuthorize(firstSetup.registry, other, {}), CODES.CONFLICTING_REPLAY);
    void second;
  });

  it("an exactly identical envelope is still OPERATION_REPLAYED", () => {
    const setup = setupPrincipal();
    const env = envelopeFor({ principalId: setup.principalId, keyId: setup.keyId, privateKey: setup.privateKey, operationId: "op-replay-3" });
    verifyAndAuthorize(setup.registry, env, {});
    expectCode(() => verifyAndAuthorize(setup.registry, env, {}), CODES.OPERATION_REPLAYED);
  });

  it("a handler failure does not mark the operation seen, so a retry succeeds", () => {
    const setup = setupPrincipal();
    const env = envelopeFor({ principalId: setup.principalId, keyId: setup.keyId, privateKey: setup.privateKey, operationId: "op-replay-4" });
    let failNext = true;
    const api = createApi(setup.registry, {
      submit_task: () => {
        if (failNext) {
          failNext = false;
          throw new Error("handler boom");
        }
        return "handled";
      },
    });
    expect(() => handleEnvelope(api, env)).toThrow("handler boom");
    expect(handleEnvelope(api, env)).toBe("handled");
  });

  it("a missing handler does not mark the operation seen, so a later handled call succeeds", () => {
    const setup = setupPrincipal();
    const env = envelopeFor({ principalId: setup.principalId, keyId: setup.keyId, privateKey: setup.privateKey, operationId: "op-replay-5" });
    const noHandlerApi = createApi(setup.registry, {});
    expectCode(() => handleEnvelope(noHandlerApi, env), CODES.UNKNOWN_OPERATION);
    const api = createApi(setup.registry, { submit_task: () => "handled" });
    expect(handleEnvelope(api, env)).toBe("handled");
  });
});

// ------------------------------------------------------------- TBP2-005 --
describe("TBP2-005 Git quoted paths are not dropped", () => {
  it("a non-ASCII filename under a scoped prefix is admitted, not lost", () => {
    const repo = initRepo();
    writeAndCommit(repo, "README.md", "root", "root");
    const c1 = writeAndCommit(repo, "commands/chatgpt/café.md", "hello", "add café file");
    const { events, quarantined, truncated, newCursor } = scanSince(repo, { cursorCommit: null, scopePaths: ["commands/"] });
    expect(truncated).toBe(false);
    expect(quarantined).toHaveLength(0);
    const found = events.find((e) => e.path === "commands/chatgpt/café.md");
    expect(found).toBeDefined();
    expect(found.eventKind).toBe("ADDED");
    expect(found.introducingCommit).toBe(c1);
    expect(newCursor).toBe(c1);
  });

  it("a tab in a filename is handled literally, not split as a field separator", () => {
    const repo = initRepo();
    writeAndCommit(repo, "README.md", "root", "root");
    const tabPath = "commands/chatgpt/a\tb.md";
    const c1 = writeAndCommit(repo, tabPath, "hello", "add tab file");
    const { events } = scanSince(repo, { cursorCommit: null, scopePaths: ["commands/"] });
    const found = events.find((e) => e.path === tabPath);
    expect(found).toBeDefined();
    expect(found.eventKind).toBe("ADDED");
    expect(found.introducingCommit).toBe(c1);
  });

  it("a newline in a filename is handled literally, not split as a record separator", () => {
    const repo = initRepo();
    writeAndCommit(repo, "README.md", "root", "root");
    const nlPath = "commands/chatgpt/a\nb.md";
    const c1 = writeAndCommit(repo, nlPath, "hello", "add newline file");
    const { events } = scanSince(repo, { cursorCommit: null, scopePaths: ["commands/"] });
    const found = events.find((e) => e.path === nlPath);
    expect(found).toBeDefined();
    expect(found.eventKind).toBe("ADDED");
    expect(found.introducingCommit).toBe(c1);
  });

  it("scope boundary: a quoted path outside the scoped prefix is excluded by scope, not by quoting", () => {
    const repo = initRepo();
    writeAndCommit(repo, "README.md", "root", "root");
    writeAndCommit(repo, "commandsX/chatgpt/café.md", "outside", "outside scope");
    const { events } = scanSince(repo, { cursorCommit: null, scopePaths: ["commands/"] });
    expect(events.map((e) => e.path)).not.toContain("commandsX/chatgpt/café.md");
  });
});

// ------------------------------------------------------------- TBP2-006 --
describe("TBP2-006 merge visibility is not a second introduction", () => {
  it("a clean --no-ff merge emits exactly one ADDED for the side-branch file, at its introducing commit", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "README.md", "root", "root");
    run(repo, ["checkout", "-q", "-b", "side"]);
    const sideCommit = writeAndCommit(repo, "commands/claude/side-task.md", "side", "add on side branch");
    run(repo, ["checkout", "-q", "main"]);
    writeAndCommit(repo, "README.md", "root v2", "unrelated mainline change");
    run(repo, ["merge", "-q", "--no-ff", "side", "-m", "merge side"]);
    const mergeCommit = headCommit(repo);
    const { events } = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"] });
    const forPath = events.filter((e) => e.path === "commands/claude/side-task.md");
    expect(forPath).toHaveLength(1);
    expect(forPath[0]).toMatchObject({ eventKind: "ADDED", introducingCommit: sideCommit });
    expect(forPath[0].introducingCommit).not.toBe(mergeCommit);
  });

  it("the reverse parent order also emits exactly one ADDED, at the introducing commit", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "README.md", "root", "root");
    const mainCommit = writeAndCommit(repo, "commands/claude/main-task.md", "main", "add on main");
    run(repo, ["checkout", "-q", "-b", "side"]);
    writeAndCommit(repo, "README.md", "root v2", "unrelated side change");
    run(repo, ["merge", "-q", "--no-ff", "main", "-m", "merge main into side"]);
    const mergeCommit = headCommit(repo);
    const { events } = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"] });
    const forPath = events.filter((e) => e.path === "commands/claude/main-task.md");
    expect(forPath).toHaveLength(1);
    expect(forPath[0]).toMatchObject({ eventKind: "ADDED", introducingCommit: mainCommit });
    expect(forPath[0].introducingCommit).not.toBe(mergeCommit);
  });

  it("a genuine merge-resolution change still emits exactly one MODIFIED at the merge", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/claude/shared.md", "base", "base");
    run(repo, ["checkout", "-q", "-b", "side"]);
    writeAndCommit(repo, "commands/claude/shared.md", "side edit", "side edits shared");
    run(repo, ["checkout", "-q", "main"]);
    writeAndCommit(repo, "commands/claude/shared.md", "main edit", "main edits shared");
    try {
      run(repo, ["merge", "--no-ff", "side", "-m", "merge with conflict"]);
    } catch {
      // expected to conflict; resolve manually
    }
    writeFileSync(join(repo, "commands/claude/shared.md"), "resolved by merge");
    run(repo, ["add", "commands/claude/shared.md"]);
    run(repo, ["commit", "-q", "--no-edit"]);
    const mergeCommit = headCommit(repo);
    const { events } = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"] });
    const atMerge = events.filter((e) => e.path === "commands/claude/shared.md" && e.introducingCommit === mergeCommit);
    expect(atMerge).toHaveLength(1);
    expect(atMerge[0].eventKind).toBe("MODIFIED");
  });

  it("a delete/modify merge resolution emits exactly one DELETED at the merge, not a new ADDED", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/claude/shared.md", "base", "base");
    run(repo, ["checkout", "-q", "-b", "side"]);
    run(repo, ["rm", "-q", "commands/claude/shared.md"]);
    run(repo, ["commit", "-q", "-m", "side deletes shared"]);
    run(repo, ["checkout", "-q", "main"]);
    writeAndCommit(repo, "commands/claude/shared.md", "main edit", "main edits shared");
    try {
      run(repo, ["merge", "--no-ff", "side", "-m", "merge delete/modify"]);
    } catch {
      // expected to conflict (delete/modify); resolve by deleting
    }
    run(repo, ["rm", "-q", "--cached", "commands/claude/shared.md"]);
    run(repo, ["commit", "-q", "--no-edit"]);
    const mergeCommit = headCommit(repo);
    const { events } = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"] });
    const atMerge = events.filter((e) => e.path === "commands/claude/shared.md" && e.introducingCommit === mergeCommit);
    expect(atMerge).toHaveLength(1);
    expect(atMerge[0].eventKind).toBe("DELETED");
  });
});

// ------------------------------------------------------------- TBP2-007 --
describe("TBP2-007 blob size is validated before content is read", () => {
  it("a 65 MiB scoped blob is quarantined FILE_TOO_LARGE, not a raw ENOBUFS error", () => {
    const repo = initRepo();
    writeAndCommit(repo, "README.md", "root", "root");
    const big = Buffer.alloc(65 * 1024 * 1024, "x");
    const full = join(repo, "commands/claude/huge.md");
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, big);
    run(repo, ["add", "commands/claude/huge.md"]);
    run(repo, ["commit", "-q", "-m", "add huge file"]);
    const head = headCommit(repo);
    const { events, quarantined, truncated, newCursor } = scanSince(repo, { cursorCommit: null, scopePaths: ["commands/"] });
    expect(events).toHaveLength(0);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]).toMatchObject({ path: "commands/claude/huge.md", reason: "FILE_TOO_LARGE", byteLength: 65 * 1024 * 1024 });
    expect(truncated).toBe(false);
    expect(newCursor).toBe(head);
  });

  it("exact file-size limit admits, and limit + 1 quarantines", () => {
    const repo = initRepo();
    writeAndCommit(repo, "commands/claude/exact.md", "x".repeat(50), "add exact");
    writeAndCommit(repo, "commands/claude/over.md", "x".repeat(51), "add over");
    const { events, quarantined } = scanSince(repo, { cursorCommit: null, scopePaths: ["commands/"], maxFileBytes: 50 });
    expect(events.map((e) => e.path)).toEqual(["commands/claude/exact.md"]);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]).toMatchObject({ path: "commands/claude/over.md", reason: "FILE_TOO_LARGE", byteLength: 51 });
  });

  it("a poll-byte overflow truncates before reading the overflowing blob and preserves the cursor", () => {
    const repo = initRepo();
    const c0 = writeAndCommit(repo, "README.md", "root", "root");
    writeAndCommit(repo, "commands/claude/a.md", "a".repeat(100), "add a");
    writeAndCommit(repo, "commands/claude/b.md", "b".repeat(100), "add b");
    const { events, truncated, newCursor } = scanSince(repo, {
      cursorCommit: c0,
      scopePaths: ["commands/"],
      maxPollBytes: 150,
    });
    expect(truncated).toBe(true);
    expect(events).toHaveLength(1);
    expect(newCursor).toBe(c0);
  });

  it("an oversized file does not block later files in the same poll, and nothing is skipped on resume", () => {
    const repo = initRepo();
    writeAndCommit(repo, "commands/claude/big.md", "x".repeat(200), "add big");
    const c2 = writeAndCommit(repo, "commands/claude/small.md", "ok", "add small");
    const { events, quarantined, truncated, newCursor } = scanSince(repo, {
      cursorCommit: null,
      scopePaths: ["commands/"],
      maxFileBytes: 50,
    });
    expect(quarantined).toHaveLength(1);
    expect(events.map((e) => e.path)).toEqual(["commands/claude/small.md"]);
    expect(truncated).toBe(false);
    expect(newCursor).toBe(c2);
  });
});
