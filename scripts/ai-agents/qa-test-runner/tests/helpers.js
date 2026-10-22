/**
 * helpers.js — fixture checkout factory for the runner tests.
 *
 * Creates a REAL temp git repository whose node_modules/.bin/vitest is a
 * small shell stub. The stub is not a fake of the runner: the runner
 * still spawns `npx vitest run ...` as a real child process, resolves
 * the stub through the checkout's own node_modules/.bin, captures its
 * exit code, and parses the JSON report file the stub writes to the
 * --outputFile path it was handed. It tests the runner's process
 * plumbing honestly; only vitest itself is stubbed. The stub also drops
 * a `runner-executed.marker` file in its cwd on every invocation, so
 * tests can prove that a refusal executed NOTHING.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function git(dir, args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
}

function stubScript({ json, exitCode, sleepSeconds }) {
  const lines = ["#!/bin/sh", "touch runner-executed.marker"];
  if (sleepSeconds) {
    lines.push(`exec sleep ${sleepSeconds}`);
    return lines.join("\n") + "\n";
  }
  lines.push('out=""');
  lines.push('prev=""');
  lines.push('for a in "$@"; do');
  lines.push('  if [ "$prev" = "--outputFile" ]; then out="$a"; fi');
  lines.push('  prev="$a"');
  lines.push("done");
  lines.push('if [ -n "$out" ]; then');
  lines.push("  cat > \"$out\" <<'QA_STUB_JSON'");
  lines.push(JSON.stringify(json));
  lines.push("QA_STUB_JSON");
  lines.push("fi");
  lines.push(`exit ${exitCode}`);
  return lines.join("\n") + "\n";
}

/**
 * makeStubCheckout(t, {json, exitCode, sleepSeconds, withVitest})
 * -> {dir, head, markerPath}
 */
export function makeStubCheckout(t, opts = {}) {
  const { json = null, exitCode = 0, sleepSeconds = 0, withVitest = true } = opts;
  const dir = mkdtempSync(join(tmpdir(), "qa-runner-fixture-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture-checkout", private: true, version: "0.0.0" }) + "\n");
  if (withVitest) {
    mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
    const binPath = join(dir, "node_modules", ".bin", "vitest");
    writeFileSync(binPath, stubScript({ json, exitCode, sleepSeconds }));
    chmodSync(binPath, 0o755);
  }
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.email=fixture@example.invalid", "-c", "user.name=fixture", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture"]);
  const head = git(dir, ["rev-parse", "HEAD"]).trim();
  return { dir, head, markerPath: join(dir, "runner-executed.marker") };
}

export function loadFixtureJson(name) {
  const path = fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadFixtureText(name) {
  const path = fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
  return readFileSync(path, "utf8");
}
