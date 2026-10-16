/**
 * run-benchmark.js — reproducible benchmark: per-case token sizes, median
 * reduction across the frozen NORMAL cases, worst-case regression.
 *
 * Token counts use the pinned instrument (gpt2-bpe/1, see tokenizer/PIN.md)
 * on both sides:
 *   baseline = canonical JSON of the full snapshot (what a model would
 *              receive without distillation)
 *   payload  = distilled_text ONLY (see PAYLOAD.md — the reference map and
 *              source envelope are host-side and never sent)
 *
 * DOM-005 adoption gate (ALL required, none silently skippable):
 *   1. the corpus freeze verifies (pinned file hashes match the manifest);
 *   2. the gold battery passes 100% IN THIS PROCESS (failures are consumed,
 *      never assumed — the old script merely asserted it had been run);
 *   3. EVERY expected normal fixture from the frozen manifest distills OK —
 *      missing or non-OK normal cases are gate failures, never filtered
 *      out of the measured population;
 *   4. median token reduction >= 35% across those normal cases.
 * If any gate fails the script reports NO ADOPTION and exits 1 — the gate
 * is never weakened, and "all gold checks green" is printed only when the
 * battery actually passed in this run.
 *
 * Determinism: the script distills every fixture 3 times and asserts
 * byte-identical output before measuring.
 *
 * Usage: node benchmark/run-benchmark.js [--json]   (exit 0 = gate pass)
 * Also importable: runBenchmark(rootDir, { quiet }) -> { gate_pass, ... }.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { distillSnapshot, payloadTokens } from "../src/index.js";
import { tokenizerInfo } from "../src/tokenizer.js";
import { sha256HexString } from "../src/canonical.js";
import { runBattery } from "../tests/run-battery.js";
import { verifyCorpus } from "../corpus/verify-corpus.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(HERE, "..");

export const GATE_MEDIAN_TARGET_PCT = 35;

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function expectedPages(rootDir) {
  const manifest = JSON.parse(readFileSync(join(rootDir, "corpus", "manifest.json"), "utf8"));
  return manifest.files
    .map(f => f.path)
    .filter(p => p.startsWith("fixtures/pages/") && p.endsWith(".json"))
    .map(p => p.slice("fixtures/pages/".length, -".json".length))
    .sort();
}

export function runBenchmark(rootDir = DEFAULT_ROOT, opts = {}) {
  const quiet = !!opts.quiet;
  const PAGES = join(rootDir, "fixtures", "pages");
  const failures = [];
  const log = (...a) => { if (!quiet) console.log(...a); };

  // Gate 1: frozen corpus — pinned identities verified before evaluation.
  const corpus = verifyCorpus(rootDir);
  if (!corpus.ok) {
    failures.push("corpus freeze verification failed: " + corpus.failures.join("; "));
  }

  // Gate 2: gold battery, run IN this process and consumed (never assumed).
  let battery = null;
  if (failures.length === 0) {
    battery = runBattery(rootDir, { quiet: true });
    if (battery.fail > 0) {
      failures.push(`gold battery failed: ${battery.fail} failing assertions`);
      for (const f of battery.failures.slice(0, 8)) failures.push("  battery: " + f);
    }
  }

  // Per-fixture distillation over the MANIFEST-expected set (not readdir —
  // a missing fixture is a gate failure, not an absent data point).
  const cases = [];
  let expected = [];
  if (failures.length === 0) {
    expected = expectedPages(rootDir);
    for (const id of expected) {
      const p = join(PAGES, id + ".json");
      if (!existsSync(p)) {
        failures.push(`expected fixture missing from disk: ${id}`);
        continue;
      }
      const snapshot = JSON.parse(readFileSync(p, "utf8"));
      const kind = id.startsWith("n") ? "normal" : "adverse";

      // Determinism: 3 runs, byte-identical distilled output + map.
      const runs = [0, 1, 2].map(() => {
        const o = distillSnapshot(snapshot);
        return sha256HexString(o.distilled_text || "") + sha256HexString(JSON.stringify(o.reference_map));
      });
      if (!(runs[0] === runs[1] && runs[1] === runs[2])) {
        failures.push(`NON-DETERMINISTIC: ${id}`);
        continue;
      }

      const out = distillSnapshot(snapshot);
      cases.push({
        fixture: id,
        kind,
        status: out.status,
        reason: out.reason || null,
        baseline_tokens: out.baseline_tokens ?? null,
        // PAYLOAD.md: the model-bound payload is distilled_text only.
        output_tokens: out.status === "OK" ? payloadTokens(out) : null,
        reduction_pct: out.status === "OK"
          ? +(100 * (1 - payloadTokens(out) / out.baseline_tokens)).toFixed(1)
          : null,
      });
    }
  }

  // Gate 3: EVERY expected normal fixture must distill OK — no filtering.
  const normalIds = expected.filter(id => id.startsWith("n"));
  const normalCases = [];
  for (const id of normalIds) {
    const c = cases.find(x => x.fixture === id);
    if (!c) {
      failures.push(`normal case ${id}: missing result`);
    } else if (c.status !== "OK") {
      failures.push(`normal case ${id}: status ${c.status} (${c.reason}) — not filtered, gate fails`);
    } else {
      normalCases.push(c);
    }
  }

  // Gate 4: savings threshold on the full normal population.
  const reductions = normalCases.map(c => c.reduction_pct);
  const med = reductions.length ? median(reductions) : NaN;
  const worst = reductions.length ? Math.min(...reductions) : NaN;
  const worstCase = normalCases.find(c => c.reduction_pct === worst);
  if (failures.length === 0 && !(med >= GATE_MEDIAN_TARGET_PCT)) {
    failures.push(`median reduction ${med}% misses the ${GATE_MEDIAN_TARGET_PCT}% target`);
  }

  const gate_pass = failures.length === 0;
  const report = {
    tokenizer: tokenizerInfo().id,
    distiller: "dom-distill/1",
    model_bound_payload: "distilled_text only (reference_map + source envelope are host-side; see PAYLOAD.md)",
    fixtures_expected: expected.length,
    normal_cases_measured: normalCases.length,
    normal_cases_expected: normalIds.length,
    battery_assertions_passed: battery ? battery.pass : null,
    battery_assertions_failed: battery ? battery.fail : null,
    median_reduction_pct: reductions.length ? +med.toFixed(1) : null,
    worst_case: worstCase ? { fixture: worstCase.fixture, reduction_pct: worstCase.reduction_pct } : null,
    min_reduction_pct: reductions.length ? +worst.toFixed(1) : null,
    worst_case_regression: reductions.length ? worst < 0 : null,
    gate_median_target_pct: GATE_MEDIAN_TARGET_PCT,
    gate_pass,
    failures: gate_pass ? [] : failures,
    per_case: cases,
  };

  if (!quiet) {
    log(`tokenizer: ${report.tokenizer} | distiller: ${report.distiller}`);
    log(`payload measured: ${report.model_bound_payload}`);
    log(`fixtures: ${report.fixtures_expected} (${report.normal_cases_measured}/${report.normal_cases_expected} normal OK)`);
    if (reductions.length) {
      log(`median reduction (normal): ${report.median_reduction_pct}%  (gate: >=${GATE_MEDIAN_TARGET_PCT}% -> ${gate_pass ? "PASS" : "FAIL"})`);
      log(`worst normal case: ${report.worst_case.fixture} at ${report.worst_case.reduction_pct}%` +
        (report.worst_case_regression ? "  <-- WORST-CASE REGRESSION (payload grew)" : ""));
    }
    log("");
    log("per-case:");
    for (const c of cases) {
      const size = c.status === "OK"
        ? `${c.baseline_tokens} -> ${c.output_tokens} tok (${c.reduction_pct}%)${c.reduction_pct < 0 ? " REGRESSION" : ""}`
        : `${c.status}${c.reason ? `/${c.reason}` : ""}`;
      log(`  ${c.kind === "normal" ? "N" : "A"} ${c.fixture}: ${size}`);
    }
  }

  if (!gate_pass) {
    if (!quiet) {
      log("\nNO ADOPTION:");
      for (const f of failures) log("  - " + f);
    }
    return { ...report, exit_code: 1 };
  }
  // Printed ONLY when the battery truly passed in this run (DOM-005).
  if (!quiet) {
    log(`\nGate PASS: median reduction meets the ${GATE_MEDIAN_TARGET_PCT}% target with all gold checks green ` +
      `(${battery.pass}/${battery.pass + battery.fail} battery assertions in-process).`);
  }
  return { ...report, exit_code: 0 };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const asJson = process.argv.includes("--json");
  const r = runBenchmark(DEFAULT_ROOT);
  if (asJson) console.log(JSON.stringify(r, null, 2));
  process.exit(r.exit_code);
}
