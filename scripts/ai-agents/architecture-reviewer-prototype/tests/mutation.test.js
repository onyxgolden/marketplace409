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
