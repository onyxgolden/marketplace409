#!/usr/bin/env node
/**
 * measure-latency.js — MANUAL latency/corpus-size measurement for the
 * knowledge-vault prototype. Manual runs only: not part of `npm test`
 * or `npm run battery`, and its numbers are not a production SLA.
 *
 * Runs all 120 frozen battery cases in-process, records per-case
 * latency, and reports median/p95 plus corpus size on this machine.
 *
 * Usage: node runner/measure-latency.js [out.json]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cpus, platform, arch, totalmem } from "node:os";
import { performance } from "node:perf_hooks";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = process.argv[2] ?? "/tmp/kv-latency.json";

const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
const vocabulary = JSON.parse(readFileSync(join(ROOT, "fixtures", "vocabulary.json"), "utf8"));
const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));

function buildContext(c) {
  const context = {
    clock: Date.parse(c.clock),
    vocabulary,
    sources: JSON.parse(JSON.stringify(store.sources)),
    readGrants: JSON.parse(JSON.stringify(store.readGrants)),
    stewards: store.stewards,
    registrations: store.registrations,
    supersessionRecords: store.supersessionRecords,
  };
  const ov = c.contextOverrides;
  if (ov) {
    if (ov.replaceSupersessionRecords) context.supersessionRecords = ov.replaceSupersessionRecords;
    if (ov.removeGrants) {
      context.readGrants = context.readGrants.filter((g) => !ov.removeGrants.includes(`${g.repo}|${g.path}`));
    }
  }
  return context;
}

const { run } = await import(pathToFileURL(join(ROOT, "src", "index.js")).href);

const latencies = [];
for (const c of battery) {
  const t0 = performance.now();
  run(c.task, buildContext(c));
  latencies.push({ case_id: c.case_id, ms: performance.now() - t0 });
}
latencies.sort((a, b) => a.ms - b.ms);
const ms = latencies.map((l) => l.ms);
const median = ms[Math.floor(ms.length / 2)];
const p95 = ms[Math.floor(ms.length * 0.95)];

let corpusBytes = 0;
for (const f of manifest.files) corpusBytes += f.path === "package.json" ? 0 : 0;
for (const p of ["corpus/battery.json", "fixtures/store.json", "fixtures/vocabulary.json", "corpus/manifest.json"]) {
  corpusBytes += readFileSync(join(ROOT, p)).length;
}

const report = {
  measured_at: new Date().toISOString(),
  machine: { platform: platform(), arch: arch(), cpus: cpus().length, cpu_model: cpus()[0]?.model ?? "unknown", totalmem_bytes: totalmem() },
  cases: battery.length,
  latency_ms: { median: Number(median.toFixed(3)), p95: Number(p95.toFixed(3)), max: Number(ms[ms.length - 1].toFixed(3)) },
  corpus_bytes: corpusBytes,
  note: "Manual measurement on the frozen 120-case battery; not a production SLA.",
};
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
