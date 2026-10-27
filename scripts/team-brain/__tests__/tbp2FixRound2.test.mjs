// Team Brain P2 fix round 2 — ChatGPT NO-GO re-review 2026-10-26
// (residuals TBP2-002A/003A/004A/006A/007A; TBP2-001 and TBP2-005 stay
// closed and are not re-litigated here). Every group below is a
// failing-before / passing-after probe at the public boundary: it fails
// against head b2f01c3 and passes at the fix-round head. Synthetic
// fixtures only, real local Git repos only, no network, no DB, no
// production writes.

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
function run(repo, args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}
function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), "tb-fixround2-"));
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

// ------------------------------------------------------------ TBP2-002A --
describe("TBP2-002A finite numbers and typed resource validation", () => {
  it("a raw-JSON 1e400 tamper of a signed null does not verify (no Infinity reaches a handler)", () => {
    const setup = setupPrincipal();
    const signed = envelopeFor({ ...setup, payload: { n: null } });
    const serialized = JSON.stringify(signed);
    expect(serialized).toContain('"n":null');
    const tampered = JSON.parse(serialized.replace('"n":null', '"n":1e400'));
    expect(tampered.payload.n).toBe(Infinity);
    // Validation runs before hashing/dispatch, so this is MALFORMED, not
    // a hash mismatch that a later layer might treat as a soft failure.
    expectCode(() => verifyEnvelopeSignature(tampered, setup.publicKey), CODES.MALFORMED_ENVELOPE);
  });

  it("the same tamper never reaches a handler, even through handleEnvelope", () => {
    const setup = setupPrincipal();
    const signed = envelopeFor({ ...setup, payload: { n: null } });
    const tampered = JSON.parse(JSON.stringify(signed).replace('"n":null', '"n":1e400'));
    let handlerCalled = false;
    const api = createApi(setup.registry, {
      submit_task: () => {
        handlerCalled = true;
        return "ok";
      },
    });
    expectCode(() => handleEnvelope(api, tampered), CODES.MALFORMED_ENVELOPE);
    expect(handlerCalled).toBe(false);
  });

  it("finite numbers and null still verify", () => {
    const setup = setupPrincipal();
    for (const payload of [{ n: 0 }, { n: -1.5 }, { n: null }, { n: 1e10 }]) {
      const env = envelopeFor({ ...setup, payload });
      expect(() => verifyEnvelopeSignature(env, setup.publicKey)).not.toThrow();
    }
  });

  it("an issued_at offset outside any real range is refused, valid offsets pass", () => {
    const setup = setupPrincipal();
    expect(() =>
      envelopeFor({ ...setup, issuedAt: "2026-10-26T12:00:00+99:99" })
    ).toThrow(TeamBrainTrustError);
    const ok = envelopeFor({ ...setup, issuedAt: "2026-10-26T12:00:00+05:30" });
    expect(ok.issued_at).toBe("2026-10-26T12:00:00+05:30");
  });

  it("a non-canonical reviewed_head is refused; a 40-hex head passes", () => {
    const setup = setupPrincipal();
    expect(() =>
      envelopeFor({
        ...setup,
        resource: { repo: "onyxgolden/forge-ai-drop", scope: "lane-a", reviewed_head: "not-a-hash" },
      })
    ).toThrow(TeamBrainTrustError);
    const ok = envelopeFor({
      ...setup,
      resource: { repo: "onyxgolden/forge-ai-drop", scope: "lane-a", reviewed_head: HEAD_A },
    });
    expect(ok.resource.reviewed_head).toBe(HEAD_A);
  });

  it("submit_verdict requires scope, source, and head; a plain task does not fabricate a head", () => {
    const setup = setupPrincipal({ grantedOps: ["submit_task", "submit_verdict"] });
    expect(() =>
      envelopeFor({
        ...setup,
        operation: "submit_verdict",
        resource: { repo: "onyxgolden/forge-ai-drop", scope: "lane-a", reviewed_head: HEAD_A },
      })
    ).toThrow(TeamBrainTrustError);
    const verdict = envelopeFor({
      ...setup,
      operation: "submit_verdict",
      resource: { repo: "onyxgolden/forge-ai-drop", scope: "lane-a", source: "chatgpt", reviewed_head: HEAD_A },
    });
    expect(verdict.resource.source).toBe("chatgpt");
    const task = envelopeFor({ ...setup, operation: "submit_task" });
    expect(task.resource.reviewed_head).toBeUndefined();
  });
});

