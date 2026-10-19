/**
 * trust.test.js — spawn-based mutation tests for the trust bootstrap.
 *
 * S653-009: the official entrypoint is now ../bootstrap.mjs, the
 * host-pinned trust anchor. Each test copies the prototype tree to a temp
 * dir, mutates ONE scored file (appending a canary), and runs the
 * bootstrap. The bootstrap must authenticate the corpus digest BEFORE
 * importing any candidate code, so it refuses (exit 3) and the canary
 * never executes. Mutating the bootstrap itself is the host's problem:
 * the host pins its sha256 out-of-band (published in the review request
 * and README) and verifies it before running.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPROVED_ROOT = process.env.SALES_APPROVED_ROOT;

function setupMutatedTree(mutatePath, marker = "SALES_REVIEW_CANARY") {
  const tmp = mkdtempSync(join(tmpdir(), "sales-trust-"));
  cpSync(ROOT, tmp, { recursive: true, filter: (p) => !p.includes("node_modules") });
  const target = join(tmp, mutatePath);
  const original = readFileSync(target, "utf8");
  writeFileSync(target, original + `\nconsole.log("${marker}");\n`);
  return tmp;
}

function runBootstrap(tmp, mode) {
  return spawnSync(process.execPath, [join(tmp, "bootstrap.mjs"), mode], {
    env: { ...process.env, SALES_APPROVED_ROOT: APPROVED_ROOT },
    encoding: "utf8",
    timeout: 60000,
  });
}

function assertRefused(r, label) {
  assert.equal(r.status, 3, `${label}: must exit 3 (got ${r.status})`);
  assert.ok(!r.stdout.includes("SALES_REVIEW_CANARY"), `${label}: canary must not execute`);
  assert.ok(!r.stderr.includes("SALES_REVIEW_CANARY"), `${label}: canary must not execute (stderr)`);
  assert.ok(
    r.stderr.includes("trust authentication failed") || r.stderr.includes("hash mismatch") || r.stderr.includes("refusing"),
    `${label}: must report authentication failure (stderr: ${r.stderr.slice(0, 200)})`
  );
}

test("trust: bootstrap refuses mutated src/index.js before any candidate executes", () => {
  if (!APPROVED_ROOT) { console.log("skip: no SALES_APPROVED_ROOT"); return; }
  const tmp = setupMutatedTree("src/index.js");
  try {
    const r = runBootstrap(tmp, "test");
    assertRefused(r, "bootstrap/src/index.js");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("trust: bootstrap refuses mutated battery expectations", () => {
  if (!APPROVED_ROOT) { console.log("skip: no SALES_APPROVED_ROOT"); return; }
  const tmp = setupMutatedTree("corpus/battery.json");
  try {
    const r = runBootstrap(tmp, "battery");
    assertRefused(r, "bootstrap/corpus/battery.json");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("trust: bootstrap refuses mutated launcher (tests/run-tests.js) before it runs", () => {
  // S653-009: the old failure mode was a canary AFTER the shebang of the
  // authenticating launcher executing before the digest check. The
  // launcher is now imported only post-authentication.
  if (!APPROVED_ROOT) { console.log("skip: no SALES_APPROVED_ROOT"); return; }
  const tmp = setupMutatedTree("tests/run-tests.js");
  try {
    const r = runBootstrap(tmp, "test");
    assertRefused(r, "bootstrap/tests/run-tests.js");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("trust: bootstrap refuses mutated helper (tests/helpers.js)", () => {
  if (!APPROVED_ROOT) { console.log("skip: no SALES_APPROVED_ROOT"); return; }
  const tmp = setupMutatedTree("tests/helpers.js");
  try {
    const r = runBootstrap(tmp, "battery");
    assertRefused(r, "bootstrap/tests/helpers.js");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("trust: bootstrap refuses with wrong approval root", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "bootstrap.mjs"), "test"], {
    env: { ...process.env, SALES_APPROVED_ROOT: "0".repeat(64) },
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(r.status, 3);
});

test("trust: bootstrap refuses a missing approval root", () => {
  const env = { ...process.env };
  delete env.SALES_APPROVED_ROOT;
  const r = spawnSync(process.execPath, [join(ROOT, "bootstrap.mjs"), "test"], {
    env, encoding: "utf8", timeout: 30000,
  });
  assert.equal(r.status, 3);
});
