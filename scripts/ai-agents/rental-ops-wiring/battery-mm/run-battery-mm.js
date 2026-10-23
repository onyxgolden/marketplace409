/**
 * Frozen Maintenance Manager battery runner. Trust note (P666-004A):
 * this file MUST NOT statically import any candidate module — it is
 * executed only through runner/trust-entry.mjs, which authenticates
 * the wiring manifest against the host trust root BEFORE this file is
 * imported. The battery manifest (cases + oracle digests) is verified
 * here with builtins only, before the oracle or any wiring module is
 * imported. Each case runs the full inert runner three times against
 * one shared publisher: the published item must be byte-identical
 * across runs and match the independent oracle (or the case's literal
 * expectation).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIRING_ROOT = join(HERE, "..");
const APP_ROOT = join(WIRING_ROOT, "..", "..", "..", "src", "application", "ai-lab", "rental-ops");
const imp = (abs) => import(pathToFileURL(abs).href);

const batteryManifest = JSON.parse(readFileSync(join(HERE, "manifest-mm.json"), "utf8"));
for (const [file, expected] of Object.entries(batteryManifest.files)) {
  const actual = createHash("sha256").update(readFileSync(join(HERE, file))).digest("hex");
  if (actual !== expected) { console.error(`trust authentication failed (battery-mm) — ${file} digest mismatch`); process.exit(3); }
}
const cases = JSON.parse(readFileSync(join(HERE, "cases-mm.json"), "utf8"));

const { createMemoryPublisher, runJob } = await imp(join(WIRING_ROOT, "src", "runner.js"));
const { canonicalDigest, canonicalJson } = await imp(join(APP_ROOT, "canonical.js"));
const { validateDecision } = await imp(join(APP_ROOT, "decisionValidator.js"));
const { oraclePredict } = await imp(join(HERE, "oracle-mm.js"));

const failures = [];
const fail = (c, msg) => failures.push(`${c.id} [${c.category}]: ${msg}`);

function checkOracle(c, item) {
  const predicted = oraclePredict(c);
  const report = item.report;
  const blk = {};
  for (const row of report.sections.backlog.rows) {
    blk[row.work_order_ref] = {
      age_days: row.age_days, age_bin: row.age_bin, priority: row.priority,
      due_state: row.due_state, status: row.status,
    };
  }
  const expBlk = {};
  for (const [ref, p] of Object.entries(predicted.backlog)) expBlk[ref] = p;
  if (canonicalJson(blk) !== canonicalJson(expBlk)) {
    fail(c, `backlog mismatch: got ${canonicalJson(blk)} want ${canonicalJson(expBlk)}`);
  }
  const ovd = report.sections.overdue.rows.map((r) => r.work_order_ref).sort();
  if (canonicalJson(ovd) !== canonicalJson(predicted.overdue)) {
    fail(c, `overdue mismatch: got ${canonicalJson(ovd)} want ${canonicalJson(predicted.overdue)}`);
  }
  if (report.sections.overdue.unknown_due_count !== predicted.unknown_due_count) {
    fail(c, `unknown_due_count ${report.sections.overdue.unknown_due_count} != ${predicted.unknown_due_count}`);
  }
  if (report.sections.backlog.unknown_age_count !== predicted.unknown_age_count) {
    fail(c, `unknown_age_count ${report.sections.backlog.unknown_age_count} != ${predicted.unknown_age_count}`);
  }
  const kinds = report.sections.integrity.rows.map((r) => r.kind).sort();
  if (canonicalJson(kinds) !== canonicalJson(predicted.integrity_kinds)) {
    fail(c, `integrity kinds mismatch: got ${canonicalJson(kinds)} want ${canonicalJson(predicted.integrity_kinds)}`);
  }
  if (report.sections.pm_compliance !== "NOT_MODELED") fail(c, "pm_compliance is not NOT_MODELED");
  if (c.expect.status === undefined && report.status !== predicted.status) {
    fail(c, `status mismatch: got ${report.status} want ${predicted.status}`);
  }
}

for (const c of cases) {
  const clock = { nowIso: () => c.clock_iso };
  if (c.special === "publisher-failure") {
    let threw = false;
    try {
      await runJob({
        hostConfig: c.host, request: c.request,
        adapterSpec: { kind: "synthetic", datasets: c.datasets, faults: c.faults ?? {} },
        publisher: { async publish() { throw new Error("disk on fire"); } },
        clock,
      });
    } catch { threw = true; }
    if (!threw) fail(c, "publisher failure was swallowed — a failed write must never report success");
    continue;
  }
  const publisher = createMemoryPublisher();
  let firstBytes = null;
  let firstResult = null;
  for (let run = 0; run < 3; run++) {
    const result = await runJob({
      hostConfig: c.host, request: c.request,
      callerAsk: c.callerAsk, callerAdapter: c.callerAdapter,
      adapterSpec: { kind: "synthetic", datasets: c.datasets, faults: c.faults ?? {} },
      publisher, clock,
    });
    if (run === 0) firstResult = result;
    if (result.outcome !== c.expect.outcome) {
      fail(c, `run ${run + 1}: outcome ${result.outcome} (code ${result.code ?? "-"}) != expected ${c.expect.outcome} (code ${c.expect.code ?? "-"})`);
      break;
    }
    if (c.expect.code && result.code !== c.expect.code) fail(c, `run ${run + 1}: code ${result.code} != ${c.expect.code}`);
    if (c.expect.kind && result.kind !== c.expect.kind) fail(c, `run ${run + 1}: budget kind ${result.kind} != ${c.expect.kind}`);
    if (result.outcome === "BUDGET_EXCEEDED" && result.refusal_report?.domain_totals !== null) {
      fail(c, "budget refusal carried domain totals");
    }
    if (result.outcome === "COMPLETED") {
      const item = [...publisher.items.values()][0];
      const bytes = canonicalJson(item);
      if (firstBytes === null) firstBytes = bytes;
      else if (bytes !== firstBytes) fail(c, `run ${run + 1}: published item bytes differ across runs`);
      if (run > 0 && result.receipt?.idempotent !== true) fail(c, `run ${run + 1}: identical replay was not idempotent`);
    }
  }
  if (firstResult?.outcome === "COMPLETED") {
    const item = [...publisher.items.values()][0];
    if (c.expect.oracle) checkOracle(c, item);
    if (c.expect.report_kind && item.report.kind !== c.expect.report_kind) {
      fail(c, `report kind ${item.report.kind} != expected ${c.expect.report_kind}`);
    }
    if (c.expect.status && item.report.status !== c.expect.status) {
      fail(c, `status ${item.report.status} != expected ${c.expect.status}`);
    }
    if (c.expect.integrity_includes) {
      const kinds = item.report.sections.integrity.rows.map((r) => r.kind);
      for (const k of c.expect.integrity_includes) if (!kinds.includes(k)) fail(c, `integrity kinds missing ${k}`);
    }
    if (c.expect.item_contains) {
      const bytes = JSON.stringify(item);
      for (const needle of c.expect.item_contains) {
        const escaped = JSON.stringify(needle).slice(1, -1);
        if (!bytes.includes(escaped)) fail(c, `item does not contain inert data ${needle}`);
      }
    }
    if (item.execution_authorized !== false) fail(c, "execution_authorized is not false");
    if (canonicalDigest(item.report) !== item.report_digest) fail(c, "stored report digest does not match report bytes");
    if (c.special === "republish-conflict") {
      const forged = { ...item, report_digest: "f".repeat(64) };
      let refused = false;
      try { await publisher.publish(forged); } catch (e) { refused = e?.code === "REPUBLISH_CONFLICT"; }
      if (!refused) fail(c, "republish with the same identity but different bytes was not refused");
    }
    if (c.special === "tamper-digest") {
      const tampered = { ...item.report, status: "PROPOSED", sections: { ...item.report.sections, backlog: { rows: [], count: 0 } } };
      if (canonicalDigest(tampered) === item.report_digest) fail(c, "tampered report bytes still match the pinned digest");
      const rowId = item.report.sections.backlog.rows[0]?.row_id ?? "report";
      const decision = {
        item_id: item.item_id, report_digest: item.report_digest, row_id: rowId,
        actor: "battery", decision: "accept", note: "", at: "2026-10-22T15:00:00.000Z", decision_id: "battery-mm-1",
      };
      const tamperedItem = { ...item, report: tampered };
      if (canonicalDigest(tamperedItem.report) === tamperedItem.report_digest) {
        fail(c, "tamper-evidence broken");
      }
      try { validateDecision(item, decision); } catch (e) { fail(c, `untampered decision refused: ${e.message}`); }
    }
  }
  if ((c.expect.outcome === "REFUSED" || c.expect.outcome === "DISABLED" || c.expect.outcome === "ACTIVATION_REQUIRED" || c.expect.outcome === "BUDGET_EXCEEDED")
    && publisher.items.size !== 0) {
    fail(c, "a refused/disabled/budget outcome published an item");
  }
}

const byCategory = {};
for (const c of cases) byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
if (failures.length) {
  console.error(`BATTERY-MM FAILED — ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`BATTERY-MM PASS — ${cases.length} cases ${JSON.stringify(byCategory)}, 3 runs each, byte-identical`);
