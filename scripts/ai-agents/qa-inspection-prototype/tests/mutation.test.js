/**
 * mutation.test.js — corpus/oracle tampering must stop the run BEFORE any
 * case executes or any success output is produced.
 *
 * Targets (per the common contract): the expected file (battery.json), the
 * oracle/scorer helper itself (tests/harness.js), fixture bytes
 * (fixtures/artifacts.json), the trust registry (fixtures/build-registry.json),
 * the manifest itself, unlisted/unconfined files — and the QAI-004 attacks:
 * a tampered scorer with only its own manifest entry rehashed, and a fully
 * self-rehashed manifest. Both must fail against the SEPARATELY TRUSTED
 * approval root (QA_APPROVED_ROOT host input), and the scorer-tamper case
 * must fail BEFORE the tampered scorer is imported (import-canary test).
 *
 * The executable-bootstrap tests below spawn the ACTUAL entry point
 * (tests/run-battery.js) inside the tampered copy — not a clean verifier
 * imported from another directory — with the trusted root inherited from
 * this (reviewed) process's environment.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let verifyManifest;
let runBattery;
let ManifestError;

function trustedRoot() {
  const v = process.env.QA_APPROVED_ROOT;
  assert.ok(typeof v === "string" && /^[0-9a-f]{64}$/.test(v), "QA_APPROVED_ROOT must be set by the reviewed invocation");
  return v;
}

before(async () => {
  // Pre-import trust bootstrap (QAI-004, round 2): bootstrap bytes checked
  // against the pinned manifest entry, then the corpus authenticated against
  // the separately trusted QA_APPROVED_ROOT before the harness is imported.
  const manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  const entry = (manifest.files ?? []).find((e) => e.path === "tests/trust-bootstrap.js");
  const actual = createHash("sha256").update(readFileSync(join(ROOT, "tests", "trust-bootstrap.js"))).digest("hex");
  assert.ok(entry && actual === entry.sha256, "tests/trust-bootstrap.js does not match the pinned manifest entry");
  const bootstrap = await import(pathToFileURL(join(ROOT, "tests", "trust-bootstrap.js")).href);
  bootstrap.verifyTrustRoot(ROOT);
  const harness = await import(pathToFileURL(join(ROOT, "tests", "harness.js")).href);
  verifyManifest = harness.verifyManifest;
  runBattery = harness.runBattery;
  ManifestError = harness.ManifestError;
});

function tempCopy() {
  const dir = mkdtempSync(join(tmpdir(), "qa-mut-"));
  cpSync(ROOT, dir, { recursive: true });
  return dir;
}

async function expectStopped(dir, label) {
  let manifestFailed = false;
  try {
    await verifyManifest(dir);
  } catch (e) {
    assert.ok(e instanceof ManifestError, `${label}: expected ManifestError, got ${e?.constructor?.name}: ${e?.message}`);
    manifestFailed = true;
  }
  assert.ok(manifestFailed, `${label}: manifest verification must fail`);

  let ran = false;
  try {
    await runBattery(dir);
    ran = true;
  } catch (e) {
    assert.ok(e instanceof ManifestError, `${label}: runBattery must stop with ManifestError, got ${e?.constructor?.name}`);
  }
  assert.ok(!ran, `${label}: battery must not execute`);
}

/**
 * Recompute every manifest hash and the corpus digest (the QAI-004
 * self-rehash attack). The digest covers every pinned file except
 * package.json (which carries the root in its scripts — circularity).
 */
function selfRehash(dir) {
  const mPath = join(dir, "corpus", "manifest.json");
  const m = JSON.parse(readFileSync(mPath, "utf8"));
  for (const e of m.files) {
    e.sha256 = createHash("sha256").update(readFileSync(join(dir, e.path))).digest("hex");
  }
  const canonical = JSON.stringify(
    m.files.filter((e) => e.path !== "package.json").map((e) => ({ path: e.path, sha256: e.sha256 }))
  );
  m.corpus_digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  writeFileSync(mPath, JSON.stringify(m, null, 2) + "\n");
  writeFileSync(join(dir, "corpus", "corpus_digest.txt"), m.corpus_digest + "\n");
  return m.corpus_digest;
}

