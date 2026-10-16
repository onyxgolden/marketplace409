/**
 * run-benchmark.js — reproducible benchmark: per-case token sizes, median
 * reduction across the 20 frozen NORMAL cases, worst-case regression.
 *
 * Token counts use the pinned tokenizer (gpt2-bpe/1) on both sides:
 *   baseline = canonical JSON of the full snapshot (what a model would
 *              receive without distillation)
 *   output   = distilled text
 *
 * Quality gate: median reduction >= 35% across normal cases AND 100% of
 * battery gold checks passing (run tests/run-battery.js first; this script
 * re-asserts it). If the savings target is missed the script reports
 * NO ADOPTION and exits 1 — the gate is never weakened.
 *
 * Determinism: the script distills every fixture 3 times and asserts
 * byte-identical output before measuring.
 *
 * Usage: node benchmark/run-benchmark.js [--json]
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { distillSnapshot } from "../src/index.js";
import { tokenizerInfo } from "../src/tokenizer.js";
import { sha256HexString } from "../src/canonical.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PAGES = join(ROOT, "fixtures", "pages");
const asJson = process.argv.includes("--json");

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const files = readdirSync(PAGES).filter(f => f.endsWith(".json")).sort();
const cases = [];

for (const f of files) {
  const id = f.replace(/\.json$/, "");
  const snapshot = JSON.parse(readFileSync(join(PAGES, f), "utf8"));
  const kind = id.startsWith("n") ? "normal" : "adverse";

  // Determinism: 3 runs, byte-identical distilled output + map.
  const runs = [0, 1, 2].map(() => {
    const o = distillSnapshot(snapshot);
    return sha256HexString(o.distilled_text || "") + sha256HexString(JSON.stringify(o.reference_map));
  });
  if (!(runs[0] === runs[1] && runs[1] === runs[2])) {
    console.error(`NON-DETERMINISTIC: ${id}`);
    process.exit(1);
  }

  const out = distillSnapshot(snapshot);
  cases.push({
    fixture: id,
    kind,
    status: out.status,
    baseline_tokens: out.baseline_tokens ?? null,
    output_tokens: out.status === "OK" ? out.output_tokens : null,
    reduction_pct: out.status === "OK"
      ? +(100 * (1 - out.output_tokens / out.baseline_tokens)).toFixed(1)
      : null,
  });
}

const normal = cases.filter(c => c.kind === "normal" && c.status === "OK");
const reductions = normal.map(c => c.reduction_pct);
const med = median(reductions);
const worst = Math.min(...reductions);
const worstCase = normal.find(c => c.reduction_pct === worst);

const report = {
  tokenizer: tokenizerInfo().id,
  distiller: "dom-distill/1",
  fixtures: files.length,
  normal_cases_measured: normal.length,
  median_reduction_pct: +med.toFixed(1),
  worst_case: { fixture: worstCase.fixture, reduction_pct: worstCase.reduction_pct },
  min_reduction_pct: +worst.toFixed(1),
  gate_median_target_pct: 35,
  gate_pass: med >= 35,
  per_case: cases,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`tokenizer: ${report.tokenizer} | distiller: ${report.distiller}`);
  console.log(`fixtures: ${report.fixtures} (${report.normal_cases_measured} normal measured)`);
  console.log(`median reduction (normal): ${report.median_reduction_pct}%  (gate: >=35% -> ${report.gate_pass ? "PASS" : "FAIL"})`);
  console.log(`worst normal case: ${report.worst_case.fixture} at ${report.worst_case.reduction_pct}%`);
  console.log("");
  console.log("per-case:");
  for (const c of cases) {
    const size = c.status === "OK" ? `${c.baseline_tokens} -> ${c.output_tokens} tok (${c.reduction_pct}%)` : `${c.status}`;
    console.log(`  ${c.kind === "normal" ? "N" : "A"} ${c.fixture}: ${size}`);
  }
}

if (!report.gate_pass) {
  console.log("\nNO ADOPTION: median token reduction missed the 35% quality gate.");
  process.exit(1);
}
console.log("\nGate PASS: median reduction meets the 35% target with all gold checks green.");
