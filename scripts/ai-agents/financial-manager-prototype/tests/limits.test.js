/**
 * limits.test.js — prototype budgets: INPUT_LIMIT (256 KiB), operation
 * budgets (64 resolutions / 512 spans -> BUDGET_EXCEEDED), OUTPUT_LIMIT
 * (256 records), and the 5-second harness watchdog sanity bound.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadStore, loadBattery, makeContext, run, CLOCK } from "./harness.js";
import { canonicalBytes } from "../src/canonical.js";
import { gitBlobSha1 } from "../src/resolver.js";

function registerTampered(store, content) {
  const blob = gitBlobSha1(canonicalBytes(content));
  const ref = {
    repo: "forge-ai-drop-fixtures",
    path: "fixtures/financial-manager/tampered.json",
    commit: "d".repeat(40),
    blob,
    algorithm: "git-sha1",
    revision: "1",
  };
  const ctx = makeContext(store);
  ctx.fixtureStore = { fixtures: { t: { source_ref: ref, content } } };
  return { ctx, ref };
}

const line = (i, nLabels = 1) => ({
  line_id: "L" + i,
  category: "expense",
  budget_minor: "1000",
  actual_minor: "900",
  source_labels: Array.from({ length: nLabels }, (_, k) => `lbl-${i}-${k}`),
  support_strength: "verified",
  flags: [],
});

const sec = (id, lines, start = "2026-01-01", end = "2026-01-31") => ({
  section_id: id,
  currency: "USD",
  minor_unit_scale: 2,
  population_id: "pop-lim",
  period_start: start,
  period_end: end,
  lines,
  claimed_totals: [],
  narrative_claims: [],
});

test("limits: input over 256 KiB -> INPUT_LIMIT", () => {
  const store = loadStore();
  const task = {
    task_id: "t",
    bundle_refs: [store.fixtures["fm-01"].source_ref],
    period_ids: Array.from({ length: 30000 }, (_, i) => "period-" + i + "-xxxxxxxxxx"),
    requested_action: "assemble_draft",
  };
  const bytes = Buffer.byteLength(JSON.stringify(task), "utf8");
  assert.ok(bytes > 256 * 1024, `test setup: input is ${bytes} bytes`);
  const r = run(task, makeContext(store));
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INPUT_LIMIT");
  assert.deepStrictEqual(r.sections, []);
});

test("limits: >64 resolutions -> BUDGET_EXCEEDED", () => {
  const store = loadStore();
  const sections = Array.from({ length: 70 }, (_, i) => sec("s" + i, [line(i)]));
  const { ctx, ref } = registerTampered(store, { sections });
  const r = run(
    { task_id: "t", bundle_refs: [ref], period_ids: [], requested_action: "assemble_draft" },
    ctx
  );
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "BUDGET_EXCEEDED");
});

test("limits: >512 evidence spans -> BUDGET_EXCEEDED", () => {
  const store = loadStore();
  const { ctx, ref } = registerTampered(store, { sections: [sec("s0", [line(0, 513)])] });
  const r = run(
    { task_id: "t", bundle_refs: [ref], period_ids: [], requested_action: "assemble_draft" },
    ctx
  );
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "BUDGET_EXCEEDED");
});

test("limits: >256 output records -> OUTPUT_LIMIT", () => {
  const store = loadStore();
  // 300 empty sections: 1 ref + 0 lines => within input budgets,
  // but 1 + 300 output records exceeds the output cap.
  const sections = Array.from({ length: 300 }, (_, i) =>
    sec("s" + i, [], "2026-01-01", "2026-01-31")
  );
  // sections share population but identical periods are allowed (same range)
  const { ctx, ref } = registerTampered(store, { sections });
  const r = run(
    { task_id: "t", bundle_refs: [ref], period_ids: [], requested_action: "assemble_draft" },
    ctx
  );
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "OUTPUT_LIMIT");
});

test("limits: single case completes well under the 5s watchdog", () => {
  const store = loadStore();
  const ctx = makeContext(store);
  const task = {
    task_id: "t",
    bundle_refs: [store.fixtures["fm-06"].source_ref],
    period_ids: [],
    requested_action: "assemble_draft",
  };
  const t0 = Date.now();
  const r = run(task, ctx);
  const ms = Date.now() - t0;
  assert.equal(r.status, "ASSEMBLED");
  assert.ok(ms < 5000, `case took ${ms}ms`);
});

test("limits: full battery completes well under the 5s watchdog", () => {
  const store = loadStore();
  const battery = loadBattery();
  const t0 = Date.now();
  for (const c of battery.cases) run(c.input.task, makeContext(store));
  const ms = Date.now() - t0;
  assert.ok(ms < 5000, `battery took ${ms}ms`);
  void CLOCK;
});
