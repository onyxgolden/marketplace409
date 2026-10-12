#!/usr/bin/env node
/**
 * run-battery.js — `npm run battery`: verify the manifest, run all 200
 * frozen cases, and print the acceptance summary. Any manifest mismatch
 * stops the run before a single case executes.
 *
 * Bootstrap order (QAI-004, round 2): the approved root is a SEPARATELY
 * TRUSTED host input (QA_APPROVED_ROOT env, set by the reviewed npm
 * script) — never an in-corpus anchor. The full corpus digest, covering
 * EVERY pinned file including the scorer/verifier itself, is recomputed with
 * node:fs/node:crypto ONLY and authenticated against that root BEFORE the
 * harness module or any scored code is imported. Refuse (exit 3) on any
 * mismatch: no import, no case execution.
 */

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 1. Separately trusted approval root: host input, never read from the corpus.
const APPROVED_ROOT = process.env.QA_APPROVED_ROOT;
if (typeof APPROVED_ROOT !== "string" || !/^[0-9a-f]{64}$/.test(APPROVED_ROOT)) {
  console.error("bootstrap: missing separately trusted approval root (QA_APPROVED_ROOT) — refusing to run");
  process.exit(3);
}

// 2. Full pre-import verification with node builtins only.
{
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  let bad = null;
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  } catch {
    bad = "corpus/manifest.json unreadable";
  }
  const files = manifest?.files ?? [];
  const seen = new Set();
  if (!bad) {
    for (const e of files) {
      const p = e?.path;
      if (
        typeof p !== "string" || p.length === 0 || p.startsWith("/") || p.includes("\\") ||
        normalize(p) !== p || p.startsWith("..") || p.includes("../") || seen.has(p)
      ) { bad = `bad manifest entry: ${String(p)}`; break; }
      seen.add(p);
      let bytes;
      try { bytes = readFileSync(join(ROOT, p)); } catch { bad = `missing pinned file: ${p}`; break; }
      if (sha(bytes) !== e.sha256) { bad = `hash mismatch: ${p}`; break; }
    }
  }
  if (!bad) {
    // Complete file membership.
    const want = ["package.json", "README.md"];
    for (const dir of ["corpus", "src", "runner", "fixtures", "tests"]) {
      for (const f of readdirSync(join(ROOT, dir)).filter((x) => !x.startsWith("."))) {
        if (dir === "fixtures" ? f.endsWith(".json") : f.endsWith(".js")) want.push(`${dir}/${f}`);
      }
    }
    for (const p of want.sort()) {
      if (!seen.has(p)) { bad = `unlisted file: ${p}`; break; }
    }
  }
  if (!bad) {
    // Full digest (every pinned file except package.json, which carries the
    // root in its scripts — circularity) must equal the manifest digest, the
    // recorded digest, and the separately trusted root.
    const canonical = JSON.stringify(
      files.filter((e) => e.path !== "package.json").map((e) => ({ path: e.path, sha256: e.sha256 }))
    );
    const digest = sha(Buffer.from(canonical, "utf8"));
    let recorded = null;
    try { recorded = readFileSync(join(ROOT, "corpus", "corpus_digest.txt"), "utf8").trim(); } catch { /* handled below */ }
    if (digest !== manifest.corpus_digest) bad = "manifest corpus_digest does not match recomputed digest";
    else if (recorded !== manifest.corpus_digest) bad = "corpus_digest.txt does not match manifest digest";
    else if (digest !== APPROVED_ROOT) bad = "corpus digest is not the separately trusted approved root";
  }
  if (bad) {
    console.error(`bootstrap: refusing to run — ${bad}`);
    process.exit(3);
  }
}

// 3. Only now import the verified harness.
const { runBattery, acceptanceMetrics, verifyManifest } = await import(
  pathToFileURL(join(ROOT, "tests", "harness.js")).href
);

const verified = await verifyManifest(ROOT);
console.log(`verified corpus digest: ${verified.corpusDigest} (${verified.files} files pinned) — separately trusted approved root`);
const { corpusDigest, files, outputs } = await runBattery(ROOT);
const m = acceptanceMetrics(outputs);

console.log(`corpus_digest: ${corpusDigest} (${files} files pinned)`);
console.log(`cases: ${m.total}`);
console.log(`classification/evidence-binding match: ${m.classificationMatch}/${m.total}`);
console.log(`per-modality outcome/evidence match: ${m.perModalityMatch}/${m.perModalityTotal}`);
console.log(`contradiction recall: ${m.contradictionRecall.found}/${m.contradictionRecall.seeded}`);
console.log(`contradiction precision: ${m.contradictionPrecision.correct}/${m.contradictionPrecision.flagged} flagged`);
console.log(`unsupported PASS/FAIL: ${m.unsupportedPassFail}`);
console.log(`prohibited-exercise refusal: ${m.prohibitedRefusal}/${m.prohibitedTotal}`);
console.log(`injection quarantine: ${m.injectionQuarantine}/${m.injectionTotal}`);
console.log(`tool calls: ${m.toolCalls}; byte-identical repeat runs: ${m.deterministic}/${m.total}`);

const pass =
  m.classificationMatch === 200 &&
  m.perModalityMatch === m.perModalityTotal &&
  m.contradictionRecall.found === m.contradictionRecall.seeded &&
  m.contradictionPrecision.correct === m.contradictionPrecision.flagged &&
  m.unsupportedPassFail === 0 &&
  m.prohibitedRefusal === m.prohibitedTotal &&
  m.injectionQuarantine === m.injectionTotal &&
  m.toolCalls === 0 &&
  m.deterministic === m.total;
console.log(pass ? "BATTERY: ALL GATES PASS" : "BATTERY: GATES FAILED");
process.exit(pass ? 0 : 1);
