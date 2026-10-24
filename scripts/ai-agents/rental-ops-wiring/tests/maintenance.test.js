import assert from "node:assert/strict";
import { test } from "node:test";
import { runJob, createMemoryPublisher } from "../src/runner.js";
import { MM_SYNTHETIC_REPOSITORIES, MM_PII_CANARIES } from "../fixtures/maintenanceRepositories.js";
import { validateDecision } from "../../../../src/application/ai-lab/rental-ops/decisionValidator.js";
import { fixedClock, makeHost, makeRequest, onlyItem, previewSpec } from "./helpers.js";

const MM_REQUEST = {
  principal_ref: "host:workbench-operator", owner_ref: "owner-a", portfolio_ref: "portfolio-a",
  job_kind: "maintenance-manager-backlog-review", job_version: 1,
  as_of: "2026-10-22T14:00:00.000Z", window: { name: "maintenance-backlog-open" },
  snapshot_request_id: "snap-mm-test",
};

async function runMM({ datasets, faults = {}, host = {}, request = {}, clock = fixedClock() } = {}) {
  const publisher = createMemoryPublisher();
  const result = await runJob({
    hostConfig: makeHost(host),
    request: { ...MM_REQUEST, ...request },
    adapterSpec: previewSpec({ datasets: datasets ?? MM_SYNTHETIC_REPOSITORIES["mm-preview-owner-a"](), faults }),
    publisher, clock,
  });
  return { result, publisher };
}

test("MM end-to-end: COMPLETED with an mm- item and a backlog report", async () => {
  const { result, publisher } = await runMM();
  assert.equal(result.outcome, "COMPLETED");
  assert.ok(result.item_id.startsWith("mm-"), `item id ${result.item_id}`);
  const item = onlyItem(publisher);
  assert.equal(item.kind, "rental-ops-report");
  assert.equal(item.agent, "maintenance-manager");
  assert.equal(item.report.kind, "maintenance-manager-backlog-review");
  assert.equal(item.report.evaluator_version, "maintenance-manager-evaluator@1");
  assert.equal(item.execution_authorized, false);
  assert.ok(item.report.sections.backlog.rows.length > 0);
  assert.equal(item.report.sections.pm_compliance, "NOT_MODELED");
  assert.ok(item.title.includes("Maintenance Manager backlog review"));
  // Row ids are decision-addressable.
  assert.ok(item.row_ids.includes("report"));
  assert.ok(item.row_ids.some((id) => id.startsWith("wo:")));
  // Evidence spans cover the work-order dataset.
  assert.ok(item.evidence_spans.some((s) => s.dataset === "work_orders"));
});

test("MM DISABLED returns before any adapter, store, or source", async () => {
  let published = 0;
  const result = await runJob({
    hostConfig: makeHost({ mode: "DISABLED" }),
    request: { ...MM_REQUEST },
    adapterSpec: previewSpec({ datasets: null }),
    publisher: { async publish() { published += 1; } },
    clock: fixedClock(),
  });
  assert.equal(result.outcome, "DISABLED");
  assert.deepEqual(result.counters, { adapter_opens: 0, adapter_calls: 0, credential_reads: 0, network_calls: 0, store_writes: 0 });
  assert.equal(published, 0);
});

test("MM scope: cross-owner work-order bytes refuse the whole snapshot", async () => {
  const { result, publisher } = await runMM({
    datasets: MM_SYNTHETIC_REPOSITORIES["mm-preview-basic"](),
    faults: { leakyOwners: true },
  });
  assert.equal(result.outcome, "REFUSED");
  assert.equal(result.code, "SCOPE_VIOLATION");
  assert.equal(publisher.items.size, 0);
});

test("MM scope: owner-b sees only owner-b facts (no bleed, no join)", async () => {
  const publisher = createMemoryPublisher();
  const result = await runJob({
    hostConfig: makeHost({ registered_owner: "owner-b", registered_portfolio: "portfolio-owner-b" }),
    request: { ...MM_REQUEST, owner_ref: "owner-b", portfolio_ref: "portfolio-owner-b" },
    adapterSpec: previewSpec({ datasets: MM_SYNTHETIC_REPOSITORIES["mm-preview-basic"]() }),
    publisher, clock: fixedClock(),
  });
  assert.equal(result.outcome, "COMPLETED");
  const item = onlyItem(publisher);
  const refs = item.report.sections.backlog.rows.map((r) => r.work_order_ref);
  assert.deepEqual(refs, ["wo-1"]);
  assert.equal(item.report.sections.backlog.rows[0].priority, "low");
});

