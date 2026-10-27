/**
 * P2b-3 Project Manager wiring node:test suite. Runs through the
 * full inert runner (not the units): DISABLED zero-access, manager
 * scope mismatch, the canonical manager happy path, the cost-field
 * canary (financial fields are never admitted, so their VALUES can
 * never appear in a published item), the mapping requirement, the
 * mapping-derived controls-leg scope (the leg scope comes from the
 * host mapping, never from the request or the datasets), and the
 * dataset-isolation proof (a Manager run touches exactly the 10
 * admitted datasets — 7 scheduling + 3 controls — never a project
 * GET or mutation). The battery-manager suite (80 cases) is the
 * exhaustive proof; these tests are the readable regression net.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryPublisher, runJob } from "../src/runner.js";
import {
  CANONICAL_AS_OF, CANONICAL_CONTROLS, CANONICAL_MANAGER_HOST, CANONICAL_MANAGER_MAPPING,
  CANONICAL_PROJECT, canonicalManagerRequest, canonicalManagerSpec,
} from "../src/fixtures.js";

const clock = { nowIso: () => CANONICAL_AS_OF };

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

test("DISABLED manager run returns before any adapter access", async () => {
  const publisher = createMemoryPublisher();
  const result = await runJob({
    hostConfig: { ...CANONICAL_MANAGER_HOST, mode: "DISABLED" },
    request: canonicalManagerRequest(), adapterSpec: canonicalManagerSpec(), publisher, clock,
  });
  assert.equal(result.outcome, "DISABLED");
  assert.deepEqual(result.counters, {
    adapter_opens: 0, adapter_calls: 0, credential_reads: 0, network_calls: 0, store_writes: 0,
  });
  assert.equal(publisher.items.size, 0);
});

test("manager kind with a work-management scope refuses SCOPE_UNREGISTERED", async () => {
  const result = await runJob({
    hostConfig: CANONICAL_MANAGER_HOST,
    request: { ...canonicalManagerRequest(), project_scope_ref: { type: "work-management-project", id: "WM-1" } },
    adapterSpec: canonicalManagerSpec(), publisher: createMemoryPublisher(), clock,
  });
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.code, "SCOPE_UNREGISTERED");
});

test("canonical manager run completes and publishes a DRAFT pm- item", async () => {
  const publisher = createMemoryPublisher();
  const result = await runJob({
    hostConfig: CANONICAL_MANAGER_HOST, request: canonicalManagerRequest(),
    adapterSpec: canonicalManagerSpec(), publisher, clock,
  });
  assert.equal(result.outcome, "COMPLETED");
  assert.equal(result.report_status, "DRAFT");
  assert.equal(result.report.conclusion, "QUALIFIED");
  assert.equal(result.item.report.execution_authorized, false);
  assert.equal(result.item.report.agent, "project-manager");
  assert.ok(result.item_id.startsWith("pm-"), `item id ${result.item_id} must carry the manager prefix`);
  assert.equal(result.item.title, "Project Manager plan-health review — 2026-10-26");
  assert.deepEqual(
    result.adapter_datasets.sort(),
    [
      "schedule_projects", "schedule_calendars", "schedule_lanes", "schedule_blocks",
      "schedule_dependencies", "schedule_calendar_holidays", "schedule_blackout_windows",
      "forge_work_packages", "forge_work_package_baselines", "forge_work_progress_snapshots",
    ].sort(),
  );
  const s = result.item.report.sections;
  assert.equal(s.completion.admitted_packages, 2);
  assert.equal(s.completion.terminal_count, 0);
  assert.equal(s.relationships.state, "RELATIONSHIP_NOT_ESTABLISHED");
  assert.deepEqual(s.predecessor_evidence.rows.map((r) => r.status), ["BOUND", "BOUND", "BOUND"]);
  for (const row of s.agenda.rows) {
    assert.equal(row.responsible_role, "project reviewer");
    assert.ok(!("patch" in row) && !("task" in row) && !("approval" in row));
  }
});

test("manager run without a project mapping refuses PROJECT_MAPPING_REQUIRED", async () => {
  const spec = canonicalManagerSpec();
  delete spec.project_mapping;
  const result = await runJob({
    hostConfig: CANONICAL_MANAGER_HOST, request: canonicalManagerRequest(),
    adapterSpec: spec, publisher: createMemoryPublisher(), clock,
  });
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.code, "PROJECT_MAPPING_REQUIRED");
});

test("controls-leg scope comes from the mapping, never from the datasets: a mapping to WM-9 admits no packages", async () => {
  const datasets = { ...clone(CANONICAL_PROJECT), ...clone(CANONICAL_CONTROLS) };
  const spec = {
    kind: "synthetic", datasets, faults: {}, authorized_global_calendar_refs: [],
    project_mapping: { scheduling_project_ref: "P-1", work_management_project_ref: "WM-9", mapping_version: "planning-project-mapping@1" },
  };
  const result = await runJob({
    hostConfig: CANONICAL_MANAGER_HOST, request: canonicalManagerRequest(),
    adapterSpec: spec, publisher: createMemoryPublisher(), clock,
  });
  assert.equal(result.outcome, "COMPLETED");
  assert.equal(result.item.report.sections.completion.admitted_packages, 0);
  assert.equal(result.item.report.mapping.work_management_project_ref, "WM-9");
});

test("cost-field canary: the value never appears in the published item", async () => {
  const datasets = { ...clone(CANONICAL_PROJECT), ...clone(CANONICAL_CONTROLS) };
  datasets.forge_work_packages.find((p) => p.package_ref === "PKG-A").cost_usd = 42424242;
  const spec = {
    kind: "synthetic", datasets, faults: {}, authorized_global_calendar_refs: [],
    project_mapping: { ...CANONICAL_MANAGER_MAPPING },
  };
  const publisher = createMemoryPublisher();
  const result = await runJob({
    hostConfig: CANONICAL_MANAGER_HOST, request: canonicalManagerRequest(),
    adapterSpec: spec, publisher, clock,
  });
  assert.equal(result.outcome, "COMPLETED");
  assert.ok(!JSON.stringify(result.item).includes("42424242"));
});
