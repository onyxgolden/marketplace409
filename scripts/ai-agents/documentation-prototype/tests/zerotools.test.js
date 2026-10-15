/**
 * zerotools.test.js — the agent source tree must not depend on network,
 * subprocess, eval, dynamic import, or environment access: pure Node 24
 * ESM with node:crypto only. Static scan of src/*.js.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

const BANNED = [
  [/fetch\s*\(/, "fetch("],
  [/child_process/, "child_process"],
  [/eval\s*\(/, "eval("],
  [/new\s+Function\s*\(/, "new Function("],
  [/import\s*\(/, "dynamic import("],
  [/process\.env/, "process.env"],
  [/XMLHttpRequest/, "XMLHttpRequest"],
  [/WebSocket/, "WebSocket"],
  [/require\s*\(/, "require("],
];

test("src/*.js contains no banned tool/network/eval constructs", () => {
  for (const f of readdirSync(SRC).filter((x) => x.endsWith(".js"))) {
    const text = readFileSync(join(SRC, f), "utf8");
    for (const [re, label] of BANNED) {
      assert.doesNotMatch(text, re, `src/${f}: banned construct ${label}`);
    }
  }
});

test("src imports only node:crypto", () => {
  for (const f of readdirSync(SRC).filter((x) => x.endsWith(".js"))) {
    const text = readFileSync(join(SRC, f), "utf8");
    for (const m of text.matchAll(/from\s+["']([^"']+)["']/g)) {
      const mod = m[1];
      const ok = mod === "node:crypto" || mod.startsWith("./") || mod.startsWith("../");
      assert.ok(ok, `src/${f}: unexpected import '${mod}'`);
    }
  }
});
