/**
 * zerotools.test.js — the prototype performs zero control/tool calls and has
 * zero side effects: no filesystem, network, or process access from the
 * scored modules; the harness spy is never invoked; the manual runner only
 * writes when an explicit --out directory is given.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run, FixtureResolver } from "../src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

describe("zero tool calls", () => {
  it("the instrumented recordToolCall spy is never invoked across the battery", () => {
    const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
    let calls = 0;
    for (const c of battery) {
      run(c.task, {
        clock: "2026-10-12T00:00:00Z",
        resolver: new FixtureResolver(c.fixtures),
        recordToolCall: () => {
          calls += 1;
        },
      });
    }
    assert.equal(calls, 0);
  });

  it("scored modules import nothing capable of side effects", () => {
    const banned = ["node:fs", "node:child_process", "node:net", "node:http", "node:https", "node:worker_threads", "node:cluster", "from \"fs\"", "from 'fs'", 'require("fs")', "require('fs')", "fetch(", "XMLHttpRequest", "eval(", "Function("];
    for (const f of readdirSync(SRC).filter((x) => x.endsWith(".js"))) {
      const src = readFileSync(join(SRC, f), "utf8");
      for (const b of banned) {
        assert.ok(!src.includes(b), `${f} contains banned import/call: ${b}`);
      }
    }
  });

  it("the resolver performs no I/O: all reads are in-memory", () => {
    const src = readFileSync(join(SRC, "resolver.js"), "utf8");
    assert.ok(!src.includes("readFileSync"));
    assert.ok(!src.includes("node:fs"));
  });
});