// ------------------------------------------------------------ TBP2-003A --
describe("TBP2-003A outer expected-pin schema is closed", () => {
  it("a misplaced reviewed_head at the outer expected level is refused, not ignored", () => {
    const setup = setupPrincipal();
    const env = envelopeFor({
      ...setup,
      resource: { repo: "onyxgolden/forge-ai-drop", scope: "lane-a", reviewed_head: HEAD_A },
    });
    const api = createApi(setup.registry, { submit_task: () => "ok" });
    expectCode(
      () => handleEnvelope(api, env, { resource: { repo: "onyxgolden/forge-ai-drop" }, reviewed_head: HEAD_B }),
      CODES.MALFORMED_ENVELOPE
    );
  });

  it("an unknown outer expected field is refused", () => {
    const setup = setupPrincipal();
    const env = envelopeFor({ ...setup });
    const api = createApi(setup.registry, { submit_task: () => "ok" });
    expectCode(() => handleEnvelope(api, env, { resource: { repo: "onyxgolden/forge-ai-drop" }, bogus: 1 }), CODES.MALFORMED_ENVELOPE);
  });

  it("a matching nested pin still succeeds", () => {
    const setup = setupPrincipal();
    const env = envelopeFor({
      ...setup,
      resource: { repo: "onyxgolden/forge-ai-drop", scope: "lane-a", reviewed_head: HEAD_A },
    });
    const api = createApi(setup.registry, { submit_task: () => "ok" });
    expect(
      handleEnvelope(api, env, { resource: { repo: "onyxgolden/forge-ai-drop", scope: "lane-a", reviewed_head: HEAD_A } })
    ).toBe("ok");
  });
});

// ------------------------------------------------------------ TBP2-004A --
describe("TBP2-004A async handlers settle before being marked processed", () => {
  it("an async rejection propagates the handler error and leaves the operation unseen", async () => {
    const setup = setupPrincipal();
    const env = envelopeFor({ ...setup, operationId: "op-async-2" });
    let attempts = 0;
    const api = createApi(setup.registry, {
      submit_task: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("synthetic failed write");
        return "done";
      },
    });
    await expect(async () => handleEnvelope(api, env)).rejects.toThrow("synthetic failed write");
    expect(setup.registry.seenOperations.size).toBe(0);
    await expect(handleEnvelope(api, env)).resolves.toBe("done");
    expect(setup.registry.seenOperations.size).toBe(1);
  });

  it("a delayed async success is marked processed only after it settles", async () => {
    const setup = setupPrincipal();
    const env = envelopeFor({ ...setup, operationId: "op-async-3" });
    const api = createApi(setup.registry, {
      submit_task: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return "late";
      },
    });
    const pending = handleEnvelope(api, env);
    expect(pending && typeof pending.then === "function").toBe(true);
    await expect(pending).resolves.toBe("late");
    expect(setup.registry.seenOperations.size).toBe(1);
  });

  it("a duplicate while pending is excluded, not admitted, and a changed binding while pending is also excluded", async () => {
    const setup = setupPrincipal();
    const env = envelopeFor({ ...setup, operationId: "op-async-4" });
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const api = createApi(setup.registry, {
      submit_task: () => gate.then(() => "released"),
    });
    const first = handleEnvelope(api, env);
    expect(first && typeof first.then === "function").toBe(true);
    await expectCode(() => handleEnvelope(api, env), CODES.OPERATION_PENDING);
    const changed = envelopeFor({ ...setup, operationId: "op-async-4", nonce: "n2" });
    await expectCode(() => handleEnvelope(api, changed), CODES.OPERATION_PENDING);
    release();
    await expect(first).resolves.toBe("released");
    expectCode(() => handleEnvelope(api, env), CODES.OPERATION_REPLAYED);
  });
});

