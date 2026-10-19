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
import { tmpdir, homedir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPROVED_ROOT = process.env.RESEARCH_APPROVED_ROOT;
// RA652-002: the separately trusted bootstrap (outside the repo).
const BOOTSTRAP = join(homedir(), "workspace", "research-prototype-trust", "bootstrap.js");

function setupMutatedTree(mutatePath) {
  const tmp = mkdtempSync(join(tmpdir(), "research-trust-"));
  cpSync(ROOT, tmp, { recursive: true, filter: (p) => !p.includes("node_modules") });
  const target = join(tmp, mutatePath);
  const original = readFileSync(target, "utf8");
  writeFileSync(target, original + '\nconsole.log("RESEARCH_REVIEW_CANARY");\n');
  return tmp;
}

function runLauncher(tmp, script) {
  return spawnSync(process.execPath, [join(tmp, script)], {
    env: { ...process.env, RESEARCH_APPROVED_ROOT: APPROVED_ROOT },
    encoding: "utf8",
    timeout: 30000,
  });
}

function assertRefused(r, label) {
  assert.equal(r.status, 3, `${label}: must exit 3 (got ${r.status})`);
  assert.ok(!r.stdout.includes("RESEARCH_REVIEW_CANARY"), `${label}: canary must not execute`);
  assert.ok(
    r.stderr.includes("trust authentication failed") || r.stderr.includes("hash mismatch"),
    `${label}: must report authentication failure (stderr: ${r.stderr.slice(0, 200)})`
  );
}

test("S648A-005: run-battery.js refuses mutated src/index.js", () => {
  if (!APPROVED_ROOT) { console.log("skip: no RESEARCH_APPROVED_ROOT"); return; }
  const tmp = setupMutatedTree("src/index.js");
  try {
    const r = runLauncher(tmp, "tests/run-battery.js");
    assertRefused(r, "run-battery/src/index.js");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("S648A-005: run-battery.js refuses mutated battery expectations", () => {
  if (!APPROVED_ROOT) { console.log("skip: no RESEARCH_APPROVED_ROOT"); return; }
  const tmp = setupMutatedTree("corpus/battery.json");
  try {
    const r = runLauncher(tmp, "tests/run-battery.js");
    assertRefused(r, "run-battery/corpus/battery.json");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("S648A-005: run-tests.js refuses mutated test helper", () => {
  if (!APPROVED_ROOT) { console.log("skip: no RESEARCH_APPROVED_ROOT"); return; }
  const tmp = setupMutatedTree("tests/budgets.test.js");
  try {
    const r = runLauncher(tmp, "tests/run-tests.js");
    assertRefused(r, "run-tests/tests/budgets.test.js");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("S648A-005: run-tests.js refuses mutated fixture store", () => {
  if (!APPROVED_ROOT) { console.log("skip: no RESEARCH_APPROVED_ROOT"); return; }
  const tmp = setupMutatedTree("fixtures/store.json");
  try {
    const r = runLauncher(tmp, "tests/run-tests.js");
    assertRefused(r, "run-tests/fixtures/store.json");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("S648A-005: run-battery.js refuses mutated manifest", () => {
  if (!APPROVED_ROOT) { console.log("skip: no RESEARCH_APPROVED_ROOT"); return; }
  const tmp = setupMutatedTree("corpus/manifest.json");
  try {
    const r = runLauncher(tmp, "tests/run-battery.js");
    // Manifest mutation breaks the digest; must refuse before imports.
    assert.equal(r.status, 3, "must exit 3");
    assert.ok(!r.stdout.includes("RESEARCH_REVIEW_CANARY"), "canary must not execute");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- RA652-002: prepend/top-of-file marker canaries ----
// The old mutation tests appended canaries AFTER the launcher's own
// trust check, so they could not prove pre-execution authentication.
// A malicious PREPEND at the top of a launcher runs before any of its
// own code. The fix: the separately trusted bootstrap authenticates
// every byte before ANY candidate byte executes. These tests prepend a
// canary to the top of each official entrypoint and each
// runtime/watchdog-chain file, then invoke the suite through the
// bootstrap: the canary must never execute and the run must refuse
// (exit 3).

function setupPrependedTree(mutatePath) {
  const tmp = mkdtempSync(join(tmpdir(), "research-trust-pre-"));
  cpSync(ROOT, tmp, { recursive: true, filter: (p) => !p.includes("node_modules") });
  const target = join(tmp, mutatePath);
  const original = readFileSync(target, "utf8");
  // Prepend: this line would execute before anything else in the file.
  writeFileSync(target, 'console.log("RESEARCH_REVIEW_CANARY_TOP");\n' + original);
  return tmp;
}

function runViaBootstrap(tmp, command) {
  return spawnSync(process.execPath, [BOOTSTRAP, tmp, command], {
    env: { ...process.env, RESEARCH_APPROVED_ROOT: APPROVED_ROOT },
    encoding: "utf8",
    timeout: 120000,
  });
}

function assertBootstrapRefused(r, label) {
  assert.equal(r.status, 3, `${label}: bootstrap must exit 3 (got ${r.status})`);
  assert.ok(!r.stdout.includes("RESEARCH_REVIEW_CANARY_TOP"), `${label}: prepended canary must not execute`);
  assert.ok(
    r.stderr.includes("trust authentication failed") || r.stderr.includes("hash mismatch"),
    `${label}: must report authentication failure (stderr: ${r.stderr.slice(0, 200)})`
  );
}

test("RA652-002: bootstrap refuses prepended canary in tests/run-tests.js", () => {
  if (!APPROVED_ROOT) { console.log("skip: no RESEARCH_APPROVED_ROOT"); return; }
  const tmp = setupPrependedTree("tests/run-tests.js");
  try {
    assertBootstrapRefused(runViaBootstrap(tmp, "tests"), "prepend/run-tests.js");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("RA652-002: bootstrap refuses prepended canary in tests/run-battery.js", () => {
  if (!APPROVED_ROOT) { console.log("skip: no RESEARCH_APPROVED_ROOT"); return; }
  const tmp = setupPrependedTree("tests/run-battery.js");
  try {
    assertBootstrapRefused(runViaBootstrap(tmp, "battery"), "prepend/run-battery.js");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("RA652-002: bootstrap refuses prepended canary in runner/run-guarded.js (watchdog chain)", () => {
  if (!APPROVED_ROOT) { console.log("skip: no RESEARCH_APPROVED_ROOT"); return; }
  const tmp = setupPrependedTree("runner/run-guarded.js");
  try {
    assertBootstrapRefused(runViaBootstrap(tmp, "tests"), "prepend/runner/run-guarded.js");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("RA652-002: bootstrap refuses prepended canary in runner/guarded-worker.js (runtime chain)", () => {
  if (!APPROVED_ROOT) { console.log("skip: no RESEARCH_APPROVED_ROOT"); return; }
  const tmp = setupPrependedTree("runner/guarded-worker.js");
  try {
    assertBootstrapRefused(runViaBootstrap(tmp, "tests"), "prepend/runner/guarded-worker.js");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("RA652-002: bootstrap refuses prepended canary in runner/run-manual.js", () => {
  if (!APPROVED_ROOT) { console.log("skip: no RESEARCH_APPROVED_ROOT"); return; }
  const tmp = setupPrependedTree("runner/run-manual.js");
  try {
    assertBootstrapRefused(runViaBootstrap(tmp, "tests"), "prepend/runner/run-manual.js");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("RA652-002: bootstrap refuses an unlisted helper file (nested executable)", () => {
  if (!APPROVED_ROOT) { console.log("skip: no RESEARCH_APPROVED_ROOT"); return; }
  const tmp = mkdtempSync(join(tmpdir(), "research-trust-unlisted-"));
  try {
    cpSync(ROOT, tmp, { recursive: true, filter: (p) => !p.includes("node_modules") });
    writeFileSync(join(tmp, "src", "evil-helper.js"), "export const evil = 1;\n");
    const r = runViaBootstrap(tmp, "tests");
    assert.equal(r.status, 3, "unlisted helper must refuse");
    assert.ok(r.stderr.includes("unlisted file"), `must name the unlisted file (stderr: ${r.stderr.slice(0, 200)})`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("RA652-002: bootstrap refuses an npm lifecycle hook in package.json", () => {
  if (!APPROVED_ROOT) { console.log("skip: no RESEARCH_APPROVED_ROOT"); return; }
  const tmp = mkdtempSync(join(tmpdir(), "research-trust-pretest-"));
  try {
    cpSync(ROOT, tmp, { recursive: true, filter: (p) => !p.includes("node_modules") });
    const pkg = JSON.parse(readFileSync(join(tmp, "package.json"), "utf8"));
    pkg.scripts.pretest = "node -e \"console.log(1)\"";
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg, null, 2));
    const r = runViaBootstrap(tmp, "tests");
    assert.equal(r.status, 3, "lifecycle hook must refuse");
    assert.ok(
      r.stderr.includes("lifecycle hook") || r.stderr.includes("hash mismatch"),
      `must refuse the hook (stderr: ${r.stderr.slice(0, 200)})`
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
