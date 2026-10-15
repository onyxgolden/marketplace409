#!/usr/bin/env node
/**
 * freeze-corpus.js — AUTHORING TOOL (not part of the scored path).
 *
 * Recomputes corpus/manifest.json (sorted per-file SHA-256 pins) and the
 * corpus digest, and writes corpus/corpus_digest.txt.
 *
 * PM-003: the digest is NO LONGER recorded in package.json's npm
 * scripts. The separately trusted approval root is a reviewer/host
 * input (PM_APPROVED_ROOT env) supplied on the command line:
 *   PM_APPROVED_ROOT=$(cat corpus/corpus_digest.txt) npm test
 * The launchers fail closed (exit 3) when the root is absent. The
 * digest covers every pinned file EXCEPT package.json (self-carry
 * circularity); package.json is still hash-pinned in the manifest.
 *
 * Run after any corpus-affecting change, then communicate the new
 * digest as the reviewed root through the normal review channel.
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

// The digest covers every pinned file EXCEPT package.json (self-carry
// circularity). Compute the digest, then hash package.json for its
// manifest pin, so the pin matches the file the verifier will read.
// PM-003: the digest is NOT written into package.json; it travels to
// reviewers through the normal review channel as PM_APPROVED_ROOT.
const preEntries = files
  .filter((p) => p !== "package.json")
  .map((p) => ({ path: p, sha256: sha(readFileSync(join(ROOT, p))) }));
const canonical = JSON.stringify(preEntries);
const digest = sha(Buffer.from(canonical, "utf8"));

const pkgPath = join(ROOT, "package.json");
const entries = [...preEntries, { path: "package.json", sha256: sha(readFileSync(pkgPath)) }];
entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

const manifest = {
  manifest_version: 1,
  agent: "property-manager",
  corpus_digest: digest,
  files: entries,
};
writeFileSync(join(ROOT, "corpus", "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(join(ROOT, "corpus", "corpus_digest.txt"), digest + "\n");
console.log(`frozen: corpus_digest=${digest} (${entries.length} pinned files)`);
