/**
 * mutation.test.js — corpus/oracle tampering must stop the run BEFORE any
 * case executes or any success output is produced.
 *
 * Targets: the expected file (battery.json), a scored helper
 * (src/metrics.js), fixture bytes (a battery case fixture), the trust
 * registry (manifest entry) and the manifest digest itself.
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
  const approved = process.env.MK_APPROVED_ROOT;
  assert.ok(typeof approved === "string" && /^[0-9a-f]{64}$/.test(approved), "trust: missing MK_APPROVED_ROOT");
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  const manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  for (const e of manifest.files) assert.equal(sha(readFileSync(join(ROOT, e.path))), e.sha256);
  assert.equal(sha(Buffer.from(JSON.stringify(manifest.files.map((e) => ({ path: e.path, sha256: e.sha256 }))), "utf8")), manifest.corpus_digest);
  assert.equal(manifest.corpus_digest, approved);
}

let harness;

before(async () => {
  authenticateTrustRoot();
  harness = await import(pathToFileURL(join(ROOT, "tests", "harness.js")).href);
});

function tempCopy() {
  const dir = mkdtempSync(join(tmpdir(), "mk-mut-"));
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

  it("tampered scored helper (src/metrics.js) stops the run", async () => {
    const dir = tempCopy();
    try {
      const p = join(dir, "src", "metrics.js");
      const src = readFileSync(p, "utf8");
      writeFileSync(p, src.replace("DUPLICATE_EVENT_CONFLICT", "DUPLICATE_EVENT_CONFLICT_TAMPERED"));
      await expectStopped(dir, "src/metrics.js");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tampered shared oracle (corpus/oracle.js) stops the run", async () => {
    const dir = tempCopy();
    try {
      const p = join(dir, "corpus", "oracle.js");
      const src = readFileSync(p, "utf8");
      writeFileSync(p, src.replace("COUNTED_ONCE", "COUNTED_ONCE_TAMPERED"));
      await expectStopped(dir, "corpus/oracle.js");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tampered fixture bytes (campaign name) stops the run", async () => {
    const dir = tempCopy();
    try {
      const p = join(dir, "corpus", "battery.json");
      const battery = JSON.parse(readFileSync(p, "utf8"));
      const c = battery.find((x) => x.case_id === "nom-01");
      const entry = c.fixture.fixtures["campaigns-01"];
      const parsed = JSON.parse(entry.bytes);
      parsed.rows[0].name = "tampered name";
      entry.bytes = JSON.stringify(parsed);
      writeFileSync(p, JSON.stringify(battery));
      await expectStopped(dir, "fixture campaign bytes");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tampered trust entry (taxonomy fixture) stops the run", async () => {
    const dir = tempCopy();
    try {
      const p = join(dir, "fixtures", "taxonomy.json");
      const tax = JSON.parse(readFileSync(p, "utf8"));
      tax.rows.push({ entry: "template", template_id: "tpl-evil", text: "DRAFT — NOT PUBLISHED\nEvil." });
      writeFileSync(p, JSON.stringify(tax));
      await expectStopped(dir, "fixtures/taxonomy.json");
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
      const v = await harness.verifyManifest(dir);
      assert.equal(v.ok, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
