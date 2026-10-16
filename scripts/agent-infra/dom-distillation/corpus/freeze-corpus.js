/**
 * freeze-corpus.js — pin the frozen corpus: sha256 of every fixture page,
 * gold labels, fixture generator, and the vendored tokenizer asset.
 * Writes corpus/manifest.json and corpus/corpus_digest.txt.
 * Any later change to a pinned file changes the digest (fail-loud).
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

export function freezeCorpus(rootDir) {
  const files = [];
  for (const f of readdirSync(join(rootDir, "fixtures", "pages")).filter(f => f.endsWith(".json")).sort()) {
    files.push("fixtures/pages/" + f);
  }
  files.push("fixtures/gold.json");
  files.push("fixtures/make-fixtures.js");
  files.push("tokenizer/vocab.bpe");
  files.push("tokenizer/PIN.md");
  files.push("PAYLOAD.md");

  const manifest = {
    corpus: "dom-distillation-fixtures/1",
    files: files.map(f => ({ path: f, sha256: sha256File(join(rootDir, f)) })),
  };
  const digest = createHash("sha256")
    .update(manifest.files.map(e => e.sha256).join("\n"), "utf8")
    .digest("hex");

  writeFileSync(join(rootDir, "corpus", "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(rootDir, "corpus", "corpus_digest.txt"), digest + "\n");
  return { files: files.length, digest };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const r = freezeCorpus(ROOT);
  console.log(`frozen ${r.files} files, corpus digest ${r.digest}`);
}
