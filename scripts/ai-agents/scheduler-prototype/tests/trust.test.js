/** trust.test.js — S648A-005: spawn-based mutation tests for launchers.
 * Each test copies the prototype tree to a temp dir, mutates ONE file
 * (appending a canary), and runs the launcher. The launcher must refuse
 * (exit 3) BEFORE the canary executes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPROVED_ROOT = process.env.SCHED_APPROVED_ROOT;

function setupMutatedTree(mutatePath) {
  const tmp = mkdtempSync(join(tmpdir(), "sched-trust-"));
  cpSync(ROOT, tmp, { recursive: true, filter: (p) => !p.includes("node_modules") });
  const target = join(tmp, mutatePath);
  const original = readFileSync(target, "utf8");
  writeFileSync(target, original + '\nconsole.log("SCHED_REVIEW_CANARY");\n');
  return tmp;
}

function runLauncher(tmp, script) {
  return spawnSync(process.execPath, [join(tmp, script)], {
    env: { ...process.env, SCHED_APPROVED_ROOT: APPROVED_ROOT },
    encoding: "utf8",
    timeout: 30000,
  });
}

function assertRefused(r, label) {
  assert.equal(r.status, 3, `${label}: must exit 3 (got ${r.status})`);
  assert.ok(!r.stdout.includes("SCHED_REVIEW_CANARY"), `${label}: canary must not execute`);
  assert.ok(
    r.stderr.includes("trust authentication failed") || r.stderr.includes("hash mismatch"),
    `${label}: must report authentication failure (stderr: ${r.stderr.slice(0, 200)})`
  );
}

test("S648A-005: run-battery.js refuses mutated src/index.js", () => {
  if (!APPROVED_ROOT) { console.log("skip: no SCHED_APPROVED_ROOT"); return; }
  const tmp = setupMutatedTree("src/index.js");
  try {
    const r = runLauncher(tmp, "tests/run-battery.js");
    assertRefused(r, "run-battery/src/index.js");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("S648A-005: run-battery.js refuses mutated battery expectations", () => {
  if (!APPROVED_ROOT) { console.log("skip: no SCHED_APPROVED_ROOT"); return; }
  const tmp = setupMutatedTree("corpus/battery.json");
  try {
    const r = runLauncher(tmp, "tests/run-battery.js");
    assertRefused(r, "run-battery/corpus/battery.json");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("S648A-005: run-tests.js refuses mutated test helper", () => {
  if (!APPROVED_ROOT) { console.log("skip: no SCHED_APPROVED_ROOT"); return; }
  const tmp = setupMutatedTree("tests/budgets.test.js");
  try {
    const r = runLauncher(tmp, "tests/run-tests.js");
    assertRefused(r, "run-tests/tests/budgets.test.js");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("S648A-005: run-tests.js refuses mutated fixture store", () => {
  if (!APPROVED_ROOT) { console.log("skip: no SCHED_APPROVED_ROOT"); return; }
  const tmp = setupMutatedTree("fixtures/store.json");
  try {
    const r = runLauncher(tmp, "tests/run-tests.js");
    assertRefused(r, "run-tests/fixtures/store.json");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("S648A-005: run-battery.js refuses mutated manifest", () => {
  if (!APPROVED_ROOT) { console.log("skip: no SCHED_APPROVED_ROOT"); return; }
  const tmp = setupMutatedTree("corpus/manifest.json");
  try {
    const r = runLauncher(tmp, "tests/run-battery.js");
    // Manifest mutation breaks the digest; must refuse before imports.
    assert.equal(r.status, 3, "must exit 3");
    assert.ok(!r.stdout.includes("SCHED_REVIEW_CANARY"), "canary must not execute");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
