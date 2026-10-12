/**
 * zerotools.test.js — zero-side-effect evidence: no write/network/exec
 * capability in the module surface, and a full battery run creates no
 * files inside the module.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const FORBIDDEN = [
  /require\(["']fs["']\)/,
  /from ["']node:fs["']/,
  /from ["']node:fs\/promises["']/,
  /child_process/,
  /node:worker_threads/,
  /fetch\s*\(/,
  /node:http/,
  /eval\s*\(/,
  /Function\s*\(/,
  /process\.env/,
];

function srcFiles() {
  const out = [];
  for (const f of readdirSync(join(ROOT, "src"))) {
    if (f.endsWith(".js")) out.push(join(ROOT, "src", f));
  }
  return out;
}

test("module surface has no write/network/exec imports", () => {
  for (const p of srcFiles()) {
    const text = readFileSync(p, "utf8");
    for (const pat of FORBIDDEN) {
      assert.ok(!pat.test(text), `${p} matches forbidden pattern ${pat}`);
    }
  }
});

function snapshot(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    out.push(`${f}:${st.isDirectory() ? "d" : st.size}`);
    if (st.isDirectory()) out.push(...snapshot(p).map((x) => `${f}/${x}`));
  }
  return out.sort();
}

test("a full review run creates no files in the module", () => {
  const before = snapshot(ROOT);
  const text = [
    "# DESIGN: zero",
    "[check:component-io] inputs: a; outputs: b",
    "[check:migration-pre-post] precondition: p; postcondition: q",
    "[check:read-write-boundary] reads: r; writes: w",
    "[check:retry-bounds] max_retries: 3",
    "[check:rollback] rollback: reverse on failure",
    "[check:failure-handling] on_failure: queue",
  ].join("\n");
  const b = Buffer.from(text, "utf8");
  const blob = createHash("sha1").update(Buffer.from(`blob ${b.length}\0`, "utf8")).update(b).digest("hex");
  const commit = createHash("sha256").update("zero", "utf8").digest("hex").slice(0, 40);
  const design_ref = { repo: "r", path: "designs/zero.md", commit, blob, algorithm: "git-sha1", revision: "fixture-rev-1" };
  const r = run(
    { design_ref, base_pin: { repo: "r", commit }, requested_action: "review" },
    { clock: 1, designs: { [`r\0designs/zero.md\0${commit}`]: text }, principals: [], gatePolicy: {} }
  );
  assert.equal(r.status, "REVIEWED");
  assert.deepEqual(snapshot(ROOT), before, "module tree changed during run");
});

test("every result carries advisory and fixture_only flags", () => {
  const r = run({ requested_action: "merge" }, { clock: 1, designs: {}, principals: [], gatePolicy: {} });
  assert.equal(r.advisory, true);
  assert.equal(r.fixture_only, true);
});
