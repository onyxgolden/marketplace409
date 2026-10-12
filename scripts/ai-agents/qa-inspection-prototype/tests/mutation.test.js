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
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join, dirname, normalize } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * authenticateTrustRoot — pre-import trust authentication (QAI-004, round 3).
 *
 * Uses ONLY node builtins — never any in-corpus module. Authenticates the
 * complete reviewed corpus root against the separately trusted host input
 * QA_APPROVED_ROOT BEFORE any in-corpus helper (bootstrap, harness, scorer)
 * is imported or executed.
 *
 * Checking a helper's bytes against its manifest-local entry is NOT
 * authentication: the helper would already have executed by the time any
 * root check runs. Throws (fail closed) on any mismatch.
 */
function authenticateTrustRoot() {
  const approved = process.env.QA_APPROVED_ROOT;
  assert.ok(
    typeof approved === "string" && /^[0-9a-f]{64}$/.test(approved),
    "trust: missing separately trusted approval root (QA_APPROVED_ROOT) — refusing to run"
  );
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  } catch {
    assert.fail("trust: corpus/manifest.json unreadable");
  }
  const files = manifest.files;
  assert.ok(Array.isArray(files), "trust: manifest shape invalid");
  const seen = new Set();
  for (const e of files) {
    const p = e?.path;
    assert.ok(
      typeof p === "string" && p.length > 0 && !p.startsWith("/") && !p.includes("\\") &&
        normalize(p) === p && !p.startsWith("..") && !p.includes("../") && !seen.has(p),
      `trust: bad manifest entry: ${String(p)}`
    );
    seen.add(p);
    let bytes;
    try {
      bytes = readFileSync(join(ROOT, p));
    } catch {
      assert.fail(`trust: missing pinned file: ${p}`);
    }
    assert.equal(sha(bytes), e.sha256, `trust: hash mismatch: ${p}`);
  }
  const want = ["package.json", "README.md"];
  for (const dir of ["corpus", "src", "runner", "fixtures", "tests"]) {
    for (const f of readdirSync(join(ROOT, dir)).filter((x) => !x.startsWith("."))) {
      if (dir === "fixtures" ? f.endsWith(".json") : f.endsWith(".js")) want.push(`${dir}/${f}`);
    }
  }
  for (const p of want.sort()) assert.ok(seen.has(p), `trust: unlisted file: ${p}`);
  const canonical = JSON.stringify(
    files.filter((e) => e.path !== "package.json").map((e) => ({ path: e.path, sha256: e.sha256 }))
  );
  const digest = sha(Buffer.from(canonical, "utf8"));
  assert.equal(digest, manifest.corpus_digest, "trust: manifest corpus_digest does not match recomputed digest");
  const recorded = readFileSync(join(ROOT, "corpus", "corpus_digest.txt"), "utf8").trim();
  assert.equal(recorded, manifest.corpus_digest, "trust: corpus_digest.txt does not match manifest digest");
  assert.equal(digest, approved, "trust: corpus digest is not the separately trusted approved root");
  return digest;
}

let verifyManifest;
let runBattery;
let ManifestError;

function trustedRoot() {
  const v = process.env.QA_APPROVED_ROOT;
  assert.ok(typeof v === "string" && /^[0-9a-f]{64}$/.test(v), "QA_APPROVED_ROOT must be set by the reviewed invocation");
  return v;
}

before(async () => {
  // Pre-import trust authentication (QAI-004, round 3): the complete
  // reviewed corpus root is authenticated with node builtins only — before
  // the harness module or any scored code is imported or executed.
  authenticateTrustRoot();
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

describe("unit-test entrypoint bootstrap (QAI-004, round 3)", () => {
  /**
   * Run the ACTUAL unit-test executable path (node --test <file>) inside
   * the given directory, with the separately trusted root inherited from
   * this (reviewed) process — never from the directory under test.
   *
   * NODE_* environment variables are scrubbed: node --test refuses to run
   * test files recursively inside a test process, and a real shell
   * invocation would not carry the runner's variables. Scrubbing reproduces
   * the genuine executable path.
   */
  function runUnitEntrypoint(dir, testFile) {
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("NODE_")) delete env[k];
    return spawnSync(process.execPath, ["--test", join(dir, "tests", testFile)], {
      encoding: "utf8",
      timeout: 180000,
      env,
    });
  }

  /**
   * The round-3 probe: append a file-writing import canary to the bootstrap
   * helper and recompute ONLY its own manifest entry, leaving the trusted
   * host root, manifest.corpus_digest and recorded root unchanged.
   */
  function plantHelperCanary(dir) {
    const canaryPath = join(dir, "UNIT_CANARY");
    const p = join(dir, "tests", "trust-bootstrap.js");
    const src = readFileSync(p, "utf8");
    writeFileSync(
      p,
      src + `\nimport { writeFileSync as __qaUnitCanary } from "node:fs";\n__qaUnitCanary(${JSON.stringify(canaryPath)}, "executed");\n`
    );
    const mPath = join(dir, "corpus", "manifest.json");
    const m = JSON.parse(readFileSync(mPath, "utf8"));
    const e = m.files.find((x) => x.path === "tests/trust-bootstrap.js");
    e.sha256 = createHash("sha256").update(readFileSync(p)).digest("hex");
    writeFileSync(mPath, JSON.stringify(m, null, 2) + "\n");
    return canaryPath;
  }

  for (const testFile of ["battery.test.js", "mutation.test.js", "watchdog.test.js"]) {
    it(`helper canary + rehashed own entry through ${testFile} exits before canary execution`, () => {
      const dir = tempCopy();
      try {
        const canary = plantHelperCanary(dir);
        const r = runUnitEntrypoint(dir, testFile);
        assert.notEqual(r.status, 0, `${testFile} must refuse; stderr: ${(r.stderr || "").slice(0, 500)}`);
        assert.ok(!existsSync(canary), "tampered helper must not have executed (canary file exists)");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it("fully self-rehashed copy fails the unit-test entrypoint under the old host root", () => {
    const dir = tempCopy();
    try {
      const p = join(dir, "tests", "trust-bootstrap.js");
      writeFileSync(p, readFileSync(p, "utf8") + "\n// tamper\n");
      const newDigest = selfRehash(dir);
      assert.notEqual(newDigest, trustedRoot(), "test setup: rehashed digest must differ from the trusted root");
      const r = runUnitEntrypoint(dir, "battery.test.js");
      assert.notEqual(r.status, 0, `unit-test entrypoint must refuse; stderr: ${(r.stderr || "").slice(0, 500)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
