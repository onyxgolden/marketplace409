/**
 * mutation.test.js — corpus/oracle tampering must stop the run BEFORE any
 * case executes or any success output is produced.
 *
 * Targets (per the common contract): the expected file (battery.json), an
 * oracle helper (src/classify.js), fixture bytes (fixtures/artifacts.json),
 * the trust registry (fixtures/build-registry.json), and the manifest itself.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { verifyManifest, runBattery, ManifestError } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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
    assert.ok(e instanceof ManifestError, `${label}: expected ManifestError`);
    manifestFailed = true;
  }
  assert.ok(manifestFailed, `${label}: manifest verification must fail`);

  let ran = false;
  try {
    await runBattery(dir);
    ran = true;
  } catch (e) {
    assert.ok(e instanceof ManifestError, `${label}: runBattery must stop with ManifestError`);
  }
  assert.ok(!ran, `${label}: battery must not execute`);
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

  it("tampered oracle helper (src/classify.js) stops the run", async () => {
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
