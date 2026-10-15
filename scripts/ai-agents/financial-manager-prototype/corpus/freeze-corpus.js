#!/usr/bin/env node
/**
 * freeze-corpus.js — AUTHORING TOOL (not part of the scored path).
 *
 * Recomputes corpus/manifest.json (sorted per-file SHA-256 pins) and the
 * corpus digest, and writes corpus/corpus_digest.txt. The digest covers
 * EVERY pinned file INCLUDING package.json.
 *
 * FM-004: the separately trusted root is NEVER written into the candidate
 * tree. package.json carries no FM_APPROVED_ROOT; the root lives only in
 * the host environment (and is recorded externally in review requests /
 * the tracker when a corpus is frozen for review).
 *
 * Pinned: README.md, package.json, corpus/*.json|js|md (except
 * manifest.json and corpus_digest.txt, protected by the digest chain),
 * src/*.js, runner/*.js, fixtures/*.json|js, tests/*.js.
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
      if (f.endsWith(".json") || f.endsWith(".js") || f.endsWith(".md")) files.push(p);
    } else if (f.endsWith(".js")) {
      files.push(p);
    }
  }
}
files.sort();

const preEntries = files
  .map((p) => ({ path: p, sha256: sha(readFileSync(join(ROOT, p))) }));
preEntries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
const canonical = JSON.stringify(preEntries);
const digest = sha(Buffer.from(canonical, "utf8"));

writeFileSync(join(ROOT, "corpus", "manifest.json"), JSON.stringify({ corpus_digest: digest, files: preEntries }, null, 2) + "\n");
writeFileSync(join(ROOT, "corpus", "corpus_digest.txt"), digest + "\n");

console.log(`corpus digest: ${digest}`);
console.log(`files pinned: ${preEntries.length}`);
