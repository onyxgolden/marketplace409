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
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
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

test("trust: bootstrap refuses a manifest listing a FIFO, root-first (S653-009)", () => {
  if (!APPROVED_ROOT) { console.log("skip: no SALES_APPROVED_ROOT"); return; }
  const tmp = mkdtempSync(join(tmpdir(), "sales-trust-"));
  try {
    cpSync(ROOT, tmp, { recursive: true, filter: (p) => !p.includes("node_modules") });
    // Tamper the manifest: prepend a FIFO entry. The digest check must
    // fail BEFORE the bootstrap tries to open it.
    const manifestPath = join(tmp, "corpus", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.files.unshift({ path: "fixtures/evil-fifo", sha256: "0".repeat(64) });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    const r = spawnSync(process.execPath, [join(tmp, "bootstrap.mjs"), "test"], {
      env: { ...process.env, SALES_APPROVED_ROOT: APPROVED_ROOT },
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(r.status, 3, "tampered manifest must exit 3");
    assert.ok(r.stderr.includes("corpus digest mismatch"), `root-first refusal expected (stderr: ${r.stderr.slice(0, 200)})`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("trust: manual prepend canary never executes via the pinned bootstrap (S653-009)", () => {
  // S653-009 (fix round 2): `node bootstrap.mjs manual` authenticates
  // before importing the manual launcher. A canary prepended to
  // runner/run-manual.js must not execute.
  if (!APPROVED_ROOT) { console.log("skip: no SALES_APPROVED_ROOT"); return; }
  const tmp = mkdtempSync(join(tmpdir(), "sales-trust-"));
  try {
    cpSync(ROOT, tmp, { recursive: true, filter: (p) => !p.includes("node_modules") });
    const target = join(tmp, "runner", "run-manual.js");
    const original = readFileSync(target, "utf8");
    writeFileSync(target, 'console.error("MANUAL_PRE_AUTH_CANARY");\n' + original);
    const r = spawnSync(process.execPath, [join(tmp, "bootstrap.mjs"), "manual", "main", join(tmp, "out")], {
      env: { ...process.env, SALES_APPROVED_ROOT: APPROVED_ROOT },
      encoding: "utf8",
      timeout: 60000,
    });
    assert.equal(r.status, 3, "mutated manual launcher must exit 3");
    assert.ok(!r.stdout.includes("MANUAL_PRE_AUTH_CANARY"), "manual canary must not execute");
    assert.ok(!r.stderr.includes("MANUAL_PRE_AUTH_CANARY"), "manual canary must not execute (stderr)");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("trust: valid manual run works through the pinned bootstrap (S653-009)", () => {
  if (!APPROVED_ROOT) { console.log("skip: no SALES_APPROVED_ROOT"); return; }
  const outdir = mkdtempSync(join(tmpdir(), "sales-manual-"));
  try {
    // The 'temporal' bundle (1 lead) fits the 256-record output cap; the
    // 16-lead 'main' bundle with drafts exceeds it by design.
    const r = spawnSync(process.execPath, [join(ROOT, "bootstrap.mjs"), "manual", "temporal", outdir], {
      env: { ...process.env, SALES_APPROVED_ROOT: APPROVED_ROOT },
      encoding: "utf8",
      timeout: 60000,
    });
    assert.equal(r.status, 0, `manual via bootstrap must succeed (stderr: ${r.stderr.slice(0, 300)})`);
    const report = JSON.parse(readFileSync(join(outdir, "temporal-report.json"), "utf8"));
    assert.ok(report.report.classifications.length > 0, "manual report must carry classifications");
  } finally {
    rmSync(outdir, { recursive: true, force: true });
  }
});

test("trust: manifest FIFO refuses promptly without blocking (S653-009)", () => {
  // The reviewer's kill-after-2s probe: a FIFO at corpus/manifest.json
  // must be refused by the pinned bootstrap, not block it.
  if (!APPROVED_ROOT) { console.log("skip: no SALES_APPROVED_ROOT"); return; }
  const tmp = mkdtempSync(join(tmpdir(), "sales-fifo-"));
  try {
    cpSync(ROOT, tmp, { recursive: true, filter: (p) => !p.includes("node_modules") });
    const manifest = join(tmp, "corpus", "manifest.json");
    rmSync(manifest);
    // Use mkfifo via shell (node has no direct mkfifo binding).
    const mk = spawnSync("mkfifo", [manifest], { timeout: 5000 });
    if (mk.status !== 0) { console.log("skip: mkfifo unavailable"); return; }
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [join(tmp, "bootstrap.mjs"), "manual", "temporal", join(tmp, "out")], {
      env: { ...process.env, SALES_APPROVED_ROOT: APPROVED_ROOT },
      encoding: "utf8",
      timeout: 15000,
    });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 10000, `FIFO manifest must refuse promptly (took ${elapsed}ms)`);
    assert.notEqual(r.status, 0, "FIFO manifest must not succeed");
    assert.ok(r.stderr.includes("refusing") || r.status === 3, `stderr: ${r.stderr.slice(0, 200)}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("trust: manifest symlink refuses without following (S653-009)", () => {
  if (!APPROVED_ROOT) { console.log("skip: no SALES_APPROVED_ROOT"); return; }
  const tmp = mkdtempSync(join(tmpdir(), "sales-symlink-"));
  try {
    cpSync(ROOT, tmp, { recursive: true, filter: (p) => !p.includes("node_modules") });
    const manifest = join(tmp, "corpus", "manifest.json");
    const real = readFileSync(manifest, "utf8");
    rmSync(manifest);
    // Symlink to a valid manifest elsewhere — must still refuse (no-follow).
    const other = join(tmp, "real-manifest.json");
    writeFileSync(other, real);
    symlinkSync(other, manifest);
    const r = spawnSync(process.execPath, [join(tmp, "bootstrap.mjs"), "manual", "temporal", join(tmp, "out")], {
      env: { ...process.env, SALES_APPROVED_ROOT: APPROVED_ROOT },
      encoding: "utf8",
      timeout: 15000,
    });
    assert.notEqual(r.status, 0, "symlinked manifest must not succeed");
    assert.ok(r.status === 3, `expected exit 3, got ${r.status} (stderr: ${r.stderr.slice(0, 200)})`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("trust: oversize manifest refuses before allocation (S653-009)", () => {
  if (!APPROVED_ROOT) { console.log("skip: no SALES_APPROVED_ROOT"); return; }
  const tmp = mkdtempSync(join(tmpdir(), "sales-bigmanifest-"));
  try {
    cpSync(ROOT, tmp, { recursive: true, filter: (p) => !p.includes("node_modules") });
    const manifest = join(tmp, "corpus", "manifest.json");
    // 3 MiB of padding — over the 1 MiB manifest cap.
    writeFileSync(manifest, JSON.stringify({ files: [], digest: "x", padding: "y".repeat(3 * 1024 * 1024) }));
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [join(tmp, "bootstrap.mjs"), "manual", "temporal", join(tmp, "out")], {
      env: { ...process.env, SALES_APPROVED_ROOT: APPROVED_ROOT },
      encoding: "utf8",
      timeout: 15000,
    });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 10000, `oversize manifest must refuse promptly (took ${elapsed}ms)`);
    assert.notEqual(r.status, 0, "oversize manifest must not succeed");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
