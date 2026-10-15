/**
 * zerotools.test.js — static capability audit of the scored sources.
 *
 * The agent has no file-write API, no network, no tool calls, no dynamic
 * imports, and no eval: absence of capabilities is the security boundary.
 * This test scans src/ for the corresponding primitives.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./testutil.js";

const FORBIDDEN = [
  [/[^a-zA-Z]eval\s*\(/, "eval("],
  [/new\s+Function\s*\(/, "new Function("],
  [/(^|[^a-zA-Z_$])import\s*\(/, "dynamic import("],
  [/[^a-zA-Z]fetch\s*\(/, "fetch("],
  [/require\s*\(/, "require("],
  [/child_process/, "child_process"],
  [/worker_threads/, "worker_threads"],
  [/node:fs/, "node:fs"],
  [/XMLHttpRequest/, "XMLHttpRequest"],
  [/WebSocket/, "WebSocket"],
];

test("src/ contains no execution, I/O, or network primitives", () => {
  const hits = [];
  for (const f of readdirSync(join(ROOT, "src")).filter((x) => x.endsWith(".js"))) {
    const src = readFileSync(join(ROOT, "src", f), "utf8");
    for (const [pattern, label] of FORBIDDEN) {
      if (pattern.test(src)) hits.push(`${f}: ${label}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("src/ imports only node:crypto", () => {
  const hits = [];
  for (const f of readdirSync(join(ROOT, "src")).filter((x) => x.endsWith(".js"))) {
    const src = readFileSync(join(ROOT, "src", f), "utf8");
    for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
      const mod = m[1];
      if (mod !== "node:crypto" && mod.startsWith(".")) continue;
      if (mod.startsWith(".")) continue;
      if (mod !== "node:crypto") hits.push(`${f}: imports ${mod}`);
    }
  }
  assert.deepEqual(hits, []);
});
