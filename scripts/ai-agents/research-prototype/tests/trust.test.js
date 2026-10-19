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
import { createHash } from "node:crypto";

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

test("RA652-002: official host command refuses a package.json with an npm lifecycle hook", () => {
  // Fix round 2: the official acceptance entrypoint is the host-owned
  // direct bootstrap invocation (npm scripts removed from package.json
  // entirely — see below). A tampered package.json carrying a lifecycle
  // hook must refuse (exit 3) before any candidate byte runs, and the
  // hook's canary must never execute.
  if (!APPROVED_ROOT) { console.log("skip: no RESEARCH_APPROVED_ROOT"); return; }
  const tmp = mkdtempSync(join(tmpdir(), "research-trust-pretest-"));
  try {
    cpSync(ROOT, tmp, { recursive: true, filter: (p) => !p.includes("node_modules") });
    const pkg = JSON.parse(readFileSync(join(tmp, "package.json"), "utf8"));
    pkg.scripts = { pretest: "node -e \"console.error('NPM_LIFECYCLE_CANARY_EXECUTED')\"" };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg, null, 2));
    const r = runViaBootstrap(tmp, "tests");
    assert.equal(r.status, 3, "lifecycle hook must refuse");
    assert.ok(!r.stdout.includes("NPM_LIFECYCLE_CANARY_EXECUTED"), "hook canary must not execute");
    assert.ok(!r.stderr.includes("NPM_LIFECYCLE_CANARY_EXECUTED"), "hook canary must not execute (stderr)");
    assert.ok(
      r.stderr.includes("npm scripts present") || r.stderr.includes("hash mismatch") || r.stderr.includes("lifecycle hook"),
      `must refuse the tampered metadata (stderr: ${r.stderr.slice(0, 200)})`
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("RA652-002: npm itself cannot dispatch a lifecycle hook — no scripts ship", () => {
  // Empirical proof of the fix-round-2 design: package.json ships with
  // NO scripts object at all, so `npm test` errors ("Missing script")
  // without executing a planted pretest hook. This is the path the
  // prior review flagged: npm parsing candidate-controlled package.json
  // and dispatching lifecycle metadata before the bootstrap could run.
  const tmp = mkdtempSync(join(tmpdir(), "research-trust-npm-"));
  try {
    cpSync(ROOT, tmp, { recursive: true, filter: (p) => !p.includes("node_modules") });
    const pkg = JSON.parse(readFileSync(join(tmp, "package.json"), "utf8"));
    assert.ok(!pkg.scripts, "shipped package.json must have no scripts");
    pkg.scripts = { pretest: "node -e \"console.error('NPM_LIFECYCLE_CANARY_EXECUTED')\"" };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg, null, 2));
    const r = spawnSync("npm", ["test"], {
      cwd: tmp, encoding: "utf8", timeout: 60000,
      env: { ...process.env, RESEARCH_APPROVED_ROOT: "x".repeat(64) },
    });
    const combined = (r.stdout || "") + (r.stderr || "");
    assert.ok(!combined.includes("NPM_LIFECYCLE_CANARY_EXECUTED"), "npm must not execute the pretest hook");
    assert.notEqual(r.status, 0, "npm test must fail without a test script");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("fix round 3: bootstrap receipt pins match the live trusted bootstrap", () => {
  // The re-review-2 verdict found the receipt's embedded bootstrap source
  // did not hash to the pinned SHA-256 (stale embedded copy). This test
  // recomputes from the live bytes and fails the suite on any drift, so
  // a mismatched receipt can never ship again.
  const receiptPath = join(homedir(), "workspace", "forge-ai-drop", "results", "muse",
    "research-agent-phase2-slice1-bootstrap-receipt-2026-10-19.md");
  let receipt;
  try {
    receipt = readFileSync(receiptPath, "utf8");
  } catch {
    console.log("skip: bootstrap receipt not present on this host");
    return;
  }
  const live = readFileSync(BOOTSTRAP);
  const liveHash = createHash("sha256").update(live).digest("hex");
  // The pin table must name the live hash.
  assert.ok(receipt.includes(liveHash), `receipt pin table must contain the live bootstrap hash ${liveHash}`);
  // The embedded ```js fenced source must be byte-identical to the live file.
  const m = receipt.match(/```js\n([\s\S]*?)```\n\n## Execution/);
  assert.ok(m, "receipt must embed the full bootstrap source in a ```js fence");
  assert.equal(m[1], live.toString("utf8"), "embedded bootstrap source must be byte-identical to the live file");
  assert.equal(
    createHash("sha256").update(m[1], "utf8").digest("hex"),
    liveHash,
    "embedded source must hash to the pinned SHA-256"
  );
});

test("fix round 3: tampered manifest root refuses before any pinned file is opened", () => {
  // The fix-round-2 bootstrap read every manifest-selected member file
  // BEFORE authenticating the manifest root digest. The root must be
  // verified first: a tampered pin refuses with exit 3 and the specific
  // "refusing before opening any pinned file" diagnostic.
  if (!APPROVED_ROOT) { console.log("skip: no RESEARCH_APPROVED_ROOT"); return; }
  const tmp = mkdtempSync(join(tmpdir(), "research-trust-rootfirst-"));
  try {
    cpSync(ROOT, tmp, { recursive: true, filter: (p) => !p.includes("node_modules") });
    const manPath = join(tmp, "corpus", "manifest.json");
    const man = JSON.parse(readFileSync(manPath, "utf8"));
    man.files[0].sha256 = "0".repeat(64); // invalidate the root digest
    writeFileSync(manPath, JSON.stringify(man));
    const r = runViaBootstrap(tmp, "tests");
    assert.equal(r.status, 3, "tampered manifest root must refuse");
    assert.ok(
      r.stderr.includes("refusing before opening any pinned file"),
      `must refuse before opening member files (stderr: ${r.stderr.slice(0, 200)})`
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("fix round 3: FIFO at corpus/manifest.json refuses instead of hanging", () => {
  // A FIFO/symlink/device at the manifest path must fail closed
  // ("not a regular file") rather than blocking on open.
  if (!APPROVED_ROOT) { console.log("skip: no RESEARCH_APPROVED_ROOT"); return; }
  if (process.platform === "win32") { console.log("skip: no FIFOs on Windows"); return; }
  const tmp = mkdtempSync(join(tmpdir(), "research-trust-fifo-"));
  try {
    cpSync(ROOT, tmp, { recursive: true, filter: (p) => !p.includes("node_modules") });
    const manPath = join(tmp, "corpus", "manifest.json");
    rmSync(manPath);
    const mk = spawnSync("mkfifo", [manPath], { encoding: "utf8", timeout: 10000 });
    assert.equal(mk.status, 0, "mkfifo must succeed");
    const r = runViaBootstrap(tmp, "tests");
    assert.equal(r.status, 3, "FIFO manifest must refuse");
    assert.ok(
      r.stderr.includes("not a regular file"),
      `must refuse non-regular manifest (stderr: ${r.stderr.slice(0, 200)})`
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
