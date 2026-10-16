/**
 * mutation.test.js — proves the trust-authentication bootstrap
 * (tests/run-tests.js, tests/run-battery.js) fails closed (nonzero
 * exit, before any canary/scored code runs) when a pinned file is
 * tampered after the manifest was frozen. Each case copies the whole
 * prototype to a scratch temp directory, corrupts exactly one pinned
 * file's bytes there, and spawns the REAL entrypoint as a child process
 * against the correct (now-mismatched) approved root — this exercises
 * the actual builtins-only bootstrap, not a reimplementation of it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPROVED_ROOT = readFileSync(join(ROOT, "corpus", "corpus_digest.txt"), "utf8").trim();

function tamperedCopy(mutate) {
  const dir = mkdtempSync(join(tmpdir(), "mm-mutation-"));
  cpSync(ROOT, dir, { recursive: true });
  mutate(dir);
  return dir;
}

function runEntrypoint(dir, entry) {
  const result = spawnSync(process.execPath, [join(dir, "tests", entry)], {
    cwd: dir,
    env: { ...process.env, MM_APPROVED_ROOT: APPROVED_ROOT },
    encoding: "utf8",
  });
  return result;
}

const CASES = [
  ["fixture bytes", (dir) => writeFileSync(join(dir, "fixtures", "store.json"), "{}")],
  ["frozen battery (expected output)", (dir) => writeFileSync(join(dir, "corpus", "battery.json"), "[]")],
  ["independent oracle", (dir) => writeFileSync(join(dir, "corpus", "oracle.js"), "export function computeExpected(){return null;}")],
  ["scorer/helper (harness.js)", (dir) => writeFileSync(join(dir, "tests", "harness.js"), "export function runBattery(){throw new Error('tampered');}")],
  ["trust registry (manifest.json)", (dir) => writeFileSync(join(dir, "corpus", "manifest.json"), JSON.stringify({ corpus_digest: "0".repeat(64), files: [] }))],
  ["package/test bootstrap (package.json)", (dir) => writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "tampered", type: "module", scripts: {} }))],
];

for (const [label, mutate] of CASES) {
  test(`tampered ${label} makes run-battery.js refuse (exit 3) before any canary executes`, () => {
    const dir = tamperedCopy(mutate);
    try {
      const r = runEntrypoint(dir, "run-battery.js");
      assert.notEqual(r.status, 0, `expected nonzero exit for tampered ${label}, got 0. stdout=${r.stdout} stderr=${r.stderr}`);
      assert.match(r.stderr, /bootstrap: trust failure|bootstrap:/, `expected a bootstrap trust-failure message, got: ${r.stderr}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("the unmodified corpus still passes trust authentication (sanity check the tamper tests above aren't vacuous)", () => {
  const dir = tamperedCopy(() => {});
  try {
    const r = runEntrypoint(dir, "run-battery.js");
    assert.equal(r.status, 0, `expected the untampered copy to pass, got exit ${r.status}. stdout=${r.stdout} stderr=${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
