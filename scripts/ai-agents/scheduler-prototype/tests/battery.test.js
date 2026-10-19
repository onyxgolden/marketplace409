/** battery.test.js — frozen 120-case battery as a node:test suite. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("battery: 120/120 structural matches via standalone runner", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "tests", "run-battery.js")], {
    env: { ...process.env, SCHED_APPROVED_ROOT: process.env.SCHED_APPROVED_ROOT },
    encoding: "utf8",
  });
  assert.ok(r.stdout.includes("battery:"), `runner output missing: ${r.stdout.slice(0, 500)}`);
  const m = /battery: (\d+)\/(\d+) pass, (\d+) assertion failures/.exec(r.stdout);
  assert.ok(m, `unparseable battery output: ${r.stdout.slice(0, 500)}`);
  assert.equal(m[2], "120", `expected 120 cases, got ${m[2]}`);
  assert.equal(m[1], m[2], `not all passed: ${r.stdout.slice(0, 2000)}`);
  assert.equal(m[3], "0");
  assert.equal(r.status, 0);
});
