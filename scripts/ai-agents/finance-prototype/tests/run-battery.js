#!/usr/bin/env node
/**
 * run-battery.js — standalone battery runner: `npm run battery`.
 * Runs all frozen cases through the agent and compares structural
 * output against the hand-derived expectations. Exits nonzero on any
 * mismatch. Requires FIN_APPROVED_ROOT (same trust gate as run-tests.js).
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const APPROVED_ROOT = process.env.FIN_APPROVED_ROOT;
if (typeof APPROVED_ROOT !== "string" || !/^[0-9a-f]{64}$/.test(APPROVED_ROOT)) {
  console.error("bootstrap: missing FIN_APPROVED_ROOT — refusing to run");
  process.exit(3);
}
{
  const manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  const digest = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  if (digest !== APPROVED_ROOT) {
    console.error("bootstrap: corpus digest mismatch — refusing to run");
    process.exit(3);
  }
}

const { run } = await import("../src/index.js");
const CASES = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));

let pass = 0;
let fail = 0;
const failures = [];

function check(caseId, cond, label, actual) {
  if (!cond) {
    fail++;
    failures.push(`${caseId}: ${label} (actual: ${JSON.stringify(actual)?.slice(0, 200)})`);
    return false;
  }
  return true;
}

for (const c of CASES) {
  const result = run(c.task, c.context);
  const exp = c.expected;
  let ok = true;

  ok = check(c.case_id, result.status === exp.status, `status expected ${exp.status}`, result.status) && ok;

  if (exp.refusedCode) {
    const codes = (result.diagnostics ?? []).map((d) => d.code);
    ok = check(c.case_id, codes.includes(exp.refusedCode), `diagnostic code ${exp.refusedCode}`, codes) && ok;
  }
  if (exp.summaryNull !== undefined) {
    ok = check(c.case_id, (result.report.summary === null) === exp.summaryNull, `summary null=${exp.summaryNull}`, result.report.summary !== null) && ok;
  }
  if (exp.admitted !== undefined) {
    ok = check(c.case_id, result.report.transaction_results.length === exp.admitted, `admitted=${exp.admitted}`, result.report.transaction_results.length) && ok;
  }
  if (exp.anomalyCodes) {
    const codes = new Set((result.report.anomalies ?? []).map((a) => a.code));
    for (const want of exp.anomalyCodes) {
      ok = check(c.case_id, codes.has(want), `anomaly ${want}`, [...codes]) && ok;
    }
  }
  if (exp.diagnosticCodes) {
    const codes = new Set((result.diagnostics ?? []).map((d) => d.code));
    for (const want of exp.diagnosticCodes) {
      ok = check(c.case_id, codes.has(want), `diagnostic ${want}`, [...codes]) && ok;
    }
  }
  if (exp.quarantined !== undefined) {
    ok = check(c.case_id, (result.quarantined_sources ?? []).length === exp.quarantined, `quarantined=${exp.quarantined}`, (result.quarantined_sources ?? []).length) && ok;
  }
  if (exp.net_income_minor !== undefined) {
    ok = check(c.case_id, result.report.income_expense.net_income_minor === exp.net_income_minor, `net_income=${exp.net_income_minor}`, result.report.income_expense.net_income_minor) && ok;
  }
  if (exp.subtotal_minor !== undefined) {
    ok = check(c.case_id, result.report.line_arithmetic.subtotal_minor === exp.subtotal_minor, `subtotal=${exp.subtotal_minor}`, result.report.line_arithmetic.subtotal_minor) && ok;
  }
  if (exp.tax_total_minor !== undefined) {
    ok = check(c.case_id, result.report.line_arithmetic.tax_total_minor === exp.tax_total_minor, `tax=${exp.tax_total_minor}`, result.report.line_arithmetic.tax_total_minor) && ok;
  }
  if (exp.grand_total_minor !== undefined) {
    ok = check(c.case_id, result.report.line_arithmetic.grand_total_minor === exp.grand_total_minor, `grand=${exp.grand_total_minor}`, result.report.line_arithmetic.grand_total_minor) && ok;
  }
  if (exp.closing_minor !== undefined) {
    ok = check(c.case_id, result.report.cash.closing_derived_minor === exp.closing_minor, `closing=${exp.closing_minor}`, result.report.cash.closing_derived_minor) && ok;
  }
  if (exp.outOfPeriod !== undefined) {
    ok = check(c.case_id, result.report.out_of_period_ids.length === exp.outOfPeriod, `out_of_period=${exp.outOfPeriod}`, result.report.out_of_period_ids.length) && ok;
  }
  if (exp.headerMismatch) {
    const mism = (result.report.header_comparisons ?? []).filter((h) => h.evidence_state === "mismatch");
    ok = check(c.case_id, mism.length > 0, `header mismatch present`, mism.length) && ok;
  }
  if (exp.severe) {
    const codes = (result.report.anomalies ?? []).map((a) => a.code);
    ok = check(c.case_id, codes.includes("SEVERE_INTEGRITY_CONFLICT"), `SEVERE_INTEGRITY_CONFLICT`, codes) && ok;
  }

  if (ok) pass++;
}

console.log(`battery: ${pass}/${CASES.length} pass, ${fail} assertion failures`);
if (failures.length > 0) {
  console.log("failures:");
  for (const f of failures.slice(0, 20)) console.log(`  ${f}`);
  process.exit(1);
}
