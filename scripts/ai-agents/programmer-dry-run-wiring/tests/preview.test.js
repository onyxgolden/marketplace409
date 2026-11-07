/**
 * preview.test.js — inert preview harness behaviour.
 *
 * DISABLED returns before opening any fixture (exit 10, even for a
 * nonexistent fixture name). SYNTHETIC_PREVIEW writes the private
 * item JSON + rendered HTML for a named fixture and nothing else.
 * Unknown fixtures, live-shaped modes and digest mismatches refuse.
 * The harness creates no worktree, runs no test, runs no Git, and
 * touches no network: it only reads fixture files and writes to the
 * explicit --out dir.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIRING = join(HERE, "..");
const RUNNER = join(WIRING, "preview", "run-preview.mjs");

function run(args) {
  return spawnSync(process.execPath, [RUNNER, ...args], { encoding: "utf8" });
}

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), "p5a-preview-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("DISABLED returns before opening fixtures (exit 10, even for a nonexistent fixture)", () => {
  const r = run(["--fixture", "does-not-exist", "--out", "/tmp/p5a-never-created"]);
  assert.equal(r.status, 10);
  const out = JSON.parse(r.stdout);
  assert.equal(out.code, "FEATURE_DISABLED");
  assert.equal(existsSync("/tmp/p5a-never-created"), false);
});

test("default mode is DISABLED (no --mode flag)", () => {
  const r = withTmp((dir) => run(["--fixture", "valid-verified", "--out", dir]));
  assert.equal(r.status, 10);
});

test("SYNTHETIC_PREVIEW writes the private item + rendered HTML", () => {
  withTmp((dir) => {
    const r = run(["--fixture", "valid-verified", "--out", dir, "--mode", "SYNTHETIC_PREVIEW"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const receipt = JSON.parse(r.stdout);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.verification_state, "PASS");
    assert.equal(receipt.lifecycle, "VERIFIED");
    const itemPath = join(dir, "valid-verified.private-item.json");
    const htmlPath = join(dir, "valid-verified.html");
    assert.equal(existsSync(itemPath), true);
    assert.equal(existsSync(htmlPath), true);
    const item = JSON.parse(readFileSync(itemPath, "utf8"));
    assert.equal(item.kind, "programmer-dry-run-proposal");
    assert.equal(item.execution_authorized, false);
    const html = readFileSync(htmlPath, "utf8");
    assert.match(html, /Verification: PASS/);
    assert.match(html, /Proposal only — never applied, committed, pushed, or merged by this system\./);
  });
});

test("each fixture previews to its mapped state", () => {
  const expected = {
    "valid-verified": "PASS",
    "failed-verification": "FAIL",
    "blocked-timeout": "BLOCKED",
    "not-run": "NOT_RUN",
    "malicious-strings": "PASS",
    "stale-digest": "PASS",
  };
  withTmp((dir) => {
    for (const [fixture, state] of Object.entries(expected)) {
      const r = run(["--fixture", fixture, "--out", dir, "--mode", "SYNTHETIC_PREVIEW"]);
      assert.equal(r.status, 0, `${fixture}: ${r.stdout} ${r.stderr}`);
      assert.equal(JSON.parse(r.stdout).verification_state, state, fixture);
    }
  });
});

test("oversized-diff fixture refuses (exit 12, BUDGET_EXCEEDED)", () => {
  withTmp((dir) => {
    const r = run(["--fixture", "oversized-diff", "--out", dir, "--mode", "SYNTHETIC_PREVIEW"]);
    assert.equal(r.status, 12);
    assert.equal(JSON.parse(r.stdout).code, "BUDGET_EXCEEDED");
    assert.equal(existsSync(join(dir, "oversized-diff.private-item.json")), false);
  });
});

test("unknown fixture refuses (exit 12)", () => {
  withTmp((dir) => {
    const r = run(["--fixture", "no-such-fixture", "--out", dir, "--mode", "SYNTHETIC_PREVIEW"]);
    assert.equal(r.status, 12);
    assert.equal(JSON.parse(r.stdout).code, "UNKNOWN_FIXTURE");
  });
});

test("live-shaped mode refuses with ACTIVATION_REQUIRED (exit 11)", () => {
  withTmp((dir) => {
    const r = run(["--fixture", "valid-verified", "--out", dir, "--mode", "LIVE"]);
    assert.equal(r.status, 11);
    assert.equal(JSON.parse(r.stdout).code, "ACTIVATION_REQUIRED");
  });
});

test("usage error exits 2 without a fixture or out dir", () => {
  const r = run(["--fixture", "valid-verified"]);
  assert.equal(r.status, 2);
});
