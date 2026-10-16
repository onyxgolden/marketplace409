#!/usr/bin/env node
/**
 * run-tests.js — official test entrypoint. Invoke DIRECTLY, never via npm:
 *
 *   MK_APPROVED_ROOT=<64-hex> node tests/run-tests.js
 *
 * `npm test` must NEVER be the official path: npm executes candidate
 * lifecycle scripts (pretest/posttest) BEFORE this file runs, so a
 * tampered package.json could execute arbitrary code before trust
 * authentication. Direct node invocation guarantees this builtins-only
 * authenticator runs first.
 *
 * The separately trusted approval root is a host input (MK_APPROVED_ROOT
 * env, supplied by the reviewer or CI pipeline at invocation time — never
 * by this package's own scripts or any file in the candidate tree). The
 * full corpus digest, covering EVERY pinned file including package.json,
 * README.md and the scored tests themselves, is recomputed with node:fs /
 * node:crypto ONLY and authenticated against that root BEFORE the real
 * `node --test` entrypoints are spawned.
 *
 * Refuse (exit 3) on any mismatch: no test file is imported, no helper
 * executes, no canary can fire. This file imports node builtins only.
 * It never imports scored code.
 */

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { normalize } from "node:path/posix";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const APPROVED_ROOT = process.env.MK_APPROVED_ROOT;
if (typeof APPROVED_ROOT !== "string" || !/^[0-9a-f]{64}$/.test(APPROVED_ROOT)) {
  console.error("bootstrap: missing separately trusted approval root (MK_APPROVED_ROOT) — refusing to run");
  process.exit(3);
}

{
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  let bad = null;
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  } catch {
    bad = "corpus/manifest.json unreadable";
  }
  const files = manifest?.files ?? [];
  const seen = new Set();
  if (!bad) {
    for (const e of files) {
      const p = e?.path;
      if (
        typeof p !== "string" || p.length === 0 || p.startsWith("/") || p.includes("\\") ||
        normalize(p) !== p || p.startsWith("..") || p.includes("../") || seen.has(p)
      ) { bad = `bad manifest entry: ${String(p)}`; break; }
      seen.add(p);
      let bytes;
      try { bytes = readFileSync(join(ROOT, p)); } catch { bad = `missing pinned file: ${p}`; break; }
      if (sha(bytes) !== e.sha256) { bad = `hash mismatch: ${p}`; break; }
    }
  }
  if (!bad) {
    const want = ["package.json", "README.md"];
    for (const dir of ["corpus", "src", "runner", "fixtures", "tests"]) {
      for (const f of readdirSync(join(ROOT, dir)).filter((x) => !x.startsWith("."))) {
        const p2 = `${dir}/${f}`;
        if (p2 === "corpus/manifest.json" || p2 === "corpus/corpus_digest.txt") continue;
        if (dir === "fixtures" || dir === "corpus") {
          if (f.endsWith(".json") || f.endsWith(".js")) want.push(p2);
        } else if (f.endsWith(".js")) {
          want.push(p2);
        }
      }
    }
    for (const p of want.sort()) {
      if (!seen.has(p)) { bad = `unlisted file: ${p}`; break; }
    }
  }
  if (!bad) {
    const canonical = JSON.stringify(
      files.map((e) => ({ path: e.path, sha256: e.sha256 }))
    );
    const digest = sha(Buffer.from(canonical, "utf8"));
    if (digest !== manifest.corpus_digest) bad = "manifest corpus_digest does not match recomputed digest";
    else if (readFileSync(join(ROOT, "corpus", "corpus_digest.txt"), "utf8").trim() !== manifest.corpus_digest) bad = "corpus_digest.txt does not match manifest digest";
    else if (digest !== APPROVED_ROOT) bad = "corpus digest is not the separately trusted approved root";
  }
  if (bad) {
    console.error(`bootstrap: trust failure — ${bad}`);
    process.exit(3);
  }
}

const testFiles = readdirSync(join(ROOT, "tests"))
  .filter((f) => f.endsWith(".test.js"))
  .sort()
  .map((f) => join(ROOT, "tests", f));
if (testFiles.length === 0) {
  console.error("bootstrap: no scored test entrypoints found");
  process.exit(3);
}
const child = spawnSync(process.execPath, ["--test", ...testFiles], {
  env: process.env,
  stdio: "inherit",
});
process.exit(child.status ?? 3);
