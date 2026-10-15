#!/usr/bin/env node
/**
 * freeze-corpus.js — AUTHORING TOOL (not part of the scored path).
 *
 * Recomputes corpus/manifest.json (sorted per-file SHA-256 pins) and the
 * corpus digest, and writes corpus/corpus_digest.txt as a recorded
 * reference value for reviewer/CI use.
 *
 * This tool NEVER writes CS_APPROVED_ROOT anywhere in the candidate tree
 * (package.json or otherwise) — a candidate-controlled script supplying
 * its own "independently trusted" root is exactly the self-certification
 * the trust model forbids (mirrors Tax Agent's TAX-001 finding). The
 * approved root is a separately trusted host input: a reviewer or CI
 * pipeline reads the digest this tool prints (or corpus_digest.txt) and
 * supplies it externally as the CS_APPROVED_ROOT environment variable at
 * invocation time — `npm test`/`npm run battery` never set it
 * themselves, and the launcher (tests/run-tests.js, tests/run-battery.js)
 * fails closed when it is absent.
 *
 * Run after any corpus-affecting change, then re-record the new digest
 * as the reviewed root wherever the reviewer/CI config stores it.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sha = (b) => createHash("sha256").update(b).digest("hex");

const files = ["README.md", "package.json"];
for (const dir of ["corpus", "src", "runner", "fixtures", "tests"]) {
  for (const f of readdirSync(join(ROOT, dir)).filter((x) => !x.startsWith("."))) {
    const p = `${dir}/${f}`;
    if (p === "corpus/manifest.json" || p === "corpus/corpus_digest.txt") continue;
    if (dir === "fixtures" || dir === "corpus") {
      if (f.endsWith(".json") || f.endsWith(".js")) files.push(p);
    } else if (f.endsWith(".js")) {
      files.push(p);
    }
  }
}
files.sort();

const preEntries = files
  .filter((p) => p !== "package.json")
  .map((p) => ({ path: p, sha256: sha(readFileSync(join(ROOT, p))) }));
const canonical = JSON.stringify(preEntries);
const digest = sha(Buffer.from(canonical, "utf8"));

// package.json is hashed as-is — this tool never writes to it. The
// candidate tree supplies no trust root of its own.
const pkgPath = join(ROOT, "package.json");
const entries = [...preEntries, { path: "package.json", sha256: sha(readFileSync(pkgPath)) }];
entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

writeFileSync(join(ROOT, "corpus", "manifest.json"), JSON.stringify({ corpus_digest: digest, files: entries }, null, 2) + "\n");
writeFileSync(join(ROOT, "corpus", "corpus_digest.txt"), digest + "\n");

console.log(`corpus digest: ${digest}`);
console.log(`files pinned: ${entries.length}`);
