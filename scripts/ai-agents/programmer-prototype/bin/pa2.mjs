#!/usr/bin/env node
/**
 * pa2.mjs — CLI for the programmer-agent Phase 2 slice 1 prototype.
 * Dormant prototype tooling: no service, no lifecycle hook, no network.
 *
 *   pa2.mjs check-isolation
 *   pa2.mjs corpus-build --out <dir> [--seed <s>]
 *   pa2.mjs battery --corpus <dir> --mode validation|full --out <dir> [--limit N] [--class C] [--named]
 *   pa2.mjs propose --task <file> --corpus <dir> --out <dir>
 *   pa2.mjs evaluate --task <file> --corpus <dir> --out <dir> [--baseline PASS|FAIL|SKIP] [--candidate PASS|FAIL|SKIP]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROTO = path.resolve(HERE, "..");
const ORACLE_DIR = path.join(PROTO, "oracles");

const { probeIsolation } = await import(path.join(PROTO, "src", "isolation.mjs"));

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
function need(name) {
  const v = arg(name);
  if (!v) {
    console.error(`missing ${name}`);
    process.exit(2);
  }
  return v;
}

const cmd = process.argv[2];

if (cmd === "check-isolation") {
  const r = await probeIsolation();
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.available ? 0 : 1);
}

if (cmd === "corpus-build") {
  const { buildCorpus } = await import(path.join(PROTO, "src", "corpus.mjs"));
  const outDir = path.resolve(need("--out"));
  const seed = arg("--seed", undefined);
  const r = buildCorpus({ outDir, oracleDir: ORACLE_DIR, ...(seed ? { seed } : {}) });
  console.log(JSON.stringify({
    outDir: r.outDir,
    corpus_sha256: r.corpus_sha256,
    ticket_count: r.manifest.ticket_count,
    classes: r.manifest.classes,
    fixtures: Object.keys(r.manifest.fixtures),
  }, null, 2));
  process.exit(0);
}

if (cmd === "battery") {
  const { runBattery } = await import(path.join(PROTO, "src", "battery.mjs"));
  const corpusDir = path.resolve(need("--corpus"));
  const outDir = path.resolve(need("--out"));
  const mode = arg("--mode", "validation");
  if (!["validation", "full"].includes(mode)) {
    console.error("mode must be validation|full");
    process.exit(2);
  }
  const limit = arg("--limit");
  const { summary, mismatches } = await runBattery({
    corpusDir,
    mode,
    outDir,
    limit: limit ? parseInt(limit, 10) : null,
    onlyClass: arg("--class"),
    onlyNamed: process.argv.includes("--named"),
  });
  console.log(JSON.stringify(summary, null, 2));
  if (mismatches.length > 0) {
    console.log("MISMATCHES:");
    for (const m of mismatches.slice(0, 40)) {
      console.log(`  ${m.ticket_id} ${m.name || ""} [${m.class}] expected=${m.expected} actual=${m.actual}`);
    }
    if (mismatches.length > 40) console.log(`  ... and ${mismatches.length - 40} more`);
  }
  process.exit(mismatches.length === 0 ? 0 : 1);
}

function loadCorpus(corpusDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(corpusDir, "manifest.json"), "utf8"));
  return {
    manifest,
    reposRoot: path.join(corpusDir, "repos"),
    oracleDir: ORACLE_DIR,
  };
}

if (cmd === "propose" || cmd === "evaluate") {
  const { runTask } = await import(path.join(PROTO, "src", "evaluator.mjs"));
  const { buildTrustedConfig } = await import(path.join(PROTO, "src", "corpus.mjs"));
  const taskFile = path.resolve(need("--task"));
  const corpusDir = path.resolve(need("--corpus"));
  const outDir = path.resolve(need("--out"));
  const corpus = loadCorpus(corpusDir);
  const trusted = buildTrustedConfig(corpus.manifest, { output_root: path.join(outDir, "runs") });
  const taskJson = JSON.parse(fs.readFileSync(taskFile, "utf8"));
  let expectations = null;
  if (cmd === "evaluate") {
    const b = arg("--baseline");
    const c = arg("--candidate");
    if (b || c) expectations = { baseline: b || "SKIP", candidate: c || "SKIP", seed: 1 };
  }
  const result = await runTask({ taskJson, trusted, corpus, expectations, execute: cmd === "evaluate" });
  const outPath = path.join(outDir, `${taskJson.task_id || "result"}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({
    status: result.status,
    reason_codes: result.reason_codes,
    proposal_sha256: result.proposal_sha256,
    verification: result.verification,
    audit_ref: result.audit_ref,
    out: outPath,
  }, null, 2));
  process.exit(0);
}

console.error("unknown command. See the README.");
process.exit(2);
