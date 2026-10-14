/**
 * Launcher authentication tests (CI-006 round 3).
 *
 * The mutation regression: tamper with src/trust.js (the verifier itself)
 * in a COPY of the corpus, then invoke the REAL launcher entrypoints.
 * The canary must NEVER execute — authentication happens with builtins
 * only, before any corpus import.
 *
 * The real corpus tree is never modified: all tampering happens in a temp
 * copy, so this file races with no other test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { manifestDigest } from "../src/trust.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CANARY = "CANARY_EXECUTED_9f8e7d6c5b4a";

function hostDigest() {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "corpus", "manifest.json"), "utf8"));
  return manifestDigest(manifest.files);
}

/** Copy the corpus to a temp dir; returns the temp root. */
function copyCorpus() {
  const tmp = mkdtempSync(path.join(tmpdir(), "ci-corpus-"));
  for (const dir of ["corpus", "src", "tests", "runner"]) {
    cpSync(path.join(ROOT, dir), path.join(tmp, dir), { recursive: true });
  }
  return tmp;
}

function runLauncher(tmp, mode) {
  return spawnSync(process.execPath, [path.join(tmp, "runner", "launch.js"), mode], {
    env: {
      ...process.env,
      CI_CORPUS_ROOT: tmp,
      CI_APPROVED_ROOT_DIGEST: hostDigest(),
    },
    encoding: "utf8",
  });
}

test("launcher: pristine copy authenticates (manual + test modes)", () => {
  const tmp = copyCorpus();
  try {
    const m = runLauncher(tmp, "manual");
    assert.equal(m.status, 0, `manual failed: ${m.stderr}`);
    assert.match(m.stderr, /corpus authenticated/);
    assert.ok(!m.stdout.includes(CANARY) && !m.stderr.includes(CANARY));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("CI-006: tampered trust.js never executes (manual entrypoint)", () => {
  const tmp = copyCorpus();
  try {
    // Mutate the VERIFIER itself in the copy.
    const p = path.join(tmp, "src", "trust.js");
    writeFileSync(p, readFileSync(p, "utf8") + `\nconsole.log("${CANARY}");\n`);
    const r = runLauncher(tmp, "manual");
    assert.notEqual(r.status, 0, "tampered corpus must not launch");
    const combined = `${r.stdout}\n${r.stderr}`;
    assert.ok(!combined.includes(CANARY), "the canary must NEVER execute");
    assert.ok(!combined.includes("COMPARED"), "no comparison on tampered corpus");
    assert.match(combined, /file_tampered|root_digest_mismatch/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("CI-006: tampered trust.js never executes (node --test entrypoint)", () => {
  const tmp = copyCorpus();
  try {
    const p = path.join(tmp, "src", "trust.js");
    writeFileSync(p, readFileSync(p, "utf8") + `\nconsole.log("${CANARY}");\n`);
    const r = runLauncher(tmp, "test");
    assert.notEqual(r.status, 0, "tampered corpus must not run tests");
    const combined = `${r.stdout}\n${r.stderr}`;
    assert.ok(!combined.includes(CANARY), "the canary must NEVER execute");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("launcher: missing host digest fails closed before any import", () => {
  const tmp = copyCorpus();
  try {
    const p = path.join(tmp, "src", "trust.js");
    writeFileSync(p, readFileSync(p, "utf8") + `\nconsole.log("${CANARY}");\n`);
    const r = spawnSync(process.execPath, [path.join(tmp, "runner", "launch.js"), "manual"], {
      env: { ...process.env, CI_CORPUS_ROOT: tmp, CI_APPROVED_ROOT_DIGEST: "" },
      encoding: "utf8",
    });
    assert.notEqual(r.status, 0);
    assert.ok(!`${r.stdout}\n${r.stderr}`.includes(CANARY));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("CI-006r4: added unlisted test file fails closed before it executes", () => {
  const tmp = copyCorpus();
  try {
    // Add an executable the manifest never approved.
    writeFileSync(
      path.join(tmp, "tests", "reviewer-extra.test.js"),
      `import { test } from "node:test";\ntest("canary", () => { console.log("${CANARY}"); });\n`,
    );
    const r = runLauncher(tmp, "test");
    const combined = `${r.stdout}\n${r.stderr}`;
    assert.notEqual(r.status, 0, "unlisted executable must fail closed");
    assert.ok(!combined.includes(CANARY), "the unlisted canary must NEVER execute");
    assert.match(combined, /unlisted_executable/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("CI-006r4: added unlisted src file fails closed on the manual path", () => {
  const tmp = copyCorpus();
  try {
    writeFileSync(path.join(tmp, "src", "reviewer-extra.js"), `console.log("${CANARY}");\n`);
    const r = runLauncher(tmp, "manual");
    const combined = `${r.stdout}\n${r.stderr}`;
    assert.notEqual(r.status, 0, "unlisted executable must fail closed");
    assert.ok(!combined.includes(CANARY), "the unlisted file must NEVER execute");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
