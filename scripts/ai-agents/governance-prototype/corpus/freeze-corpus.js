/**
 * freeze-corpus.js — pins the frozen corpus.
 *
 * Recomputes SHA-256 over every pinned file (src, tests, runner,
 * fixtures, corpus generators/data, README, package.json), writes
 * corpus/manifest.json and corpus/corpus_digest.txt, and PRINTS the
 * digest. The digest is the trust root, but it is NEVER written into
 * the candidate tree: the reviewer/CI supplies it as the external
 * GOV_APPROVED_ROOT host input when running tests. Re-running is the
 * authoring step; the printed digest becomes the frozen trust root
 * that the reviewer pins in CI configuration outside this tree.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sha = (b) => createHash("sha256").update(b).digest("hex");

const files = [];
for (const dir of ["corpus", "src", "runner", "fixtures", "tests"]) {
  for (const f of readdirSync(join(ROOT, dir)).filter((x) => !x.startsWith("."))) {
    const p = `${dir}/${f}`;
    if (p === "corpus/manifest.json" || p === "corpus/corpus_digest.txt") continue;
    if (dir === "fixtures" || dir === "corpus") {
      if (!(f.endsWith(".json") || f.endsWith(".js"))) continue;
    } else if (!f.endsWith(".js")) continue;
    files.push(p);
  }
}
files.push("README.md");
files.push("package.json");
files.sort();

// Digest covers every pinned file INCLUDING package.json. Its scripts no
// longer carry the trust root (GOV-001), so it is a stable pinned file.
// package.json is normalized to plain scripts BEFORE hashing.

// The trust root is NEVER stamped into the candidate tree (GOV-001).
// Plain scripts only; the reviewer/CI supplies GOV_APPROVED_ROOT as an
// external host input. package.json itself is pinned in the manifest.
const pkgPath = join(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.scripts.test = "node tests/run-tests.js";
pkg.scripts.battery = "node tests/run-battery.js";
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

const entries = files.map((p) => ({ path: p, sha256: sha(readFileSync(join(ROOT, p))) }));
const digest = sha(Buffer.from(JSON.stringify(entries), "utf8"));
writeFileSync(join(ROOT, "corpus", "manifest.json"), JSON.stringify({ corpus_digest: digest, files: entries }, null, 2) + "\n");
writeFileSync(join(ROOT, "corpus", "corpus_digest.txt"), digest + "\n");

console.log(`frozen corpus_digest=${digest} over ${entries.length} files`);
console.log("TRUST ROOT (pin in CI/reviewer config OUTSIDE this tree, never in the repo):");
console.log(`GOV_APPROVED_ROOT=${digest}`);
