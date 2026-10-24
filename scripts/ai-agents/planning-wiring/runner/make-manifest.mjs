/**
 * Regenerate runner/manifest.json: SHA-256 over every file in the
 * authenticated planning executable closure. The manifest format
 * matches the drop-owned trusted launcher's contract exactly:
 * `files` is an OBJECT keyed by wiring-root-relative paths
 * (wiring files like "src/runner.js"; repo files like
 * "../../../src/application/ai-lab/planning/jobContracts.js").
 * The launcher joins each key onto the wiring root and checks
 * containment against the repository root.
 *
 * The closure is listed explicitly — no globbing, no discovery: a
 * file not listed here is not part of the trusted closure, and a
 * listed file whose bytes changed fails verification before any
 * candidate byte runs.
 *
 * Run: node runner/make-manifest.mjs (from scripts/ai-agents/planning-wiring/)
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIRING = resolve(HERE, "..");
const ROOT = resolve(WIRING, "..", "..", "..");

export const CLOSURE_FILES = [
  // Planning runner closure (candidate code under test).
  "scripts/ai-agents/planning-wiring/src/runner.js",
  "scripts/ai-agents/planning-wiring/src/executeWorker.js",
  "scripts/ai-agents/planning-wiring/src/syntheticRepository.js",
  "scripts/ai-agents/planning-wiring/src/planningBudget.js",
  "scripts/ai-agents/planning-wiring/src/fixtures.js",
  // Planning application surface.
  "src/application/ai-lab/planning/jobContracts.js",
  "src/application/ai-lab/planning/fieldMappings.js",
  "src/application/ai-lab/planning/readProjection.js",
  "src/application/ai-lab/planning/snapshotBuilder.js",
  "src/application/ai-lab/planning/sourceMappings.js",
  "src/application/ai-lab/planning/schedulerAssessment.js",
  "src/application/ai-lab/planning/controlsEvidenceAssessment.js",
  "src/application/ai-lab/planning/privateItemSerializer.js",
  "src/application/ai-lab/planning/decisionValidator.js",
  // Shared P2a primitives (imported, not copied).
  "src/application/ai-lab/rental-ops/canonical.js",
  "src/application/ai-lab/rental-ops/budgets.js",
  "src/application/ai-lab/rental-ops/jobContracts.js",
  "scripts/ai-agents/rental-ops-wiring/src/deadline.js",
  // Worker-default chain (P677-003 guard discovery): deadline.js's
  // default workerUrl names the rental-ops-wiring worker, which
  // imports the maintenance/property evaluators and their helpers.
  // Official planning paths pass an explicit planning workerUrl, so
  // this chain does not execute there — but it is reachable from a
  // listed file, so it is pinned rather than left unauthenticated.
  "scripts/ai-agents/rental-ops-wiring/src/executeWorker.js",
  "scripts/ai-agents/rental-ops-wiring/src/syntheticRepository.js",
  "src/application/ai-lab/rental-ops/fieldMappings.js",
  "src/application/ai-lab/rental-ops/maintenanceManagerJob.js",
  "src/application/ai-lab/rental-ops/propertyManagerJob.js",
  "src/application/ai-lab/rental-ops/readAdapter.js",
  "src/application/ai-lab/rental-ops/snapshotBuilder.js",
  "src/application/rental/isChargeForgeCollectible.js",
  // Prototype math (imported single-sourced, never copied).
  "scripts/ai-agents/scheduler-prototype/src/scheduler.js",
  // Scheduler canonical helper, imported transitively by scheduler.js.
  // P677-003: it was reachable but unlisted — an unlisted nested
  // executable must never again ride the closure unauthenticated.
  "scripts/ai-agents/scheduler-prototype/src/canonical.js",
  // Battery + oracle (pinned so a tampered oracle cannot pass a broken candidate).
  "scripts/ai-agents/planning-wiring/battery/run-battery.js",
  "scripts/ai-agents/planning-wiring/battery/oracle.js",
  "scripts/ai-agents/planning-wiring/battery/cases.js",
  // Controls battery + oracle (P2b-2; same pinning rule).
  "scripts/ai-agents/planning-wiring/battery-controls/run-battery.js",
  "scripts/ai-agents/planning-wiring/battery-controls/oracle.js",
  "scripts/ai-agents/planning-wiring/battery-controls/cases.js",
  // Tests (discovered only from this manifest).
  "scripts/ai-agents/planning-wiring/tests/run-tests.js",
  // Verifier/runtime helper, statically imported by run-tests.js
  // before its own verification (P677-003: unlisted, it executed
  // unauthenticated — listed now so its bytes are pinned).
  "scripts/ai-agents/planning-wiring/runner/trust-entry.mjs",
  "scripts/ai-agents/planning-wiring/tests/runner.test.js",
  "scripts/ai-agents/planning-wiring/tests/synthetic.test.js",
  "scripts/ai-agents/planning-wiring/tests/controls.test.js",
  // Preview child (spawned only after authentication).
  "scripts/ai-agents/planning-wiring/preview/preview-child.mjs",
  "scripts/ai-agents/planning-wiring/preview/preview-controls-child.mjs",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Closure-completeness guard (P677-003): walk the static and
// dynamic-literal import graph from every listed file and refuse to
// write the manifest if any reached executable is unlisted. A
// manifest that omits a reachable file is a false "complete closure"
// claim: the omitted file's bytes would execute unauthenticated.
// Computed dynamic imports are out of the static walk's reach by
// construction and are covered separately: trust-entry's entry import
// resolves only to a manifest-listed entry (the launcher refuses an
// unlisted entry), and the preview children import drop-owned
// private-store.mjs, which is host code, not candidate code.
function closureCompletenessCheck(listedKeys) {
  const listed = new Set(listedKeys);
  const reached = new Set(listedKeys);
  const queue = [...listedKeys];
  const specPatterns = [
    /from\s+["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /new\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g,
  ];
  while (queue.length > 0) {
    const key = queue.shift();
    const abs = join(WIRING, key);
    if (!/\.(m?js)$/.test(abs)) continue;
    let text;
    try { text = readFileSync(abs, "utf8"); } catch { continue; }
    const specs = new Set();
    for (const re of specPatterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) specs.add(m[1]);
    }
    for (const spec of specs) {
      if (!spec.startsWith(".")) continue;
      const base = resolve(dirname(abs), spec);
      const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.json`, join(base, "index.js"), join(base, "index.mjs")];
      for (const cand of candidates) {
        let found = false;
        try { readFileSync(cand); found = true; } catch { /* not this candidate */ }
        if (!found) continue;
        if (!cand.startsWith(ROOT + "/")) continue;
        const candKey = relative(WIRING, cand);
        if (!reached.has(candKey)) { reached.add(candKey); queue.push(candKey); }
        break;
      }
    }
  }
  const unlisted = [...reached].filter((k) => !listed.has(k)).sort();
  if (unlisted.length > 0) {
    console.error("make-manifest: REFUSING to write an incomplete closure — reachable but unlisted:");
    for (const k of unlisted) console.error(`  ${k}`);
    process.exit(1);
  }
}

const files = {};
for (const repoPath of CLOSURE_FILES) {
  const abs = join(ROOT, repoPath);
  const wiringRel = relative(WIRING, abs);
  files[wiringRel] = sha256(readFileSync(abs));
}
closureCompletenessCheck(Object.keys(files));
const manifest = {
  schema_version: "planning-runner-manifest@1",
  note: "SHA-256 pins for the complete transitive planning executable closure: wiring sources, planning application modules, shared P2a primitives, prototype math, battery, tests, preview child. Re-pin with runner/make-manifest.mjs after source changes.",
  files,
};
writeFileSync(join(HERE, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote manifest.json: ${Object.keys(files).length} files`);
