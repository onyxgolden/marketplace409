#!/usr/bin/env node
/**
 * run-battery.js — `npm run battery`: verify the manifest, run all 200
 * frozen cases, and print the acceptance summary. Any manifest mismatch
 * stops the run before a single case executes.
 *
 * Bootstrap order (QAI-004): the verifier's own bytes are checked against
 * the pinned manifest entry BEFORE the harness module is imported or any
 * scored code runs.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 1. Pre-import check: tests/harness.js must match its pinned manifest entry.
{
  const manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  const entry = (manifest.files ?? []).find((e) => e.path === "tests/harness.js");
  const actual = createHash("sha256").update(readFileSync(join(ROOT, "tests", "harness.js"))).digest("hex");
  if (!entry || actual !== entry.sha256) {
    console.error("bootstrap: tests/harness.js does not match the pinned manifest entry — refusing to run");
    process.exit(3);
  }
}

// 2. Only now import the verified harness.
const { runBattery, acceptanceMetrics, verifyManifest } = await import(
  pathToFileURL(join(ROOT, "tests", "harness.js")).href
);

const verified = await verifyManifest(ROOT);
console.log(`verified corpus digest: ${verified.corpusDigest} (${verified.files} files pinned) — approved reviewed corpus`);
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
