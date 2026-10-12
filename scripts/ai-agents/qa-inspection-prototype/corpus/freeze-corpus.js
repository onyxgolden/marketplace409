#!/usr/bin/env node
/**
 * freeze-corpus.js — authoring tool: pins the corpus manifest.
 *
 * Computes SHA-256 over every scored-path constituent (battery corpus,
 * src modules, runner, default fixtures, test harness files, and this
 * authoring tooling), writes corpus/manifest.json (sorted) and
 * corpus/corpus_digest.txt. The battery verifier re-checks every hash
 * before executing a single case; any tampering stops the run.
 *
 * Deterministic: sorted paths, canonical JSON.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sha256File = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

function listDir(rel) {
  const abs = join(ROOT, rel);
  return readdirSync(abs)
    .filter((f) => !f.startsWith("."))
    .map((f) => join(rel, f))
    .sort();
}

const files = [
  "package.json",
  "README.md",
  "corpus/battery.json",
  "corpus/make-battery.js",
  "corpus/freeze-corpus.js",
  ...listDir("src").filter((f) => f.endsWith(".js")),
  ...listDir("runner").filter((f) => f.endsWith(".js")),
  ...listDir("fixtures").filter((f) => f.endsWith(".json")),
  ...listDir("tests").filter((f) => f.endsWith(".js")),
].sort();

const entries = files.map((p) => ({ path: p, sha256: sha256File(join(ROOT, p)) }));
// Canonical JSON: sorted keys, no whitespace ambiguity.
const canonical = JSON.stringify(entries.map((e) => ({ path: e.path, sha256: e.sha256 })));
const digest = createHash("sha256").update(canonical, "utf8").digest("hex");

writeFileSync(join(ROOT, "corpus", "manifest.json"), JSON.stringify({ corpus_digest: digest, files: entries }, null, 2) + "\n");
writeFileSync(join(ROOT, "corpus", "corpus_digest.txt"), digest + "\n");
console.log(`manifest: ${entries.length} files, corpus_digest=${digest}`);
