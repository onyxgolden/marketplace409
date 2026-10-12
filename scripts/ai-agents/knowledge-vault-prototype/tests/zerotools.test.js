/**
 * zerotools.test.js — the prototype ships zero runtime dependencies:
 * only node builtins may be imported anywhere under src/, runner/ or
 * fixtures/ (authoring tools) — and the scored src/ path must not import
 * node:worker_threads, node:child_process, node:fs or node:os either.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const BUILTINS = new Set([
  "node:assert", "node:assert/strict", "node:crypto", "node:fs", "node:os", "node:path",
  "node:perf_hooks", "node:url", "node:util", "node:worker_threads",
  "node:child_process", "node:test",
]);
const SCORED_FORBIDDEN = new Set(["node:fs", "node:os", "node:worker_threads", "node:child_process", "node:path", "node:url"]);

function jsFiles(dir) {
  return readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".js")).map((f) => `${dir}/${f}`);
}

test("package.json declares zero runtime dependencies", () => {
  assert.deepEqual(pkg.dependencies ?? {}, {});
  assert.deepEqual(pkg.devDependencies ?? {}, {});
});

test("only node builtins are imported", () => {
  const files = [...jsFiles("src"), ...jsFiles("runner"), ...jsFiles("fixtures"), ...jsFiles("tests"), ...jsFiles("corpus")];
  const importRe = /from\s+["']([^"']+)["']/g;
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8");
    let m;
    while ((m = importRe.exec(src)) !== null) {
      const mod = m[1];
      if (mod.startsWith(".") || mod.startsWith("node:")) {
        if (mod.startsWith("node:")) assert.ok(BUILTINS.has(mod), `${f}: non-allowlisted builtin ${mod}`);
      } else {
        assert.fail(`${f}: non-builtin import '${mod}'`);
      }
    }
    // require() is forbidden too (this test file itself is exempt: the
    // word appears in its own assertion message, not in a call).
    if (f !== "tests/zerotools.test.js") {
      assert.ok(!/\brequire\s*\(/.test(src), `${f}: require() forbidden`);
    }
  }
});

test("scored src/ has no I/O, workers or subprocess imports", () => {
  for (const f of jsFiles("src")) {
    const src = readFileSync(join(ROOT, f), "utf8");
    for (const mod of SCORED_FORBIDDEN) {
      assert.ok(!src.includes(`"${mod}"`) && !src.includes(`'${mod}'`), `${f}: scored code must not import ${mod}`);
    }
  }
});
