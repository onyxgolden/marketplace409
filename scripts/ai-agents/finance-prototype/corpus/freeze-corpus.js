#!/usr/bin/env node
/**
 * freeze-corpus.js — AUTHORING TOOL (not part of the scored path).
 * Computes corpus/manifest.json (SHA-256 of every pinned file) and
 * corpus/corpus_digest.txt (the externally-supplied root).
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = [];
for (const sub of ["src", "tests", "runner", "fixtures", "corpus"]) {
  const d = join(ROOT, sub);
  for (const p of walk(d)) {
    const rel = relative(ROOT, p).replace(/\\/g, "/");
    // Skip generated artifacts that are outputs, not inputs
    if (rel === "corpus/manifest.json" || rel === "corpus/corpus_digest.txt") continue;
    if (rel === "fixtures/store.json" || rel === "corpus/battery.json") {
      // These ARE pinned (generated but deterministic inputs)
    }
    files.push({ path: rel, sha256: sha256File(p) });
  }
}
// Pin package.json and README.md too
for (const f of ["package.json", "README.md"]) {
  try {
    files.push({ path: f, sha256: sha256File(join(ROOT, f)) });
  } catch { /* README may not exist yet */ }
}

files.sort((a, b) => a.path < b.path ? -1 : 1);
const manifest = { files };
writeFileSync(join(ROOT, "corpus", "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const digest = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
writeFileSync(join(ROOT, "corpus", "corpus_digest.txt"), digest + "\n");
console.log(`manifest: ${files.length} files, digest ${digest}`);
