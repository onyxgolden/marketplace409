#!/usr/bin/env node
/**
 * measure-latency.js — manual latency/corpus-size measurement for the
 * documentation prototype. Manual runs only; no production SLA is
 * claimed or implied.
 *
 * Usage: node runner/measure-latency.js [/tmp/doc-latency.json]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = process.argv[2] ?? "/tmp/doc-latency.json";

const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
const grants = Object.keys(store.sources).map((k) => {
  const [repo, path] = k.split("|");
  return { repo, path };
});

const samples = [0, 40, 80, 120, 160, 199].map((i) => battery[i]);
const timings = [];
for (const c of samples) {
  const context = { clock: Date.parse(c.clock), store, readGrants: grants };
  const t0 = process.hrtime.bigint();
  run(JSON.parse(JSON.stringify(c.task)), context);
  const t1 = process.hrtime.bigint();
  timings.push({ case_id: c.case_id, ms: Number(t1 - t0) / 1e6 });
}
const ms = timings.map((t) => t.ms).sort((a, b) => a - b);
const report = {
  measured_at: new Date().toISOString(),
  cases: battery.length,
  fixture_sources: Object.keys(store.sources).length,
  samples: timings,
  p50_ms: ms[Math.floor(ms.length / 2)],
  max_ms: ms[ms.length - 1],
  note: "Manual measurement only; no production SLA claimed or implied.",
};
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
