/**
 * P2b-2 Project Controls wiring node:test suite. Runs through the
 * full inert runner (not the units): DISABLED zero-access, controls
 * scope mismatch, the canonical controls happy path, the
 * cost-field canary (financial fields are never admitted, so their
 * VALUES can never appear in a published item), ACTIVATION_REQUIRED
 * for live shapes, and the dataset-isolation proof (a Controls run
 * touches only the three controls datasets — never a scheduling
 * dataset). The battery-controls suite (81 cases) is the
 * exhaustive proof; these tests are the readable regression net.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryPublisher, runJob } from "../src/runner.js";
import {
  CANONICAL_CONTROLS_AS_OF, CANONICAL_CONTROLS_HOST, CANONICAL_HOST,
  canonicalControlsRequest, canonicalControlsSpec, canonicalRequest, canonicalSpec,
} from "../src/fixtures.js";

const clock = { nowIso: () => CANONICAL_CONTROLS_AS_OF };

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
