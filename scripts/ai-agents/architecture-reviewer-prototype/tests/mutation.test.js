/**
 * mutation.test.js — tampering with the oracle, expectations, fixture
 * bytes, trust registry or manifest must stop the run before oracle/agent
 * execution or success output.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { runBattery, verifyManifest, acceptanceMetrics, ManifestError } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function scratchCopy() {
  const dir = mkdtempSync(join(tmpdir(), "ar-mut-"));
  cpSync(ROOT, dir, { recursive: true });
  return dir;
}

test("tampered expectation is detected (no silent pass)", async () => {
  const dir = scratchCopy();
  try {
    const p = join(dir, "corpus", "battery.json");
    const battery = JSON.parse(readFileSync(p, "utf8"));
    battery[0].expected.verdict = battery[0].expected.verdict === "GO" ? "NO-GO" : "GO";
    writeFileSync(p, JSON.stringify(battery, null, 2));
    // Manifest pin now mismatches the tampered battery file.
    await assert.rejects(() => verifyManifest(dir), ManifestError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tampered expectation with re-pinned manifest still fails acceptance", async () => {
  const dir = scratchCopy();
  try {
    const p = join(dir, "corpus", "battery.json");
    const battery = JSON.parse(readFileSync(p, "utf8"));
    battery[0].expected.verdict = battery[0].expected.verdict === "GO" ? "NO-GO" : "GO";
    writeFileSync(p, JSON.stringify(battery, null, 2));
    // Re-pin the manifest to the tampered file (simulates a confused
    // authoring step): the digest chain no longer matches the reviewed root.
    const { createHash } = await import("node:crypto");
    const sha = (b) => createHash("sha256").update(b).digest("hex");
    const manifest = JSON.parse(readFileSync(join(dir, "corpus", "manifest.json"), "utf8"));
    const entry = manifest.files.find((e) => e.path === "corpus/battery.json");
    entry.sha256 = sha(readFileSync(p));
    const canonical = JSON.stringify(manifest.files.filter((e) => e.path !== "package.json"));
    manifest.corpus_digest = sha(Buffer.from(canonical, "utf8"));
    writeFileSync(join(dir, "corpus", "manifest.json"), JSON.stringify(manifest, null, 2));
    writeFileSync(join(dir, "corpus", "corpus_digest.txt"), manifest.corpus_digest + "\n");
    // Internal consistency holds, but the digest differs from the reviewed
    // root — acceptance metrics still catch the oracle lie.
    const v = await verifyManifest(dir);
    assert.ok(v.ok);
    const { outputs } = await runBattery(dir, { timeoutMs: 5000 });
    const m = acceptanceMetrics(outputs);
    assert.ok(m.mismatches.length > 0, "tampered expectation must not pass acceptance");
    assert.ok(m.mismatches.includes(battery[0].case_id));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tampered source file stops the run before any case executes", async () => {
  const dir = scratchCopy();
  try {
    const p = join(dir, "src", "reviewer.js");
    writeFileSync(p, readFileSync(p, "utf8") + "\n// tampered\n");
    await assert.rejects(() => verifyManifest(dir), ManifestError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tampered manifest digest is rejected", async () => {
  const dir = scratchCopy();
  try {
    const p = join(dir, "corpus", "manifest.json");
    const manifest = JSON.parse(readFileSync(p, "utf8"));
    manifest.corpus_digest = "0".repeat(64);
    writeFileSync(p, JSON.stringify(manifest, null, 2));
    await assert.rejects(() => verifyManifest(dir), ManifestError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unlisted new file is rejected", async () => {
  const dir = scratchCopy();
  try {
    writeFileSync(join(dir, "src", "evil.js"), "export const x = 1;\n");
    await assert.rejects(() => verifyManifest(dir), ManifestError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------- AR-005: pre-import launcher attacks ----------------
// The launcher (tests/run-tests.js) authenticates the independently
// supplied approved root against the full pinned corpus with node builtins
// ONLY, before any scored test/helper is imported. Attack tests keep the
// ORIGINAL host-fixed root fixed — they never switch to the candidate's
// newly edited npm root.

/** The separately trusted approved root, fixed by the npm test script. */
function fixedApprovedRoot() {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const m = /AR_APPROVED_ROOT=([0-9a-f]{64})/.exec(pkg.scripts?.test ?? "");
  assert.ok(m, "npm test must pin a separately trusted AR_APPROVED_ROOT");
  return m[1];
}

/** Spawn the launcher against a scratch tree with the ORIGINAL root fixed. */
function runLauncher(dir, root) {
  try {
    const out = execFileSync(process.execPath, [join(dir, "tests", "run-tests.js")], {
      env: { ...process.env, AR_APPROVED_ROOT: root },
      encoding: "utf8",
      timeout: 120000,
    });
    return { status: 0, output: String(out) };
  } catch (e) {
    return { status: e.status ?? -1, output: String(e.stdout ?? "") + String(e.stderr ?? "") };
  }
}

/** Re-pin the scratch tree's manifest exactly like the authoring step does. */
function repinManifest(dir) {
  execFileSync(process.execPath, [join(dir, "corpus", "freeze-corpus.js")], {
    cwd: dir,
    encoding: "utf8",
    timeout: 60000,
  });
}

test("AR-005: canary in a scored helper never executes — launcher refuses first", () => {
  const root = fixedApprovedRoot();
  const dir = scratchCopy();
  try {
    // Independent probe: a canary at the top of tests/harness.js. Under
    // the old entrypoint it executed before the hash-mismatch failure.
    const p = join(dir, "tests", "harness.js");
    writeFileSync(p, 'console.error("AR_CANARY_EXECUTED");\n' + readFileSync(p, "utf8"));
    const r = runLauncher(dir, root);
    assert.equal(r.status, 3, `launcher must refuse before imports (got ${r.status})`);
    assert.ok(!r.output.includes("AR_CANARY_EXECUTED"), "canary must not execute");
    assert.ok(r.output.includes("trust failure"), "refusal must name the trust failure");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AR-005: tampered source with rehashed manifest fails before scorer execution", () => {
  const root = fixedApprovedRoot();
  const dir = scratchCopy();
  try {
    writeFileSync(join(dir, "src", "reviewer.js"), readFileSync(join(dir, "src", "reviewer.js"), "utf8") + "\n// tampered\n");
    repinManifest(dir); // candidate manifest is internally consistent again
    const r = runLauncher(dir, root); // but the ORIGINAL root is still fixed
    assert.equal(r.status, 3, `launcher must refuse before imports (got ${r.status})`);
    assert.ok(r.output.includes("trust failure"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AR-005: tampered expectations with rehashed manifest fail before oracle execution", () => {
  const root = fixedApprovedRoot();
  const dir = scratchCopy();
  try {
    const p = join(dir, "corpus", "battery.json");
    const battery = JSON.parse(readFileSync(p, "utf8"));
    battery[0].expected.verdict = battery[0].expected.verdict === "GO" ? "NO-GO" : "GO";
    writeFileSync(p, JSON.stringify(battery, null, 2));
    repinManifest(dir);
    const r = runLauncher(dir, root);
    assert.equal(r.status, 3, `launcher must refuse before imports (got ${r.status})`);
    assert.ok(r.output.includes("trust failure"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