/**
 * Execute the ACTUAL executable bootstrap (tests/run-battery.js) inside the
 * given directory as a subprocess, with the separately trusted root
 * inherited from this (reviewed) process — never from the directory under
 * test. Returns the spawnSync result.
 */
function runExecutableBootstrap(dir) {
  return spawnSync(process.execPath, [join(dir, "tests", "run-battery.js")], { encoding: "utf8", timeout: 120000 });
}

/** Append an import-time canary to the scorer; proves whether it was imported. */
function plantImportCanary(dir) {
  const canaryPath = join(dir, "IMPORT_CANARY");
  const p = join(dir, "tests", "harness.js");
  const src = readFileSync(p, "utf8");
  writeFileSync(
    p,
    src + `\nimport { writeFileSync as __qaCanaryWrite } from "node:fs";\n__qaCanaryWrite(${JSON.stringify(canaryPath)}, "imported");\n`
  );
  return canaryPath;
}

describe("mutation regressions", () => {
  it("tampered expected file (battery.json) stops the run", async () => {
    const dir = tempCopy();
    try {
      const p = join(dir, "corpus", "battery.json");
      const battery = JSON.parse(readFileSync(p, "utf8"));
      battery[0].expected.status = "REFUSED"; // tamper one expectation
      writeFileSync(p, JSON.stringify(battery));
      await expectStopped(dir, "battery.json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tampered oracle/scorer helper (tests/harness.js) stops the run", async () => {
    // The actual oracle path — not the scored implementation. Tampering the
    // scorer itself must be caught by its pinned manifest hash entry before
    // any case executes.
    const dir = tempCopy();
    try {
      const p = join(dir, "tests", "harness.js");
      const src = readFileSync(p, "utf8");
      writeFileSync(p, src.replace("contradictionRecall", "contradictionRecall_TAMPERED"));
      await expectStopped(dir, "tests/harness.js");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tampered implementation (src/classify.js) stops the run", async () => {
    const dir = tempCopy();
    try {
      const p = join(dir, "src", "classify.js");
      const src = readFileSync(p, "utf8");
      writeFileSync(p, src.replace("PROHIBITED_EXERCISE_KINDS", "PROHIBITED_EXERCISE_KINDS_TAMPERED"));
      await expectStopped(dir, "src/classify.js");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tampered fixture bytes (fixtures/artifacts.json) stops the run", async () => {
    const dir = tempCopy();
    try {
      const p = join(dir, "fixtures", "artifacts.json");
      const fx = JSON.parse(readFileSync(p, "utf8"));
      const k = Object.keys(fx)[0];
      fx[k].bytes_b64 = Buffer.from("tampered", "utf8").toString("base64");
      writeFileSync(p, JSON.stringify(fx));
      await expectStopped(dir, "fixtures/artifacts.json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tampered trust registry (fixtures/build-registry.json) stops the run", async () => {
    const dir = tempCopy();
    try {
      const p = join(dir, "fixtures", "build-registry.json");
      const reg = JSON.parse(readFileSync(p, "utf8"));
      reg["build-alpha"].commit = "f".repeat(40);
      writeFileSync(p, JSON.stringify(reg));
      await expectStopped(dir, "fixtures/build-registry.json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tampered manifest digest stops the run", async () => {
    const dir = tempCopy();
    try {
      const p = join(dir, "corpus", "manifest.json");
      const m = JSON.parse(readFileSync(p, "utf8"));
      m.corpus_digest = "0".repeat(64);
      writeFileSync(p, JSON.stringify(m));
      await expectStopped(dir, "corpus/manifest.json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("self-rehashed manifest (QAI-004 attack) still fails against the separately trusted root", async () => {
    // Attacker mutates the implementation, then recomputes every manifest
    // hash and the corpus digest so the manifest is internally consistent.
    // The run must still stop: the digest is not the separately trusted
    // approved root, which does not come from the tampered copy.
    const dir = tempCopy();
    try {
      const p = join(dir, "src", "classify.js");
      const src = readFileSync(p, "utf8");
      writeFileSync(p, src.replace("PROHIBITED_EXERCISE_KINDS", "PROHIBITED_EXERCISE_KINDS_TAMPERED"));
      const newDigest = selfRehash(dir);
      assert.notEqual(newDigest, trustedRoot(), "test setup: rehashed digest must differ from the trusted root");
      await expectStopped(dir, "self-rehashed manifest");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("unlisted file in a pinned directory stops the run", async () => {
    const dir = tempCopy();
    try {
      writeFileSync(join(dir, "src", "extra-unlisted.js"), "export const x = 1;\n");
      await expectStopped(dir, "unlisted file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("unconfined manifest path stops the run", async () => {
    const dir = tempCopy();
    try {
      const p = join(dir, "corpus", "manifest.json");
      const m = JSON.parse(readFileSync(p, "utf8"));
      m.files.push({ path: "../outside.js", sha256: "0".repeat(64) });
      writeFileSync(p, JSON.stringify(m));
      await expectStopped(dir, "unconfined path");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("untampered copy passes manifest verification (control)", async () => {
    const dir = tempCopy();
    try {
      const v = await verifyManifest(dir);
      assert.equal(v.ok, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("executable bootstrap (QAI-004, round 2)", () => {
  it("tampered scorer + rehashed own entry fails BEFORE import canary execution", () => {
    // The round-2 probe: mutate the scorer, recompute ONLY its own manifest
    // entry, leave every approved digest anchor unchanged. The executable
    // bootstrap must refuse before the tampered scorer is imported — the
    // import canary proves it.
    const dir = tempCopy();
    try {
      const canary = plantImportCanary(dir);
      const mPath = join(dir, "corpus", "manifest.json");
      const m = JSON.parse(readFileSync(mPath, "utf8"));
      const e = m.files.find((x) => x.path === "tests/harness.js");
      e.sha256 = createHash("sha256").update(readFileSync(join(dir, "tests", "harness.js"))).digest("hex");
      writeFileSync(mPath, JSON.stringify(m, null, 2) + "\n");
      const r = runExecutableBootstrap(dir);
      assert.notEqual(r.status, 0, `bootstrap must refuse; stdout: ${r.stdout.slice(0, 500)}`);
      assert.ok(!existsSync(canary), "tampered scorer must not have been imported (canary executed)");
      assert.ok(!r.stdout.includes("BATTERY"), "no battery output may be produced");
      assert.ok(r.status === 3, `expected bootstrap refusal exit 3, got ${r.status}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("self-rehashed scorer fails against the separately trusted old reviewed root", () => {
    // Attacker mutates the scorer and rehashes everything so the copy is
    // internally consistent. The separately trusted root (this process's
    // environment, not the copy) is unchanged: the bootstrap must refuse.
    const dir = tempCopy();
    try {
      const canary = plantImportCanary(dir);
      const newDigest = selfRehash(dir);
      assert.notEqual(newDigest, trustedRoot(), "test setup: rehashed digest must differ from the trusted root");
      const r = runExecutableBootstrap(dir);
      assert.notEqual(r.status, 0, `bootstrap must refuse; stdout: ${r.stdout.slice(0, 500)}`);
      assert.ok(!existsSync(canary), "tampered scorer must not have been imported (canary executed)");
      assert.ok(r.status === 3, `expected bootstrap refusal exit 3, got ${r.status}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("healthy executable bootstrap verifies and runs the battery (control)", () => {
    const dir = tempCopy();
    try {
      const r = runExecutableBootstrap(dir);
      assert.equal(r.status, 0, `healthy bootstrap must succeed; stderr: ${r.stderr.slice(0, 500)}`);
      assert.ok(r.stdout.includes("BATTERY: ALL GATES PASS"), "battery must pass end to end");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
