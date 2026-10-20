#!/usr/bin/env node
/**
 * freeze-corpus.js — AUTHORING TOOL (not part of the scored path).
 * Writes corpus/manifest.json (per-file sha256 pins, fixed key order)
 * and corpus/corpus_digest.txt (the manifest ROOT digest:
 * sha256(JSON.stringify(parsed manifest)), which the trust bootstrap
 * recomputes before opening any pinned file).
 *
 * Freeze ONLY after all final source/test/fixture/corpus/README edits
 * are in; then rerun every official suite at the final head.
 */

import { readdirSync, readFileSync, writeFileSync, lstatSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROTO = join(HERE, "..");
const sha = (b) => createHash("sha256").update(b).digest("hex");

const SKIP = new Set(["corpus/manifest.json", "corpus/corpus_digest.txt"]);
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) throw new Error(`symlink in pinned tree: ${relative(PROTO, p)}`);
    if (st.isDirectory()) walk(p, out);
    else {
      const rel = relative(PROTO, p).replace(/\\/g, "/");
      if (!SKIP.has(rel)) out.push(rel);
    }
  }
  return out;
};

const files = [];
for (const sub of ["src", "tests", "runner", "fixtures", "corpus"]) files.push(...walk(join(PROTO, sub)));
files.push("package.json", "README.md");
files.sort();

const manifest = {
  manifest_version: "1",
  files: files.map((p) => ({ path: p, sha256: sha(readFileSync(join(PROTO, p))) })),
};
// ROOT digest: the bootstrap recomputes sha256(JSON.stringify(parsed
// manifest)) — fixed key order above makes it deterministic.
const digest = sha(JSON.stringify(manifest));

writeFileSync(join(HERE, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(join(HERE, "corpus_digest.txt"), digest + "\n");
console.log(`frozen: ${files.length} files, root digest ${digest}`);
