/**
 * corpus/freeze.js — freeze the authenticated corpus (CI-006).
 *
 * Usage: node corpus/freeze.js   (run from the prototype root)
 *
 * Writes corpus/manifest.json: {files: {<path>: <sha256>}} over every
 * scored corpus file (src, tests, runner — INCLUDING src/trust.js: there is
 * no trust-anchor exemption; executable verifier code is authenticated like
 * everything else).
 *
 * Prints APPROVED_ROOT_DIGEST. That digest is TRUSTED HOST INPUT — it is
 * supplied to runner/launch.js via CI_APPROVED_ROOT_DIGEST (or --digest),
 * never embedded in the corpus. Re-run freeze.js after any corpus change
 * and update the host's stored digest.
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
        "Authenticated corpus: scorer + verifier (src, including trust.js), fixtures + expected oracles (tests), official runner (runner). No exemptions. The approved root digest is trusted HOST input (CI_APPROVED_ROOT_DIGEST), not corpus content. Re-run freeze.js after any corpus change and update the host digest.",
      files: map,
    },
    null,
    2,
  ) + "\n",
);

console.log(`files: ${files.length}`);
console.log(`APPROVED_ROOT_DIGEST=${sha(canonicalize(map))}`);