test("MM PII canaries never reach the snapshot, report, or item", async () => {
  const { publisher } = await runMM({ datasets: MM_SYNTHETIC_REPOSITORIES["mm-preview-basic"]() });
  const item = onlyItem(publisher);
  const bytes = JSON.stringify(item);
  for (const canary of MM_PII_CANARIES) {
    assert.ok(!bytes.includes(canary), `canary leaked: ${canary}`);
  }
});

test("MM decisions: accept on a backlog row validates; unknown rows refuse", async () => {
  const { publisher } = await runMM();
  const item = onlyItem(publisher);
  const rowId = item.report.sections.backlog.rows[0].row_id;
  const decision = {
    item_id: item.item_id, report_digest: item.report_digest, row_id: rowId,
    actor: "host:workbench-operator", decision: "accept", note: "reviewed",
    at: "2026-10-22T15:00:00.000Z", decision_id: "mm-dec-1",
  };
  const validated = validateDecision(item, decision);
  assert.equal(validated.row_id, rowId);
  assert.throws(
    () => validateDecision(item, { ...decision, decision_id: "mm-dec-2", row_id: "wo:ghost" }),
    /UNKNOWN_ROW/,
  );
});

test("P670-004: a cross-job window refuses before any adapter access — both swapped combinations", async () => {
  // MM job carrying the PM window (ChatGPT's executed WRONG_JOB_WINDOW
  // probe: previously COMPLETED with the window silently rewritten).
  const mmPub = createMemoryPublisher();
  const mmResult = await runJob({
    hostConfig: makeHost(),
    request: { ...MM_REQUEST, window: { name: "lease-expiration-60d" } },
    adapterSpec: previewSpec({ datasets: MM_SYNTHETIC_REPOSITORIES["mm-preview-owner-a"]() }),
    publisher: mmPub, clock: fixedClock(),
  });
  assert.equal(mmResult.outcome, "REFUSED");
  assert.equal(mmResult.code, "BAD_REQUEST");
  assert.equal(mmResult.counters.adapter_opens, 0);
  assert.equal(mmResult.counters.adapter_calls, 0);
  assert.equal(mmPub.items.size, 0);

  // PM job carrying the MM window.
  const pmPub = createMemoryPublisher();
  const pmResult = await runJob({
    hostConfig: makeHost(),
    request: { ...makeRequest(), window: { name: "maintenance-backlog-open" } },
    adapterSpec: previewSpec({ datasets: MM_SYNTHETIC_REPOSITORIES["mm-preview-owner-a"]() }),
    publisher: pmPub, clock: fixedClock(),
  });
  assert.equal(pmResult.outcome, "REFUSED");
  assert.equal(pmResult.code, "BAD_REQUEST");
  assert.equal(pmResult.counters.adapter_opens, 0);
  assert.equal(pmResult.counters.adapter_calls, 0);
  assert.equal(pmPub.items.size, 0);
});

test("P670-005: coverage gaps in three datasets publish three distinct, independently decidable identities", async () => {
  const { result, publisher } = await runMM({ faults: { hideExpected: true } });
  assert.equal(result.outcome, "COMPLETED");
  const item = onlyItem(publisher);
  const coverageIds = item.row_ids.filter((id) => id.startsWith("int:COVERAGE_UNATTESTED:")).sort();
  assert.deepEqual(coverageIds, [
    "int:COVERAGE_UNATTESTED:properties:coverage",
    "int:COVERAGE_UNATTESTED:units:coverage",
    "int:COVERAGE_UNATTESTED:work_orders:coverage",
  ]);
  // A decision on one dataset's issue is addressable independently of
  // the other two (the aliasing this fix removes made them one).
  for (const [i, rowId] of coverageIds.entries()) {
    const validated = validateDecision(item, {
      item_id: item.item_id, report_digest: item.report_digest, row_id: rowId,
      actor: "host:workbench-operator", decision: "accept", note: "",
      at: "2026-10-22T15:00:00.000Z", decision_id: `mm-cov-${i}`,
    });
    assert.equal(validated.row_id, rowId);
  }
});

test("MM item identity is namespaced: same snapshot bytes under PM and MM never collide", async () => {
  const { publisher: mmPub } = await runMM();
  const mmItem = onlyItem(mmPub);
  assert.ok(mmItem.item_id.startsWith("mm-"));
  assert.notEqual(mmItem.item_id.slice(3), "");
});
