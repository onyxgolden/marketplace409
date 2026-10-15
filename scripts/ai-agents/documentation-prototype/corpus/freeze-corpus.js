#!/usr/bin/env node
/**
 * freeze-corpus.js — AUTHORING TOOL (not part of the scored path).
 *
 * Recomputes corpus/manifest.json (sorted per-file SHA-256 pins) and the
 * corpus digest, writes corpus/corpus_digest.txt. The digest covers every
 * pinned file INCLUDING package.json.
 *
 * DOC-002: the separately trusted approval root is NEVER stored in the
 * candidate tree. The reviewer/CI supplies it via the DOC_APPROVED_ROOT
 * environment variable. After running this tool, record the printed
 * digest externally as the new trusted root; the scored entrypoints
 * (tests/run-tests.js, tests/run-battery.js) fail closed when the env
 * var is absent or does not match.
 *
 * Run after any corpus-affecting change, then record the new digest as
 * the reviewed root outside the tree.
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

// DOC-002: the digest covers EVERY pinned file including package.json.
// package.json no longer carries the approval root (self-carry circularity
// removed), so there is no exclusion. The separately trusted root is
// supplied by the reviewer/CI via the DOC_APPROVED_ROOT environment
// variable — never from the candidate tree. This tool only records the
// digest as the authoring record in corpus_digest.txt; the reviewer
// records the new digest externally as the trusted root.
const entries = files
  .map((p) => ({ path: p, sha256: sha(readFileSync(join(ROOT, p))) }));
entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
const canonical = JSON.stringify(entries);
const digest = sha(Buffer.from(canonical, "utf8"));

const manifest = {
  corpus_digest: digest,
  files: entries,
};
writeFileSync(join(ROOT, "corpus", "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(join(ROOT, "corpus", "corpus_digest.txt"), digest + "\n");
console.log(`corpus_digest: ${digest}`);
console.log(`pinned ${entries.length} files`);
