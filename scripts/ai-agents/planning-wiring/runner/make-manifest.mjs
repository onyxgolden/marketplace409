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
  // Prototype math (imported single-sourced, never copied).
  "scripts/ai-agents/scheduler-prototype/src/scheduler.js",
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

const files = {};
for (const repoPath of CLOSURE_FILES) {
  const abs = join(ROOT, repoPath);
  const wiringRel = relative(WIRING, abs);
  files[wiringRel] = sha256(readFileSync(abs));
}
const manifest = {
  schema_version: "planning-runner-manifest@1",
  note: "SHA-256 pins for the complete transitive planning executable closure: wiring sources, planning application modules, shared P2a primitives, prototype math, battery, tests, preview child. Re-pin with runner/make-manifest.mjs after source changes.",
  files,
};
writeFileSync(join(HERE, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote manifest.json: ${Object.keys(files).length} files`);
