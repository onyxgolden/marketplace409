import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("package.json declares zero runtime dependencies", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.type, "module");
});

test("no node_modules directory is present in this prototype", () => {
  assert.equal(existsSync(join(ROOT, "node_modules")), false);
});

test("package.json declares no pre/post lifecycle scripts that could run unauthenticated code", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const scriptNames = Object.keys(pkg.scripts ?? {});
  for (const n of scriptNames) {
    assert.ok(!n.startsWith("pre") && !n.startsWith("post"), `unexpected lifecycle script: ${n}`);
  }
  assert.deepEqual(new Set(scriptNames), new Set(["battery", "test"]));
});