// ------------------------------------------------------------ TBP2-006A --
describe("TBP2-006A merge-selection evidence is retained, not a duplicate ADDED", () => {
  it("a conflict resolved to one parent emits a merge-selection observation with that parent's content", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/x.md", "base\n", "base");
    run(repo, ["checkout", "-q", "-b", "side"]);
    writeAndCommit(repo, "commands/x.md", "side B\n", "side B");
    run(repo, ["checkout", "-q", "main"]);
    writeAndCommit(repo, "commands/x.md", "main A\n", "main A");
    let mergeOutcome;
    try {
      mergeOutcome = run(repo, ["merge", "--no-ff", "side", "-m", "merge side"]);
    } catch {
      mergeOutcome = "";
    }
    void mergeOutcome;
    writeFileSync(join(repo, "commands/x.md"), "main A\n");
    run(repo, ["add", "commands/x.md"]);
    run(repo, ["commit", "-q", "-m", "resolve to main A"]);
    const mergeCommit = headCommit(repo);
    const { events } = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"] });
    const forPath = events.filter((e) => e.path === "commands/x.md");
    const atMerge = forPath.filter((e) => e.introducingCommit === mergeCommit);
    expect(atMerge.length).toBe(1);
    expect(atMerge[0].eventKind).toBe("MERGE_SELECTED");
    expect(atMerge[0].contentSha256).toBe(sha256Text("main A\n"));
    expect(forPath.filter((e) => e.eventKind === "ADDED" && e.introducingCommit === mergeCommit).length).toBe(0);
  });

  it("the reverse parent order selects the other parent's content", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/x.md", "base\n", "base");
    run(repo, ["checkout", "-q", "-b", "side"]);
    writeAndCommit(repo, "commands/x.md", "side B\n", "side B");
    run(repo, ["checkout", "-q", "main"]);
    writeAndCommit(repo, "commands/x.md", "main A\n", "main A");
    run(repo, ["checkout", "-q", "side"]);
    try {
      run(repo, ["merge", "--no-ff", "main", "-m", "merge main"]);
    } catch {
      // conflict expected
    }
    writeFileSync(join(repo, "commands/x.md"), "side B\n");
    run(repo, ["add", "commands/x.md"]);
    run(repo, ["commit", "-q", "-m", "resolve to side B"]);
    const mergeCommit = headCommit(repo);
    const { events } = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"] });
    const atMerge = events.filter((e) => e.path === "commands/x.md" && e.introducingCommit === mergeCommit);
    expect(atMerge.length).toBe(1);
    expect(atMerge[0].eventKind).toBe("MERGE_SELECTED");
    expect(atMerge[0].contentSha256).toBe(sha256Text("side B\n"));
  });

  it("a clean merge still emits no merge event for an unchanged side introduction", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/a.md", "a\n", "base");
    run(repo, ["checkout", "-q", "-b", "side"]);
    const sideCommit = writeAndCommit(repo, "commands/b.md", "b\n", "side adds b");
    run(repo, ["checkout", "-q", "main"]);
    writeAndCommit(repo, "commands/a.md", "a2\n", "main touches a");
    run(repo, ["merge", "-q", "--no-ff", "side", "-m", "merge side"]);
    const mergeCommit = headCommit(repo);
    const { events } = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"] });
    const bEvents = events.filter((e) => e.path === "commands/b.md");
    expect(bEvents.filter((e) => e.eventKind === "ADDED").length).toBe(1);
    expect(bEvents[0].introducingCommit).toBe(sideCommit);
    expect(bEvents.filter((e) => e.introducingCommit === mergeCommit).length).toBe(0);
  });

  it("a truly new merge-resolution byte string is still a MODIFIED at the merge", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/x.md", "base\n", "base");
    run(repo, ["checkout", "-q", "-b", "side"]);
    writeAndCommit(repo, "commands/x.md", "side B\n", "side B");
    run(repo, ["checkout", "-q", "main"]);
    writeAndCommit(repo, "commands/x.md", "main A\n", "main A");
    try {
      run(repo, ["merge", "--no-ff", "side", "-m", "merge side"]);
    } catch {
      // conflict expected
    }
    writeFileSync(join(repo, "commands/x.md"), "resolved new\n");
    run(repo, ["add", "commands/x.md"]);
    run(repo, ["commit", "-q", "-m", "resolve new"]);
    const mergeCommit = headCommit(repo);
    const { events } = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"] });
    const atMerge = events.filter((e) => e.path === "commands/x.md" && e.introducingCommit === mergeCommit);
    expect(atMerge.length).toBe(1);
    expect(atMerge[0].eventKind).toBe("MODIFIED");
    expect(atMerge[0].contentSha256).toBe(sha256Text("resolved new\n"));
  });
});

