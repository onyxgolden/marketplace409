/**
 * Synthetic repository node:test suite: scope filtering (owner,
 * project, global-calendar authorization), both-direction tie
 * serving, pagination, and fault knobs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createSyntheticAdapter } from "../src/syntheticRepository.js";
import { CANONICAL_PROJECT } from "../src/fixtures.js";

const SCOPE = { type: "scheduling-project", id: "P-1" };

async function collectAll(adapter, dataset) {
  const rows = [];
  let cursor = null;
  for (;;) {
    const page = await adapter.collect(dataset, { owner_ref: "owner-1", project_scope: SCOPE, cursor });
    rows.push(...page.rows);
    if (page.next_cursor === null) break;
    cursor = page.next_cursor;
  }
  return rows;
}

test("serves only the scope project's rows", async () => {
  const datasets = JSON.parse(JSON.stringify(CANONICAL_PROJECT));
  datasets.schedule_blocks.push({
    block_ref: "X", project_ref: "P-9", lane_ref: "L-1", wbs_node_ref: null,
    owner_ref: "owner-1", task_code: "X", block_type: "task", start_date: null,
    duration_days: 1, percent_complete: 0, calendar_ref: null,
    constraint_type: "ASAP", constraint_date: null, actual_start: null, actual_finish: null,
  });
  const adapter = createSyntheticAdapter({ datasets, faults: {} });
  const blocks = await collectAll(adapter, "schedule_blocks");
  assert.ok(blocks.every((b) => b.project_ref === "P-1"));
  assert.ok(!blocks.some((b) => b.block_ref === "X"));
});

test("serves ties touching the project in either direction", async () => {
  const datasets = JSON.parse(JSON.stringify(CANONICAL_PROJECT));
  datasets.schedule_dependencies.push({
    dependency_ref: "T-XA", predecessor_ref: "GHOST", successor_ref: "A",
    owner_ref: "owner-1", relationship_type: "FS", lag_days: 0,
  });
  const adapter = createSyntheticAdapter({ datasets, faults: {} });
  const ties = await collectAll(adapter, "schedule_dependencies");
  assert.ok(ties.some((t) => t.dependency_ref === "T-XA"));
  assert.ok(ties.some((t) => t.dependency_ref === "T-AB"));
});

test("unauthorized global calendars are never served", async () => {
  const datasets = JSON.parse(JSON.stringify(CANONICAL_PROJECT));
  datasets.schedule_calendars = [{
    calendar_ref: "GCAL", project_ref: null, owner_ref: "owner-1", working_days: [1, 2, 3, 4, 5],
  }];
  const adapter = createSyntheticAdapter({ datasets, faults: {}, authorizedGlobalCalendarRefs: [] });
  const calendars = await collectAll(adapter, "schedule_calendars");
  assert.equal(calendars.length, 0);
  const authorized = createSyntheticAdapter({ datasets, faults: {}, authorizedGlobalCalendarRefs: ["GCAL"] });
  const calendars2 = await collectAll(authorized, "schedule_calendars");
  assert.equal(calendars2.length, 1);
});

test("pagination returns every row exactly once", async () => {
  const adapter = createSyntheticAdapter({ datasets: CANONICAL_PROJECT, faults: { pageSize: 2 } });
  const blocks = await collectAll(adapter, "schedule_blocks");
  assert.equal(blocks.length, CANONICAL_PROJECT.schedule_blocks.length);
  assert.equal(new Set(blocks.map((b) => b.block_ref)).size, blocks.length);
});

test("getter, proxy and cyclic rows are served as-is for the budget to refuse", async () => {
  for (const fault of ["getterCanaryDataset", "proxyRowDataset", "cyclicRowDataset"]) {
    const adapter = createSyntheticAdapter({ datasets: CANONICAL_PROJECT, faults: { [fault]: "schedule_blocks" } });
    const page = await adapter.collect("schedule_blocks", { owner_ref: "owner-1", project_scope: SCOPE, cursor: null });
    assert.ok(page.rows.length > 0);
  }
});
