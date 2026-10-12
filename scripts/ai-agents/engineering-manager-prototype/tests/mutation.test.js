/**
 * mutation.test.js — corpus/oracle tampering must stop the run BEFORE any
 * case executes or any success output is produced.
 *
 * Targets: the expected file (battery.json), a scored helper
 * (src/planner.js), fixture bytes (corpus/battery.json fixture briefs),
 * the trust registry (manifest entry), and the manifest itself.
 *
 * Trust: pre-import authentication (builtins only) in before().
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function authenticateTrustRoot() {
  const approved = process.env.EM_APPROVED_ROOT;
  assert.ok(typeof approved === "string" && /^[0-9a-f]{64}$/.test(approved), "trust: missing EM_APPROVED_ROOT");
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  const manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  for (const e of manifest.files) assert.equal(sha(readFileSync(join(ROOT, e.path))), e.sha256);
  assert.equal(sha(Buffer.from(JSON.stringify(manifest.files.filter((e) => e.path !== "package.json").map((e) => ({ path: e.path, sha256: e.sha256 }))), "utf8")), manifest.corpus_digest);
  assert.equal(manifest.corpus_digest, approved);
}

let harness;

before(async () => {
  authenticateTrustRoot();
  harness = await import(pathToFileURL(join(ROOT, "tests", "harness.js")).href);
});

function tempCopy() {
  const dir = mkdtempSync(join(tmpdir(), "em-mut-"));
  cpSync(ROOT, dir, { recursive: true });
  return dir;
}

async function expectStopped(dir, label) {
  let manifestFailed = false;
  try {
    await harness.verifyManifest(dir);
  } catch (e) {
    assert.ok(e instanceof harness.ManifestError, `${label}: expected ManifestError, got ${e}`);
    manifestFailed = true;
  }
  assert.ok(manifestFailed, `${label}: manifest verification must fail`);
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

  it("tampered scored helper (src/planner.js) stops the run", async () => {
    const dir = tempCopy();
    try {
      const p = join(dir, "src", "planner.js");
      const src = readFileSync(p, "utf8");
      writeFileSync(p, src.replace("CYCLE_DETECTED", "CYCLE_DETECTED_TAMPERED"));
      await expectStopped(dir, "src/planner.js");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tampered fixture bytes (brief title) stops the run", async () => {
    const dir = tempCopy();
    try {
      const p = join(dir, "corpus", "battery.json");
      const battery = JSON.parse(readFileSync(p, "utf8"));
      battery[0].fixture.brief.task_specs[0].title = "tampered title";
      writeFileSync(p, JSON.stringify(battery));
      await expectStopped(dir, "fixture brief bytes");
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

  it("tampered trust entry (approval record_id) stops the run", async () => {
    const dir = tempCopy();
    try {
      const p = join(dir, "corpus", "battery.json");
      const battery = JSON.parse(readFileSync(p, "utf8"));
      const c = battery.find((x) => (x.fixture.approvals ?? []).length > 0);
      assert.ok(c, "need an approval-bearing case");
      c.fixture.approvals[0].record_id = "tampered";
      writeFileSync(p, JSON.stringify(battery));
      await expectStopped(dir, "approval record");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("untampered copy passes manifest verification (control)", async () => {
    const dir = tempCopy();
    try {
      const v = await harness.verifyManifest(dir);
      assert.equal(v.ok, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