// ------------------------------------------------------------ TBP2-007A --
describe("TBP2-007A a single per-poll deadline binds the whole scan", () => {
  it(
    "a paced scan that would exceed its poll budget truncates with the cursor preserved, not a false complete advance",
    () => {
      const repo = initRepo();
      let cursor = writeAndCommit(repo, "commands/f0.md", "f0\n", "f0");
      for (let i = 1; i < 8; i += 1) {
        writeAndCommit(repo, `commands/f${i}.md`, `f${i}\n`, `f${i}`);
      }
      const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
      const shimDir = mkdtempSync(join(tmpdir(), "tb-gitshim-"));
      createdDirs.push(shimDir);
      const shimPath = join(shimDir, "git");
      writeFileSync(shimPath, `#!/bin/sh\nsleep 0.35\nexec ${realGit} "$@"\n`);
      chmodSync(shimPath, 0o755);
      const originalPath = process.env.PATH;
      process.env.PATH = `${shimDir}:${originalPath}`;
      let blocked = false;
      try {
        const result = scanSince(repo, { cursorCommit: cursor, scopePaths: ["commands/"], pollDeadlineMs: 3000 });
        expect(result.truncated).toBe(true);
        expect(result.newCursor).toBe(cursor);
      } catch (e) {
        // A git call that straddles the deadline times out under the
        // remaining-time bound and surfaces as an explicit
        // INTAKE_BLOCKED instead of a truncated return. Both are safe
        // incomplete states: neither claims a complete advance, and
        // the caller keeps the old cursor either way.
        expect(e).toBeInstanceOf(TeamBrainTrustError);
        expect(e.code).toBe(CODES.INTAKE_BLOCKED);
        blocked = true;
      } finally {
        process.env.PATH = originalPath;
      }
      void blocked;
      // Recovery: a fresh poll from the same cursor (no shim) still
      // completes and advances — a deadline overrun never loses the
      // uninspected history.
      const recovered = scanSince(repo, { cursorCommit: cursor, scopePaths: ["commands/"] });
      expect(recovered.truncated).toBe(false);
      expect(recovered.events.length).toBe(7);
      expect(recovered.newCursor).toBe(headCommit(repo));
    },
    30000
  );

  it("a small scan well inside its budget still completes and advances the cursor", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/a.md", "a\n", "base");
    writeAndCommit(repo, "commands/b.md", "b\n", "add b");
    const result = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"] });
    expect(result.truncated).toBe(false);
    expect(result.events.length).toBe(1);
    expect(result.newCursor).toBe(headCommit(repo));
  });
});
