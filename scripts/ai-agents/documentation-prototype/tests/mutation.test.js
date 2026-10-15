/**
 * mutation.test.js — tampering with the oracle helper, expectations,
 * fixture bytes, trust registry or manifest must stop before oracle/agent
 * execution or success output. These tests copy the tree to a temp dir,
 * tamper one artifact, and assert the bootstrap refuses (exit 3) while
 * keeping the ORIGINAL DOC_APPROVED_ROOT fixed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, cpSync, rmSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPROVED_ROOT = readFileSync(join(ROOT, "corpus", "corpus_digest.txt"), "utf8").trim();

function tamperedCopy(mutate) {
  const tmp = mkdtempSync(join(tmpdir(), "doc-mut-"));
  cpSync(ROOT, tmp, { recursive: true });
  mutate(tmp);
  return tmp;
}

function runBatteryBootstrap(tmp) {
  return spawnSync(process.execPath, [join(tmp, "tests", "run-battery.js")], {
    env: { ...process.env, DOC_APPROVED_ROOT: APPROVED_ROOT },
    encoding: "utf8",
  });
}

test("tampered fixture bytes -> bootstrap refuses before scoring", () => {
  const tmp = tamperedCopy((t) => {
    const p = join(t, "fixtures", "store.json");
    const s = readFileSync(p, "utf8").replace("const MAX_RETRIES = 3;", "const MAX_RETRIES = 4;");
    writeFileSync(p, s);
  });
  try {
    const r = runBatteryBootstrap(tmp);
    assert.equal(r.status, 3, `expected exit 3, got ${r.status}: ${r.stderr.slice(0, 300)}`);
    assert.match(r.stderr, /trust failure/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("tampered battery expectation -> bootstrap refuses before scoring", () => {
  const tmp = tamperedCopy((t) => {
    const p = join(t, "corpus", "battery.json");
    const s = readFileSync(p, "utf8").replace('"status": "READY"', '"status": "BLOCKED"');
    writeFileSync(p, s);
  });
  try {
    const r = runBatteryBootstrap(tmp);
    assert.equal(r.status, 3, `expected exit 3, got ${r.status}: ${r.stderr.slice(0, 300)}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("tampered manifest digest -> bootstrap refuses", () => {
  const tmp = tamperedCopy((t) => {
    const p = join(t, "corpus", "manifest.json");
    const m = JSON.parse(readFileSync(p, "utf8"));
    m.corpus_digest = "0".repeat(64);
    writeFileSync(p, JSON.stringify(m));
  });
  try {
    const r = runBatteryBootstrap(tmp);
    assert.equal(r.status, 3, `expected exit 3, got ${r.status}: ${r.stderr.slice(0, 300)}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("tampered oracle helper (harness.js) -> bootstrap refuses", () => {
  const tmp = tamperedCopy((t) => {
    const p = join(t, "tests", "harness.js");
    writeFileSync(p, readFileSync(p, "utf8") + "\n// tampered\n");
  });
  try {
    const r = runBatteryBootstrap(tmp);
    assert.equal(r.status, 3, `expected exit 3, got ${r.status}: ${r.stderr.slice(0, 300)}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("wrong approved root -> bootstrap refuses", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "tests", "run-battery.js")], {
    env: { ...process.env, DOC_APPROVED_ROOT: "f".repeat(64) },
    encoding: "utf8",
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /not the separately trusted approved root/);
});
