/**
 * freeze-corpus.js — pins the frozen corpus.
 *
 * Recomputes SHA-256 over every pinned file (src, tests, runner,
 * fixtures, corpus generators/data, README, package.json), writes
 * corpus/manifest.json and corpus/corpus_digest.txt, and stamps the
 * separately trusted GOV_APPROVED_ROOT into package.json's test/battery
 * scripts. Re-running is the authoring step; the digest becomes the
 * frozen trust root.
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
files.sort();

// Digest covers everything except package.json (whose scripts carry the root).
const digestFiles = files;
const canonical = JSON.stringify(
  digestFiles.map((p) => ({ path: p, sha256: sha(readFileSync(join(ROOT, p))) }))
);
const digest = sha(Buffer.from(canonical, "utf8"));

// Stamp the frozen root into the npm scripts as the separately trusted root,
// then pin package.json itself.
const pkgPath = join(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.scripts.test = `GOV_APPROVED_ROOT=${digest} node tests/run-tests.js`;
pkg.scripts.battery = `GOV_APPROVED_ROOT=${digest} node tests/run-battery.js`;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

const entries = [
  { path: "package.json", sha256: sha(readFileSync(pkgPath)) },
  ...digestFiles.map((p) => ({ path: p, sha256: sha(readFileSync(join(ROOT, p))) })),
];
writeFileSync(join(ROOT, "corpus", "manifest.json"), JSON.stringify({ corpus_digest: digest, files: entries }, null, 2) + "\n");
writeFileSync(join(ROOT, "corpus", "corpus_digest.txt"), digest + "\n");

console.log(`frozen corpus_digest=${digest} over ${entries.length} files`);
