/**
 * mutation.test.js — corpus/oracle integrity regressions.
 *
 * Each test copies the candidate tree to a temp dir, tampers ONE pinned
 * artifact, and re-runs the trust bootstrap (tests/run-battery.js) with
 * the ORIGINAL approved root fixed. Any tamper — source, oracle helper,
 * expected file, fixture bytes, trust registry, or manifest — must stop
 * the run before a single case executes (exit 3). The attack tests never
 * switch to the candidate's newly edited npm root.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./testutil.js";

function pristineRoot() {
  return process.env.PM_APPROVED_ROOT ?? readFileSync(join(ROOT, "corpus", "corpus_digest.txt"), "utf8").trim();
}

function candidateWith(tamper) {
  const dir = mkdtempSync(join(tmpdir(), "pm-mutation-"));
  cpSync(ROOT, dir, { recursive: true });
  tamper(dir);
  return dir;
}

function bootstrapExit(dir) {
  const child = spawnSync(process.execPath, [join(dir, "tests", "run-battery.js")], {
    env: { ...process.env, PM_APPROVED_ROOT: pristineRoot() },
    encoding: "utf8",
    timeout: 30000,
  });
  return child.status;
}

test("tampered src stops before any case executes", () => {
  const dir = candidateWith((d) => appendFileSync(join(d, "src", "index.js"), "\n// tampered\n"));
  try {
    assert.equal(bootstrapExit(dir), 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tampered oracle helper (harness) stops before any case executes", () => {
  const dir = candidateWith((d) => appendFileSync(join(d, "tests", "harness.js"), "\n// tampered\n"));
  try {
    assert.equal(bootstrapExit(dir), 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tampered expected battery file stops before any case executes", () => {
  const dir = candidateWith((d) => {
    const p = join(d, "corpus", "battery.json");
    const b = JSON.parse(readFileSync(p, "utf8"));
    b[0].expected.status = "PROPOSED";
    writeFileSync(p, JSON.stringify(b));
  });
  try {
    assert.equal(bootstrapExit(dir), 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tampered fixture bytes stop before any case executes", () => {
  const dir = candidateWith((d) => {
    const p = join(d, "fixtures", "store.json");
    const s = JSON.parse(readFileSync(p, "utf8"));
    s.cases[0].facts.amount_usd = 999999;
    writeFileSync(p, JSON.stringify(s));
  });
  try {
    assert.equal(bootstrapExit(dir), 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tampered trust registry stops before any case executes", () => {
  const dir = candidateWith((d) => {
    const p = join(d, "fixtures", "trust.json");
    const t = JSON.parse(readFileSync(p, "utf8"));
    t.relay_records[0].revoked = true;
    writeFileSync(p, JSON.stringify(t));
  });
  try {
    assert.equal(bootstrapExit(dir), 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("re-pinned manifest with tampered content still fails against the original root", () => {
  const dir = candidateWith((d) => {
    appendFileSync(join(d, "src", "engine.js"), "\n// tampered\n");
    // Attacker re-runs freeze-corpus to re-pin the manifest to the tampered tree.
    const freeze = spawnSync(process.execPath, [join(d, "corpus", "freeze-corpus.js")], { encoding: "utf8", timeout: 30000 });
    assert.equal(freeze.status, 0, `freeze failed: ${freeze.stderr}`);
  });
  try {
    // The ORIGINAL host-fixed root no longer matches: refuse.
    assert.equal(bootstrapExit(dir), 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
