#!/usr/bin/env node
/**
 * run-tests.js — `npm test` entrypoint: builtins-only trust authentication
 * BEFORE any scored test/helper is imported.
 *
 * The separately trusted approval root is a host input (RESEARCH_APPROVED_ROOT
 * env, supplied by the reviewer or CI pipeline — never by this package's
 * own scripts). The full corpus digest is recomputed with node:fs /
 * node:crypto ONLY and authenticated against that root BEFORE the real
 * `node --test` entrypoints are spawned. Refuse (exit 3) on mismatch.
 */

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { normalize } from "node:path/posix";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const APPROVED_ROOT = process.env.RESEARCH_APPROVED_ROOT;
if (typeof APPROVED_ROOT !== "string" || !/^[0-9a-f]{64}$/.test(APPROVED_ROOT)) {
  console.error("bootstrap: missing separately trusted approval root (RESEARCH_APPROVED_ROOT) — refusing to run");
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
    const walk = (dir, out = []) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else out.push(p);
      }
      return out;
    };
    for (const sub of ["src", "tests", "runner", "fixtures", "corpus"]) {
      for (const p of walk(join(ROOT, sub))) {
        const rel = p.slice(ROOT.length + 1).replace(/\\/g, "/");
        if (rel === "corpus/manifest.json" || rel === "corpus/corpus_digest.txt") continue;
        if (!seen.has(rel)) { bad = `unlisted file: ${rel}`; break; }
      }
      if (bad) break;
    }
    for (const f of ["package.json", "README.md"]) {
      if (!seen.has(f)) { bad = `unlisted file: ${f}`; break; }
    }
  }
  if (!bad) {
    const digest = sha(JSON.stringify(manifest));
    if (digest !== APPROVED_ROOT) bad = `corpus digest mismatch: recomputed ${digest.slice(0, 16)}… vs approved ${APPROVED_ROOT.slice(0, 16)}…`;
  }
  if (bad) {
    console.error(`bootstrap: trust authentication failed — ${bad}`);
    process.exit(3);
  }
  console.log("bootstrap: trust authentication OK");
}

const testFiles = [
  "canonical.test.js",
  "schemas.test.js",
  "resolver.test.js",
  "research.test.js",
  "budgets.test.js",
  "determinism.test.js",
  "injection.test.js",
  "execution-addendum.test.js",
  "fixround4.test.js",
  "per008.test.js",
  "watchdog.test.js",
  "trust.test.js",
  "battery.test.js",
];

let failed = 0;
for (const f of testFiles) {
  const r = spawnSync(process.execPath, ["--test", join(ROOT, "tests", f)], { stdio: "inherit", env: process.env });
  if (r.status !== 0) { console.error(`FAIL: ${f} (exit ${r.status})`); failed++; }
}
process.exit(failed ? 1 : 0);
