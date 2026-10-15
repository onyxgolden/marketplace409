/**
 * mutation.test.js — tamper regressions proving the manifest trust
 * bootstrap (tests/run-tests.js / tests/run-battery.js) refuses BEFORE
 * any scored import or canary execution, for tampering at every pinned
 * layer: a fixture, the independent oracle, the battery authoring
 * output, a shared helper, and package.json itself. Each works on a
 * throwaway temp copy of the whole prototype tree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function freshCopy() {
  const dir = mkdtempSync(join(tmpdir(), "em-mutation-"));
  cpSync(ROOT, dir, { recursive: true });
  return dir;
}

function approvedRootOf(dir) {
  return readFileSync(join(dir, "corpus", "corpus_digest.txt"), "utf8").trim();
}

function runGuarded(dir, script) {
  const env = { ...process.env, EM_APPROVED_ROOT: approvedRootOf(dir) };
  return spawnSync(process.execPath, [join(dir, script)], { env, encoding: "utf8" });
}

test("mutation: tampering a fixture file after freezing is caught before any test runs", () => {
  const dir = freshCopy();
  try {
    const p = join(dir, "fixtures", "store.json");
    const original = readFileSync(p, "utf8");
    writeFileSync(p, original.slice(0, -2) + "TAMPERED\n"); // byte-level corruption, digest no longer matches
    const res = runGuarded(dir, "tests/run-tests.js");
    assert.equal(res.status, 3);
    assert.match(res.stderr, /trust failure/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutation: tampering the independent oracle is caught before any battery case runs", () => {
  const dir = freshCopy();
  try {
    const p = join(dir, "corpus", "oracle.js");
    writeFileSync(p, readFileSync(p, "utf8") + "\n// tampered\n");
    const res = runGuarded(dir, "tests/run-battery.js");
    assert.equal(res.status, 3);
    assert.match(res.stderr, /trust failure/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutation: tampering the frozen battery.json (expected values) is caught before scoring", () => {
  const dir = freshCopy();
  try {
    const p = join(dir, "corpus", "battery.json");
    const battery = JSON.parse(readFileSync(p, "utf8"));
    battery[0].expected.status = "TAMPERED_EXPECTATION";
    writeFileSync(p, JSON.stringify(battery));
    const res = runGuarded(dir, "tests/run-battery.js");
    assert.equal(res.status, 3);
    assert.match(res.stderr, /trust failure/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutation: tampering a shared test helper (harness.js) is caught before any test runs", () => {
  const dir = freshCopy();
  try {
    const p = join(dir, "tests", "harness.js");
    writeFileSync(p, readFileSync(p, "utf8") + "\n// tampered\n");
    const res = runGuarded(dir, "tests/run-tests.js");
    assert.equal(res.status, 3);
    assert.match(res.stderr, /trust failure/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutation: tampering package.json itself is caught (manifest pins package.json too)", () => {
  const dir = freshCopy();
  try {
    const p = join(dir, "package.json");
    const pkg = JSON.parse(readFileSync(p, "utf8"));
    pkg.scripts.battery = "node -e \"console.log('bypassed')\"";
    writeFileSync(p, JSON.stringify(pkg));
    const res = runGuarded(dir, "tests/run-battery.js");
    assert.equal(res.status, 3);
    assert.match(res.stderr, /trust failure/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutation: adding an unlisted executable file is caught (no test discovery of unpinned files)", () => {
  const dir = freshCopy();
  try {
    writeFileSync(join(dir, "tests", "zzz-unlisted.test.js"), "// not in the manifest\n");
    const res = runGuarded(dir, "tests/run-tests.js");
    assert.equal(res.status, 3);
    assert.match(res.stderr, /trust failure/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutation: the approved root itself must be exactly the recomputed digest — a plausible-looking but wrong root also refuses", () => {
  const dir = freshCopy();
  try {
    const env = { ...process.env, EM_APPROVED_ROOT: "0".repeat(64) };
    const res = spawnSync(process.execPath, [join(dir, "tests", "run-tests.js")], { env, encoding: "utf8" });
    assert.equal(res.status, 3);
    assert.match(res.stderr, /trust failure/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutation: unaffected battery runs clean on an untampered copy (sanity control for the tests above)", () => {
  const dir = freshCopy();
  try {
    const res = runGuarded(dir, "tests/run-battery.js");
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /BATTERY: ALL GATES PASS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
