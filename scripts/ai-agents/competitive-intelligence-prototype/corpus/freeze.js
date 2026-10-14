/**
 * corpus/freeze.js — freeze the authenticated corpus (CI-006).
 *
 * Usage: node corpus/freeze.js   (run from the prototype root)
 *
 * Writes corpus/manifest.json: {files: {<path>: <sha256>}} over every
 * scored corpus file (src minus the trust anchor, tests, runner).
 * Prints APPROVED_ROOT_DIGEST — embed it in src/trust.js, then re-run the
 * full test battery. trust.js itself is the trust anchor and is excluded
 * from the manifest by design.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

function canonicalize(v) {
  const isObj = (x) => typeof x === "object" && x !== null && !Array.isArray(x);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  if (isObj(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

const files = [];
for (const dir of ["src", "tests", "runner"]) {
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".js")) continue;
    if (dir === "src" && f === "trust.js") continue; // trust anchor, not authenticated content
    files.push(`${dir}/${f}`);
  }
}
files.sort();

const map = {};
for (const p of files) {
  map[p] = sha(readFileSync(p, "utf8"));
}

writeFileSync(
  "corpus/manifest.json",
  JSON.stringify(
    {
      frozen_note:
        "Authenticated corpus: scorer (src), fixtures + expected oracles (tests), official runner (runner). trust.js is the trust anchor and is intentionally excluded. Re-run freeze.js after any corpus change and re-embed the root digest in src/trust.js.",
      files: map,
    },
    null,
    2,
  ) + "\n",
);

console.log(`files: ${files.length}`);
console.log(`APPROVED_ROOT_DIGEST=${sha(canonicalize(map))}`);
