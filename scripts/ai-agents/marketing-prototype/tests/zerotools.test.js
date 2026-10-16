/**
 * zerotools.test.js — zero-dependency, zero-network, zero-model-call
 * guarantees, mirroring the sibling prototypes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("package.json declares zero runtime dependencies", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});

test("no npm pre/post-install scripts are declared", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const scriptNames = Object.keys(pkg.scripts ?? {});
  for (const name of scriptNames) {
    assert.ok(!/^(pre|post)?(install|prepare|prepublish)/.test(name), `unexpected lifecycle script: ${name}`);
  }
});

test("every src/*.js import is either a node: builtin or a local relative path — no npm packages", () => {
  const dir = join(ROOT, "src");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const text = readFileSync(join(dir, f), "utf8");
    const importRe = /^\s*import\s+(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/gm;
    let m;
    while ((m = importRe.exec(text))) {
      const spec = m[1];
      const ok = spec.startsWith("node:") || spec.startsWith("./") || spec.startsWith("../");
      assert.ok(ok, `${f} imports non-builtin, non-relative module: ${spec}`);
    }
  }
});

test("MK_APPROVED_ROOT is never set by package.json's own scripts", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const allScripts = Object.values(pkg.scripts ?? {}).join(" ");
  assert.ok(!allScripts.includes("MK_APPROVED_ROOT"), "package.json scripts must never self-supply the trust root");
});

test("tests/run-tests.js and tests/run-battery.js reject when MK_APPROVED_ROOT is absent, before importing scored code", async () => {
  const { spawnSync } = await import("node:child_process");
  const env = { ...process.env };
  delete env.MK_APPROVED_ROOT;
  for (const script of ["tests/run-tests.js", "tests/run-battery.js"]) {
    const res = spawnSync(process.execPath, [join(ROOT, script)], { env });
    assert.equal(res.status, 3, `${script} should exit 3 when MK_APPROVED_ROOT is absent`);
  }
});

test("no network or model-call surface in src/", () => {
  const dir = join(ROOT, "src");
  const banned = ["fetch(", "XMLHttpRequest", "node:http", "node:https", "node:net", "child_process", "eval(", "Function("];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const text = readFileSync(join(dir, f), "utf8");
    for (const b of banned) {
      assert.ok(!text.includes(b), `${f} contains banned surface: ${b}`);
    }
  }
});
