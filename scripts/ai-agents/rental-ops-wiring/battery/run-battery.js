/**
 * Frozen battery runner. Verifies the wiring manifest AND the battery
 * manifest (cases + oracle digests) before any case executes — a
 * tampered source, case or oracle stops the run cold. Each case runs
 * the full inert runner three times against one shared publisher:
 * the published item must be byte-identical across runs and match
 * the independent oracle (or the case's literal expectation).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyManifest } from "../runner/bootstrap.mjs";
import { createMemoryPublisher, runJob } from "../src/runner.js";
import { canonicalDigest, canonicalJson } from "../../../../src/application/ai-lab/rental-ops/canonical.js";
import { validateDecision } from "../../../../src/application/ai-lab/rental-ops/decisionValidator.js";
import { oraclePredict } from "./oracle.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const wiring = verifyManifest();
if (!wiring.ok) { console.error(`trust authentication failed (wiring) — ${wiring.failures.join("; ")}`); process.exit(3); }
const batteryManifest = JSON.parse(readFileSync(join(HERE, "manifest.json"), "utf8"));
for (const [file, expected] of Object.entries(batteryManifest.files)) {
  const actual = createHash("sha256").update(readFileSync(join(HERE, file))).digest("hex");
  if (actual !== expected) { console.error(`trust authentication failed (battery) — ${file} digest mismatch`); process.exit(3); }
}
const cases = JSON.parse(readFileSync(join(HERE, "cases.json"), "utf8"));

const failures = [];
const fail = (c, msg) => failures.push(`${c.id} [${c.category}]: ${msg}`);

function checkOracle(c, item) {
  const predicted = oraclePredict(c);
  const report = item.report;
  const exp = {};
  for (const row of report.sections.lease_expirations.rows) exp[row.lease_ref] = row.days_until_expiration;
  if (canonicalJson(exp) !== canonicalJson(predicted.expirations)) {
    fail(c, `expirations mismatch: got ${canonicalJson(exp)} want ${canonicalJson(predicted.expirations)}`);
  }
  const ovd = {};
  const blocked = [];
  for (const row of report.sections.overdue_balances.rows) {
    if (row.totals_blocked) blocked.push(row.lease_ref);
    else ovd[row.lease_ref] = [row.forge_collectible_cents, row.externally_managed_cents];
  }
  if (canonicalJson(ovd) !== canonicalJson(predicted.overdue)) {
    fail(c, `overdue mismatch: got ${canonicalJson(ovd)} want ${canonicalJson(predicted.overdue)}`);
  }
  if (canonicalJson(blocked.sort()) !== canonicalJson(predicted.blocked_leases)) {
    fail(c, `blocked leases mismatch: got ${canonicalJson(blocked)} want ${canonicalJson(predicted.blocked_leases)}`);
  }
  const kinds = report.sections.integrity.rows.map((r) => r.kind).sort();
  if (canonicalJson(kinds) !== canonicalJson(predicted.integrity_kinds)) {
    fail(c, `integrity kinds mismatch: got ${canonicalJson(kinds)} want ${canonicalJson(predicted.integrity_kinds)}`);
  }
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
      const tampered = { ...item.report, status: "PROPOSED", sections: { ...item.report.sections, lease_expirations: { rows: [], count: 0 } } };
      if (canonicalDigest(tampered) === item.report_digest) fail(c, "tampered report bytes still match the pinned digest");
      const decision = {
        item_id: item.item_id, report_digest: item.report_digest, row_id: "report",
        actor: "battery", decision: "accept", note: "", at: "2026-10-22T15:00:00.000Z", decision_id: "battery-1",
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
  console.error(`BATTERY FAILED — ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`BATTERY PASS — ${cases.length} cases ${JSON.stringify(byCategory)}, 3 runs each, byte-identical`);
