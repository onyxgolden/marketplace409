#!/usr/bin/env node
/**
 * freeze-corpus.js — AUTHORING TOOL (not part of the scored path).
 *
 * Recomputes corpus/manifest.json (sorted per-file SHA-256 pins) and the
 * corpus digest, and writes corpus/corpus_digest.txt. The digest covers
 * EVERY pinned file INCLUDING package.json, so any lifecycle-script
 * tampering changes the digest and requires a new separately trusted
 * approval root. manifest.json and corpus_digest.txt are protected by
 * the digest chain + external approved root, not by self-pinning
 * (circular).
 *
 * Run after any corpus-affecting change, then supply the new digest to
 * the reviewer as the separately trusted MK_APPROVED_ROOT.
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
    // manifest.json and corpus_digest.txt are protected by the digest chain
    // + external approved root, not by self-pinning (circular).
    if (p === "corpus/manifest.json" || p === "corpus/corpus_digest.txt") continue;
    if (dir === "fixtures" || dir === "corpus") {
      if (f.endsWith(".json") || f.endsWith(".js")) files.push(p);
    } else if (f.endsWith(".js")) {
      files.push(p);
    }
  }
}
files.sort();

const entries = files.map((p) => ({ path: p, sha256: sha(readFileSync(join(ROOT, p))) }));
const canonical = JSON.stringify(entries);
const digest = sha(Buffer.from(canonical, "utf8"));

writeFileSync(join(ROOT, "corpus", "manifest.json"), JSON.stringify({ corpus_digest: digest, files: entries }, null, 2) + "\n");
writeFileSync(join(ROOT, "corpus", "corpus_digest.txt"), digest + "\n");
console.log(`corpus digest: ${digest}`);
console.log(`files pinned: ${entries.length}`);
