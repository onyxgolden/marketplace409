/**
 * verify-corpus.js — enforce the frozen corpus (DOM-005).
 *
 * Reads corpus/manifest.json (pinned sha256 of every fixture page, gold
 * labels, fixture generator and tokenizer asset) and corpus_digest.txt,
 * then verifies every pinned file on disk. Any missing file, hash
 * mismatch, or digest mismatch fails LOUD — a manifest on disk is not an
 * enforced freeze; THIS check is.
 *
 * Freezing is an explicit authoring step: `node corpus/freeze-corpus.js`.
 * This verifier never writes, never "accepts" drift.
 *
 * Usage: node corpus/verify-corpus.js   (exit 0 = frozen, exit 1 = drift)
 * Also importable: verifyCorpus(rootDir) -> { ok, failures[] }.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

export function verifyCorpus(rootDir) {
  const failures = [];
  const manifestPath = join(rootDir, "corpus", "manifest.json");
  const digestPath = join(rootDir, "corpus", "corpus_digest.txt");
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    return { ok: false, failures: [`cannot read corpus manifest: ${e.message}`] };
  }
  if (!manifest || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    return { ok: false, failures: ["corpus manifest has no pinned files"] };
  }
  for (const f of manifest.files) {
    const p = join(rootDir, f.path);
    if (!existsSync(p)) {
      failures.push(`missing pinned file: ${f.path}`);
      continue;
    }
    let h;
    try {
      h = sha256File(p);
    } catch (e) {
      failures.push(`cannot hash pinned file ${f.path}: ${e.message}`);
      continue;
    }
    if (h !== f.sha256) {
      failures.push(`hash mismatch (drift): ${f.path}`);
    }
  }
  let recorded = null;
  try {
    recorded = readFileSync(digestPath, "utf8").trim();
  } catch (e) {
    failures.push(`cannot read corpus digest: ${e.message}`);
  }
  if (recorded !== null) {
    const recomputed = createHash("sha256")
      .update(manifest.files.map(e => e.sha256).join("\n"), "utf8")
      .digest("hex");
    if (recomputed !== recorded) {
      failures.push("corpus digest does not match manifest (manifest tampered)");
    }
  }
  return { ok: failures.length === 0, failures };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const r = verifyCorpus(ROOT);
  if (r.ok) {
    console.log(`corpus frozen: ${r.failures.length === 0 ? "all pinned files verify" : ""}`);
  } else {
    console.log("CORPUS DRIFT DETECTED:");
    for (const f of r.failures) console.log("  - " + f);
    process.exit(1);
  }
}
