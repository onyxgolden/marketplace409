/**
 * trustroot.test.js — DOC-002 regression: the scored corpus approval root
 * must come from outside the candidate tree.
 *
 * - The scored entrypoints fail closed (exit 3) when DOC_APPROVED_ROOT is
 *   absent — the candidate cannot run scored without an external root.
 * - package.json npm scripts must not embed DOC_APPROVED_ROOT: a candidate
 *   that changes corpus/oracles must not be able to update its own
 *   alleged approved root in the same tree.
 * - A candidate-supplied root (wrong value) still fails closed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function runEntrypoint(name, env) {
  return spawnSync(process.execPath, [join(ROOT, "tests", name)], {
    env,
    encoding: "utf8",
    timeout: 120000,
  });
}

function envWithoutRoot() {
  const env = { ...process.env };
  delete env.DOC_APPROVED_ROOT;
  return env;
}

test("DOC-002: run-tests.js without DOC_APPROVED_ROOT fails closed (exit 3)", () => {
  const r = runEntrypoint("run-tests.js", envWithoutRoot());
  assert.equal(r.status, 3, `expected exit 3, got ${r.status}`);
  assert.match(r.stderr, /separately trusted approval root/);
});

test("DOC-002: run-battery.js without DOC_APPROVED_ROOT fails closed (exit 3)", () => {
  const r = runEntrypoint("run-battery.js", envWithoutRoot());
  assert.equal(r.status, 3, `expected exit 3, got ${r.status}`);
  assert.match(r.stderr, /separately trusted approval root/);
});

test("DOC-002: package.json scripts must not embed DOC_APPROVED_ROOT", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
    assert.ok(
      !/DOC_APPROVED_ROOT=/.test(script),
      `package.json script "${name}" embeds DOC_APPROVED_ROOT — the candidate tree must not supply its own approval root`
    );
  }
});

test("DOC-002: freeze-corpus.js must not rewrite package.json", () => {
  const src = readFileSync(join(ROOT, "corpus", "freeze-corpus.js"), "utf8");
  assert.ok(!src.includes("writeFileSync(pkgPath"), "freeze-corpus must not write package.json");
  assert.ok(!/DOC_APPROVED_ROOT=\$\{digest\}/.test(src), "freeze-corpus must not inject the digest into npm scripts");
});

test("DOC-002 negative: candidate that ships its own root cannot satisfy the bootstrap", () => {
  // Even if a candidate edits package.json to embed a root matching its
  // tampered corpus, the bootstrap ignores the tree and compares against
  // the external env root — here the wrong value — and refuses.
  const r = runEntrypoint("run-battery.js", { ...process.env, DOC_APPROVED_ROOT: "0".repeat(64) });
  assert.equal(r.status, 3, `expected exit 3, got ${r.status}`);
});
