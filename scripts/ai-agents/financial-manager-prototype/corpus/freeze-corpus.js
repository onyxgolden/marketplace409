#!/usr/bin/env node
/**
 * freeze-corpus.js — AUTHORING TOOL (not part of the scored path).
 *
 * Recomputes corpus/manifest.json (sorted per-file SHA-256 pins) and the
 * corpus digest, writes corpus/corpus_digest.txt, and records the digest
 * as the separately trusted root in package.json's npm scripts (as
 * FM_APPROVED_ROOT). The digest covers every pinned file EXCEPT
 * package.json, which carries the root in its npm scripts (self-carry
 * circularity); package.json is still hash-pinned in the manifest.
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
  .filter((p) => p !== "package.json")
  .map((p) => ({ path: p, sha256: sha(readFileSync(join(ROOT, p))) }));
const canonical = JSON.stringify(preEntries);
const digest = sha(Buffer.from(canonical, "utf8"));

const pkgPath = join(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
for (const k of Object.keys(pkg.scripts ?? {})) {
  pkg.scripts[k] = pkg.scripts[k].replace(/FM_APPROVED_ROOT=[0-9a-f]{64}|FM_APPROVED_ROOT=__DIGEST__/, `FM_APPROVED_ROOT=${digest}`);
}
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

const entries = [...preEntries, { path: "package.json", sha256: sha(readFileSync(pkgPath)) }];
entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

writeFileSync(join(ROOT, "corpus", "manifest.json"), JSON.stringify({ corpus_digest: digest, files: entries }, null, 2) + "\n");
writeFileSync(join(ROOT, "corpus", "corpus_digest.txt"), digest + "\n");

console.log(`corpus digest: ${digest}`);
console.log(`files pinned: ${entries.length}`);
