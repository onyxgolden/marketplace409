/**
 * trust-bootstrap.test.js — frozen regressions for P666-004A.
 *
 * The trust entry (runner/trust-entry.mjs) must authenticate the
 * entire closure against the host trust root BEFORE any candidate
 * byte is imported. Each test spawns the entry as a child process
 * against the live wiring tree, mutating one pinned file at a time
 * (restored in a finally, exactly like the reviewer's probes) and
 * asserting:
 *   - exit code 3 (trust failure), and
 *   - ZERO pre-auth execution: a canary appended to the mutated
 *     file must never run (its sentinel file must not exist).
 *
 * The host trust root rides the test process's own environment
 * (RENTAL_OPS_TRUST_ROOT) — the entry refuses to read it from the
 * candidate tree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIRING_ROOT = join(HERE, "..");
const ENTRY = join(WIRING_ROOT, "runner", "trust-entry.mjs");
const HOST_ROOT = process.env.RENTAL_OPS_TRUST_ROOT;

function spawnEntry({ entry = "tests/trust-ping.mjs", trustRoot = HOST_ROOT, dropRoot = false } = {}) {
  const env = { ...process.env };
  if (dropRoot) delete env.RENTAL_OPS_TRUST_ROOT;
  else if (trustRoot !== undefined) env.RENTAL_OPS_TRUST_ROOT = trustRoot;
  try {
    const out = execFileSync(process.execPath, [ENTRY, "--entry", entry], { env, encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** Append `canary` to `rel`, run fn, then restore the original bytes. */
function withMutation(rel, canary, fn) {
  const abs = join(WIRING_ROOT, rel);
  const original = readFileSync(abs, "utf8");
  const sentinel = join(mkdtempSync(join(tmpdir(), "canary-")), "fired");
  const canarySrc = `\n;await import("node:fs").then((m) => m.appendFileSync(${JSON.stringify(sentinel)}, "x"));${canary}\n`;
  writeFileSync(abs, original + canarySrc);
  try {
    return fn(sentinel);
  } finally {
    writeFileSync(abs, original);
    rmSync(dirname(sentinel), { recursive: true, force: true });
  }
}

const sentinelFired = (sentinel) => {
  try { readFileSync(sentinel); return true; } catch { return false; }
};

test("trust bootstrap: happy path reaches an authenticated entry", () => {
  assert.ok(HOST_ROOT, "RENTAL_OPS_TRUST_ROOT must be set to run the trust suite");
  const r = spawnEntry();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /trust-ping-ok/);
});

test("trust bootstrap: a canary in bootstrap.mjs never executes (digest mismatch -> exit 3)", () => {
  const r = withMutation("runner/bootstrap.mjs", "", (sentinel) => {
    const res = spawnEntry();
    return { res, fired: sentinelFired(sentinel) };
  });
  assert.equal(r.res.code, 3, r.res.out);
  assert.match(r.res.out, /digest mismatch/);
  assert.equal(r.fired, false, "canary in bootstrap.mjs EXECUTED before the trust refusal");
});

test("trust bootstrap: a canary in the classifier never executes (unpinned transitive dep is now pinned)", () => {
  const r = withMutation("../../../src/application/rental/isChargeForgeCollectible.js", "", (sentinel) => {
    const res = spawnEntry();
    return { res, fired: sentinelFired(sentinel) };
  });
  assert.equal(r.res.code, 3, r.res.out);
  assert.equal(r.fired, false, "canary in the classifier EXECUTED before the trust refusal");
});

test("trust bootstrap: a mutated manifest.json fails the host root comparison (exit 3)", () => {
  const abs = join(WIRING_ROOT, "runner", "manifest.json");
  const original = readFileSync(abs, "utf8");
  writeFileSync(abs, original.replace('"schema": "rental-ops-wiring-manifest@2"', '"schema": "rental-ops-wiring-manifest@2-tampered"'));
  try {
    const r = spawnEntry();
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /trust root mismatch/);
  } finally {
    writeFileSync(abs, original);
  }
});

test("trust bootstrap: no host trust root fails closed (exit 3)", () => {
  const r = spawnEntry({ dropRoot: true });
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /no host trust root/);
});

test("trust bootstrap: a wrong host trust root is refused (exit 3)", () => {
  const r = spawnEntry({ trustRoot: "0".repeat(64) });
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /trust root mismatch/);
});

test("trust bootstrap: an entry outside the authenticated manifest is refused (exit 3)", () => {
  const stray = join(HERE, "zz-unlisted.test.js");
  writeFileSync(stray, "import { test } from 'node:test';\ntest('unlisted', () => {});\n");
  try {
    const r = spawnEntry({ entry: "tests/zz-unlisted.test.js" });
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /not an authenticated manifest member/);
  } finally {
    unlinkSync(stray);
  }
});
