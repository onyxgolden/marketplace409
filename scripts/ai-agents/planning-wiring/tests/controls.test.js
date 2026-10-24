/**
 * P2b-2 Project Controls wiring node:test suite. Runs through the
 * full inert runner (not the units): DISABLED zero-access, controls
 * scope mismatch, the canonical controls happy path, the
 * cost-field canary (financial fields are never admitted, so their
 * VALUES can never appear in a published item), ACTIVATION_REQUIRED
 * for live shapes, and the dataset-isolation proof (a Controls run
 * touches only the three controls datasets — never a scheduling
 * dataset). The battery-controls suite (97 cases) is the
 * exhaustive proof; these tests are the readable regression net.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryPublisher, runJob } from "../src/runner.js";
import {
  CANONICAL_CONTROLS, CANONICAL_CONTROLS_AS_OF, CANONICAL_CONTROLS_HOST, CANONICAL_HOST,
  canonicalControlsRequest, canonicalControlsSpec, canonicalRequest, canonicalSpec,
} from "../src/fixtures.js";

const clock = { nowIso: () => CANONICAL_CONTROLS_AS_OF };

async function runControlsWith(mutator) {
  const datasets = structuredClone(CANONICAL_CONTROLS);
  mutator(datasets);
  const publisher = createMemoryPublisher();
  const result = await runJob({
    hostConfig: CANONICAL_CONTROLS_HOST, request: canonicalControlsRequest(),
    adapterSpec: { kind: "synthetic", datasets, faults: {}, authorized_global_calendar_refs: [] },
    publisher, clock,
  });
  assert.equal(result.outcome, "COMPLETED");
  return result.item.report;
}

function pkgA(report) {
  return report.sections.packages.rows.find((p) => p.package_ref === "PKG-A");
}

function integrityKind(report, kind) {
  return report.sections.integrity.rows.find((r) => r.kind === kind);
}

test("DISABLED controls run returns before any adapter access", async () => {
  const publisher = createMemoryPublisher();
  const result = await runJob({
    hostConfig: { ...CANONICAL_CONTROLS_HOST, mode: "DISABLED" },
    request: canonicalControlsRequest(), adapterSpec: canonicalControlsSpec(), publisher, clock,
  });
  assert.equal(result.outcome, "DISABLED");
  assert.deepEqual(result.counters, {
    adapter_opens: 0, adapter_calls: 0, credential_reads: 0, network_calls: 0, store_writes: 0,
  });
  assert.equal(publisher.items.size, 0);
});

test("controls kind with a scheduling-project scope refuses SCOPE_TYPE_MISMATCH", async () => {
  const result = await runJob({
    hostConfig: CANONICAL_HOST,
    request: { ...canonicalRequest(), job_kind: "project-controls-evidence-review", window: { name: "planning-latest-through-asof" } },
    adapterSpec: canonicalSpec(), publisher: createMemoryPublisher(), clock,
  });
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.code, "SCOPE_TYPE_MISMATCH");
});

test("canonical controls run completes and publishes a DRAFT ctl- item", async () => {
  const publisher = createMemoryPublisher();
  const result = await runJob({
    hostConfig: CANONICAL_CONTROLS_HOST, request: canonicalControlsRequest(),
    adapterSpec: canonicalControlsSpec(), publisher, clock,
  });
  assert.equal(result.outcome, "COMPLETED");
  assert.equal(result.report_status, "DRAFT");
  assert.equal(result.item.report.execution_authorized, false);
  assert.equal(result.item.report.agent, "project-controls");
  assert.ok(result.item_id.startsWith("ctl-"), `item id ${result.item_id} must carry the controls prefix`);
  assert.equal(result.item.title, "Project controls evidence review — 2026-10-26");
  const packages = result.item.report.sections.packages.rows;
  assert.deepEqual(packages.map((p) => p.package_ref), ["PKG-A", "PKG-B"]);
  assert.deepEqual(packages.map((p) => p.conclusion), ["READY", "READY"]);
  assert.equal(packages[0].latest_snapshot_ref, "S-A2");
  assert.equal(packages[0].named_baseline.version_number, 2);
  assert.equal(packages[0].current_baseline.version_number, 2);
  assert.equal(packages[0].baseline_changed, false);
  assert.equal(packages[1].scope_baseline_resolved, false);
  const financial = result.item.report.sections.financial;
  for (const field of ["planned_value", "earned_value", "actual_cost", "cpi", "spi", "monetary_variance", "eac", "etc", "contingency"]) {
    assert.equal(financial[field], "NOT_MODELED", `financial field ${field} must be NOT_MODELED`);
  }
  assert.equal(financial.scope, "FINANCIAL_SCOPE_EXCLUDED");
  assert.equal(publisher.items.size, 1);
});

test("controls run touches only the three controls datasets", async () => {
  const result = await runJob({
    hostConfig: CANONICAL_CONTROLS_HOST, request: canonicalControlsRequest(),
    adapterSpec: canonicalControlsSpec(), publisher: createMemoryPublisher(), clock,
  });
  assert.equal(result.outcome, "COMPLETED");
  assert.deepEqual(result.adapter_datasets, [
    "forge_work_packages", "forge_work_package_baselines", "forge_work_progress_snapshots",
  ]);
});

test("cost-field canary: financial values on controls rows never reach a published item", async () => {
  const spec = canonicalControlsSpec();
  const datasets = JSON.parse(JSON.stringify(spec.datasets));
  datasets.forge_work_package_baselines[0].baseline_cost = 424242;
  datasets.forge_work_progress_snapshots[0].earned_cost = 424243;
  datasets.forge_work_progress_snapshots[0].etc_hours = 424244;
  spec.datasets = datasets;
  const result = await runJob({
    hostConfig: CANONICAL_CONTROLS_HOST, request: canonicalControlsRequest(),
    adapterSpec: spec, publisher: createMemoryPublisher(), clock,
  });
  assert.equal(result.outcome, "COMPLETED");
  // Canary VALUES only (P2b-1 battery C15 lesson: evidence spans
  // record dropped field NAMES by design, so names are not
  // asserted absent — values must never appear).
  const body = JSON.stringify(result.item);
  for (const canary of ["424242", "424243", "424244"]) {
    assert.ok(!body.includes(canary), `canary value ${canary} leaked into the published item`);
  }
});

test("live-shaped controls run returns ACTIVATION_REQUIRED", async () => {
  const result = await runJob({
    hostConfig: { ...CANONICAL_CONTROLS_HOST, mode: "LIVE" },
    request: canonicalControlsRequest(), adapterSpec: canonicalControlsSpec(),
    publisher: createMemoryPublisher(), clock,
  });
  assert.equal(result.outcome, "ACTIVATION_REQUIRED");
});

// --- P677 fix round 1: findings must cite only real source rows ---

test("P677-004 missing baselines: BASELINE_MISSING cites the package row, never an invented baseline row", async () => {
  const report = await runControlsWith((d) => {
    d.forge_work_package_baselines = d.forge_work_package_baselines.filter((b) => b.package_ref !== "PKG-A");
  });
  const row = integrityKind(report, "BASELINE_MISSING");
  assert.ok(row, "BASELINE_MISSING must be present");
  assert.deepEqual(row.evidence, [{ dataset: "forge_work_packages", record_ref: "PKG-A" }]);
  assert.ok(!row.evidence.some((e) => e.dataset === "forge_work_package_baselines" && e.record_ref === "PKG-A"));
  assert.equal(pkgA(report).conclusion, "QUALIFIED");
});

test("P677-004 no snapshots: NO_SNAPSHOTS cites the package row, never an invented snapshot row", async () => {
  const report = await runControlsWith((d) => {
    d.forge_work_progress_snapshots = d.forge_work_progress_snapshots.filter((s) => s.package_ref !== "PKG-A");
  });
  const row = integrityKind(report, "NO_SNAPSHOTS");
  assert.ok(row, "NO_SNAPSHOTS must be present");
  assert.deepEqual(row.evidence, [{ dataset: "forge_work_packages", record_ref: "PKG-A" }]);
  assert.equal(pkgA(report).conclusion, "QUALIFIED");
});

test("P677-004 baseline changed: BASELINE_CHANGED cites the named and current baseline rows plus the anchoring snapshot", async () => {
  const report = await runControlsWith((d) => {
    d.forge_work_progress_snapshots = d.forge_work_progress_snapshots.filter((s) => s.snapshot_ref !== "S-A2");
  });
  const row = integrityKind(report, "BASELINE_CHANGED");
  assert.ok(row, "BASELINE_CHANGED must be present");
  assert.deepEqual(
    row.evidence.map((e) => `${e.dataset}:${e.record_ref}`).sort(),
    ["forge_work_package_baselines:BL-A1", "forge_work_package_baselines:BL-A2", "forge_work_progress_snapshots:S-A1"].sort());
  assert.equal(pkgA(report).conclusion, "QUALIFIED");
});

test("P677-004 tie conflict: SNAPSHOT_TIE_CONFLICT cites every tied snapshot, never the package id as a snapshot row", async () => {
  const report = await runControlsWith((d) => {
    d.forge_work_progress_snapshots.push({
      ...d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2"), snapshot_ref: "TIED", actual_pct: 99,
    });
  });
  const row = integrityKind(report, "SNAPSHOT_TIE_CONFLICT");
  assert.ok(row, "SNAPSHOT_TIE_CONFLICT must be present");
  assert.deepEqual(
    row.evidence.map((e) => `${e.dataset}:${e.record_ref}`).sort(), ["forge_work_progress_snapshots:S-A2", "forge_work_progress_snapshots:TIED"]);
  assert.equal(pkgA(report).conclusion, "UNVERIFIABLE");
});

test("P677-005 scope pointer is carried, never resolved against scheduling baseline rows", async () => {
  const canonical = await runControlsWith(() => {});
  assert.equal(canonical.sections.packages.rows[0].scope_baseline_version, null);
  assert.equal(canonical.sections.packages.rows[0].scope_baseline_resolved, false);
  assert.equal(canonical.sections.packages.rows[0].scope_baseline_state, "RELATIONSHIP_NOT_MODELED");
  const otherNs = await runControlsWith((d) => {
    d.forge_work_packages.find((p) => p.package_ref === "PKG-A").scope_baseline_ref = "SCOPE-A";
  });
  assert.equal(otherNs.sections.packages.rows[0].scope_baseline_state, "RELATIONSHIP_NOT_MODELED");
  assert.ok(!otherNs.sections.integrity.rows.some((r) => r.kind.startsWith("SCOPE_")));
});

test("P677-006 fractional versions are invalid and never become current by matching", async () => {
  const report = await runControlsWith((d) => {
    d.forge_work_package_baselines.find((b) => b.baseline_ref === "BL-A2").version_number = 2.5;
    d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").baseline_version = 2.5;
  });
  assert.ok(integrityKind(report, "BASELINE_VERSION_INVALID"), "fractional baseline version must be flagged");
  assert.ok(integrityKind(report, "SNAPSHOT_BASELINE_VERSION_INVALID"), "fractional snapshot version must be flagged");
  assert.equal(pkgA(report).current_baseline.version_number, 1);
  assert.equal(pkgA(report).conclusion, "QUALIFIED");
});

test("P677-007 snapshot-only 100% carries a snapshot completion question, never package status", async () => {
  const report = await runControlsWith((d) => {
    d.forge_work_progress_snapshots.find((s) => s.snapshot_ref === "S-A2").actual_pct = 100;
  });
  const pkg = pkgA(report);
  assert.equal(pkg.conclusion, "READY");
  assert.equal(pkg.percent_complete_claim, 55);
  assert.ok(pkg.completion_note && pkg.completion_note.includes("Latest snapshot claims 100%"));
  const question = report.sections.questions.rows.find((r) => r.dataset === "forge_work_progress_snapshots" && r.record_ref === "S-A2");
  assert.ok(question, "snapshot completion question must cite S-A2");
  assert.ok(question.question.includes("observed physical completion"));
  assert.ok(!report.sections.questions.rows.some((r) => r.dataset === "forge_work_packages" && r.record_ref === "PKG-A"));
});

test("P677-007 package-only 100% carries the package completion question, not a snapshot one", async () => {
  const report = await runControlsWith((d) => {
    d.forge_work_packages.find((p) => p.package_ref === "PKG-A").percent_complete = 100;
  });
  const question = report.sections.questions.rows.find((r) => r.dataset === "forge_work_packages" && r.record_ref === "PKG-A");
  assert.ok(question, "package completion question must cite PKG-A");
  assert.ok(!report.sections.questions.rows.some((r) => r.dataset === "forge_work_progress_snapshots" && r.record_ref === "S-A2"));
});
