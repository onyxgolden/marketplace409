/**
 * cleanpath.test.js — portability regression: manifest paths must be
 * accepted on every platform. The old check used node:path.normalize,
 * which rewrites forward slashes to backslashes on Windows and rejects
 * every valid manifest path there.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { isCleanRelPath } from "./cleanpath.js";

test("accepts canonical forward-slash manifest paths", () => {
  for (const p of [
    "src/index.js",
    "tests/run-tests.js",
    "corpus/manifest.json",
    "fixtures/store.json",
    "package.json",
    "runner/run-manual.js",
    "a/b/c/d/e.txt",
  ]) {
    assert.equal(isCleanRelPath(p), true, p);
  }
});

test("rejects non-canonical and unsafe paths", () => {
  for (const p of [
    "",
    "/absolute/path.js",
    "C:\\windows\\path.js",
    "src\\index.js",
    "../escape.js",
    "a/../../escape.js",
    "a/../b.js",
    "./dot.js",
    "a/./b.js",
    "a//b.js",
    "trailing/",
    "..",
  ]) {
    assert.equal(isCleanRelPath(p), false, p);
  }
  assert.equal(isCleanRelPath(null), false);
  assert.equal(isCleanRelPath(undefined), false);
  assert.equal(isCleanRelPath(42), false);
});

test("does not rewrite separators like Windows normalize would", () => {
  // Simulates the Windows failure mode: a forward-slash path must not
  // be rejected merely for containing forward slashes.
  const p = "corpus/battery.json";
  assert.ok(p.includes("/"), "test path must contain a forward slash");
  assert.equal(isCleanRelPath(p), true);
});
