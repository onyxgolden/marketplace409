/**
 * mutation.test.js — corpus/oracle tampering must stop the run BEFORE any
 * case executes or any success output is produced.
 *
 * Targets (per the common contract): the expected file (battery.json), the
 * oracle/scorer helper itself (tests/harness.js), fixture bytes
 * (fixtures/artifacts.json), the trust registry (fixtures/build-registry.json),
 * the manifest itself, and — the QAI-004 attack — a fully self-rehashed
 * manifest (mutated implementation + recomputed hashes + recomputed digest),
 * which must fail against the reviewer-supplied APPROVED_CORPUS_DIGEST pin.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let verifyManifest;
let runBattery;
let ManifestError;
let APPROVED;

before(async () => {
  // Pre-import check: the verifier's bytes must match the pinned manifest
  // entry before the harness module is imported or executed.
  const manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  const entry = (manifest.files ?? []).find((e) => e.path === "tests/harness.js");
  const actual = createHash("sha256").update(readFileSync(join(ROOT, "tests", "harness.js"))).digest("hex");
  assert.ok(entry && actual === entry.sha256, "tests/harness.js does not match the pinned manifest entry");
  const harness = await import(pathToFileURL(join(ROOT, "tests", "harness.js")).href);
  verifyManifest = harness.verifyManifest;
  runBattery = harness.runBattery;
  ManifestError = harness.ManifestError;
  APPROVED = harness.APPROVED_CORPUS_DIGEST;
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

/** Recompute every manifest hash and the corpus digest (the QAI-004 attack). */
function selfRehash(dir) {
  const mPath = join(dir, "corpus", "manifest.json");
  const m = JSON.parse(readFileSync(mPath, "utf8"));
  for (const e of m.files) {
    e.sha256 = createHash("sha256").update(readFileSync(join(dir, e.path))).digest("hex");
  }
  const canonical = JSON.stringify(
    m.files.filter((e) => e.path !== "tests/harness.js").map((e) => ({ path: e.path, sha256: e.sha256 }))
  );
  m.corpus_digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  writeFileSync(mPath, JSON.stringify(m, null, 2) + "\n");
  writeFileSync(join(dir, "corpus", "corpus_digest.txt"), m.corpus_digest + "\n");
  return m.corpus_digest;
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

  it("self-rehashed manifest (QAI-004 attack) still fails against the approval pin", async () => {
    // Attacker mutates the implementation, then recomputes every manifest
    // hash and the corpus digest so the manifest is internally consistent.
    // The run must still stop: the digest is not the approved reviewed digest.
    const dir = tempCopy();
    try {
      const p = join(dir, "src", "classify.js");
      const src = readFileSync(p, "utf8");
      writeFileSync(p, src.replace("PROHIBITED_EXERCISE_KINDS", "PROHIBITED_EXERCISE_KINDS_TAMPERED"));
      const newDigest = selfRehash(dir);
      assert.notEqual(newDigest, APPROVED, "test setup: rehashed digest must differ from the approved pin");
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
