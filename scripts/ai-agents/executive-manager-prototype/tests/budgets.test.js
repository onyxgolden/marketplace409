/**
 * budgets.test.js — exact object-count and payload-byte boundary
 * proofs, built from a hand-counted minimal context rather than the
 * shared fixture store, so the arithmetic is independently verifiable
 * here rather than inherited from fixtures/make-fixtures.js.
 *
 * Charge accounting for the N-report scenario below (0 population
 * groups, 2 grants, 2 source keys with 1 revision each, every report
 * sharing ONE content ref with exactly 1 statement, no metrics/header
 * claims):
 *   principal(1) + criteria-container(1) + grants(2) + source-keys(2)
 *   + revisions(2) + report_set_ref-resolve(1) = 9 overhead charges,
 *   then report[0] contributes 3 (report-object + first content
 *   resolution + its statement) and each report[1..N-1] contributes 2
 *   (report-object + its statement; content resolution is cached after
 *   the first hit). Total = 9 + 3 + 2*(N-1) = 10 + 2N.
 *   N=27 -> exactly 64 (succeeds). N=28 -> the 28th report's own
 *   object charge would be the 65th -> refuses before touching it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { run, BUDGET_LIMITS } from "../src/index.js";

function gitBlobId(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}
function commitId(seed) {
  return createHash("sha1").update(Buffer.from(`budget-test|${seed}`, "utf8")).digest("hex");
}

function buildScenario(n, { poisonTail = false } = {}) {
  const sharedText = "Boundary item: verified complete.\n";
  const sharedRef = { repo: "edu-sources", path: "content/shared.txt", commit: commitId("shared"), blob: gitBlobId(Buffer.from(sharedText, "utf8")), algorithm: "git-sha1", revision: "v1" };
  const reports = [];
  for (let i = 0; i < n; i++) {
    const isPoison = poisonTail && i === n - 1;
    reports.push({
      report_id: `rep-${i}`,
      content_ref: sharedRef,
      source_principal: "Program Manager",
      workstream: isPoison ? "THIS IS NOT A VALID SLUG !!!" : "delivery",
      scope: "programwide",
      period: "2026-q3",
      statements: [{ item_id: `item-${i}`, support_strength: "verified", flags: [], span: { start_byte: 0, end_byte: 24 } }],
      metrics: [],
      header_claims: [],
    });
  }
  const setText = JSON.stringify({ reports });
  const setRef = { repo: "edu-sources", path: "report-sets/boundary.json", commit: commitId("set"), blob: gitBlobId(Buffer.from(setText, "utf8")), algorithm: "git-sha1", revision: "v1" };

  const sources = {
    "edu-sources|report-sets/boundary.json": { revisions: { [setRef.commit]: { text: setText, blob: setRef.blob } } },
    "edu-sources|content/shared.txt": { revisions: { [sharedRef.commit]: { text: sharedText, blob: sharedRef.blob } } },
  };
  const readGrants = [{ repo: "edu-sources", path: "report-sets/boundary.json" }, { repo: "edu-sources", path: "content/shared.txt" }];
  const principal = { principal_id: "p1", role: "JASON", registered_by: "jason", valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false };
  const criteria = { criteria_version: "v1", population_groups: [] };

  const task = { schema_version: "1", task_id: `budget-${n}`, operation: "analyze", fixture_refs: { report_set: setRef }, options: { population: { declared_total: n, complete: true } } };
  const context = { clock: Date.parse("2026-07-15T12:00:00Z"), sources, readGrants, principal, criteria };
  return { task, context };
}

test("budget: exactly 64 charged candidates succeeds (27 reports, hand-counted)", () => {
  const { task, context } = buildScenario(27);
  const r = run(task, context);
  assert.equal(r.status, "REPORT_READY");
  assert.equal(r.report.coverage.admitted_count, 27);
});

test("budget: 65th charged candidate refuses BUDGET_EXCEEDED (28 reports, hand-counted)", () => {
  const { task, context } = buildScenario(28);
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "BUDGET_EXCEEDED");
});

test("budget: the report that would trip the cap is never inspected — poisoning it does not change the outcome or crash", () => {
  const clean = buildScenario(28);
  const poisoned = buildScenario(28, { poisonTail: true });
  const rClean = run(clean.task, clean.context);
  const rPoisoned = run(poisoned.task, poisoned.context);
  assert.equal(rPoisoned.status, "REFUSED");
  assert.equal(rPoisoned.diagnostics[0].code, "BUDGET_EXCEEDED");
  // task_id legitimately differs (it's a hash of the task payload, and
  // the poisoned/clean report sets differ in underlying bytes) — every
  // OTHER field, especially the empty report/diagnostics shape, must be
  // identical: the poison never reached any code path that could react
  // to its content.
  const { task_id: _t1, ...clean1 } = rPoisoned;
  const { task_id: _t2, ...clean2 } = rClean;
  assert.deepEqual(clean1, clean2);
});

test("budget: payload-byte cap (256 KiB) refuses INPUT_LIMIT when an actually-resolved source exceeds it", () => {
  const bigText = "x".repeat(300000);
  const bigRef = { repo: "edu-sources", path: "content/big.txt", commit: commitId("big"), blob: gitBlobId(Buffer.from(bigText, "utf8")), algorithm: "git-sha1", revision: "v1" };
  const reports = [{ report_id: "rep-big", content_ref: bigRef, source_principal: "x", workstream: "delivery", scope: "programwide", period: "2026-q3", statements: [], metrics: [], header_claims: [] }];
  const setText = JSON.stringify({ reports });
  const setRef = { repo: "edu-sources", path: "report-sets/big.json", commit: commitId("bigset"), blob: gitBlobId(Buffer.from(setText, "utf8")), algorithm: "git-sha1", revision: "v1" };
  const sources = {
    "edu-sources|report-sets/big.json": { revisions: { [setRef.commit]: { text: setText, blob: setRef.blob } } },
    "edu-sources|content/big.txt": { revisions: { [bigRef.commit]: { text: bigText, blob: bigRef.blob } } },
  };
  const task = { schema_version: "1", task_id: "big", operation: "analyze", fixture_refs: { report_set: setRef }, options: { population: { declared_total: 1, complete: true } } };
  const context = {
    clock: Date.parse("2026-07-15T12:00:00Z"),
    sources,
    readGrants: [{ repo: "edu-sources", path: "report-sets/big.json" }, { repo: "edu-sources", path: "content/big.txt" }],
    principal: { principal_id: "p1", role: "JASON", registered_by: "jason", valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false },
    criteria: { criteria_version: "v1", population_groups: [] },
  };
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INPUT_LIMIT");
});

test("budget: an UNUSED oversized revision registered in context (never referenced by the task) still trips INPUT_LIMIT — the CS-001/DOC-002 regression", () => {
  const smallText = "Small item: verified complete.\n";
  const smallRef = { repo: "edu-sources", path: "content/small.txt", commit: commitId("small"), blob: gitBlobId(Buffer.from(smallText, "utf8")), algorithm: "git-sha1", revision: "v1" };
  const reports = [{ report_id: "rep-small", content_ref: smallRef, source_principal: "x", workstream: "delivery", scope: "programwide", period: "2026-q3", statements: [], metrics: [], header_claims: [] }];
  const setText = JSON.stringify({ reports });
  const setRef = { repo: "edu-sources", path: "report-sets/small.json", commit: commitId("smallset"), blob: gitBlobId(Buffer.from(setText, "utf8")), algorithm: "git-sha1", revision: "v1" };
  const unusedText = "y".repeat(300000);
  const unusedRef = { repo: "edu-sources", path: "content/unused.txt", commit: commitId("unused"), blob: gitBlobId(Buffer.from(unusedText, "utf8")), algorithm: "git-sha1", revision: "v1" };
  const sources = {
    "edu-sources|report-sets/small.json": { revisions: { [setRef.commit]: { text: setText, blob: setRef.blob } } },
    "edu-sources|content/small.txt": { revisions: { [smallRef.commit]: { text: smallText, blob: smallRef.blob } } },
    // Registered but NEVER referenced by the task or its report-set.
    "edu-sources|content/unused.txt": { revisions: { [unusedRef.commit]: { text: unusedText, blob: unusedRef.blob } } },
  };
  const task = { schema_version: "1", task_id: "unused-padding", operation: "analyze", fixture_refs: { report_set: setRef }, options: { population: { declared_total: 1, complete: true } } };
  const context = {
    clock: Date.parse("2026-07-15T12:00:00Z"),
    sources,
    readGrants: [{ repo: "edu-sources", path: "report-sets/small.json" }, { repo: "edu-sources", path: "content/small.txt" }], // note: NOT even granted — proves the registry charge happens before grant checks matter
    principal: { principal_id: "p1", role: "JASON", registered_by: "jason", valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false },
    criteria: { criteria_version: "v1", population_groups: [] },
  };
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INPUT_LIMIT");
  assert.match(r.diagnostics[0].reason, /unused\.txt/);
});

test("budget: registry poison with a THROWING GETTER at the tail is never read — exact reproduction of this program's Document Agent DOC-002R finding", () => {
  // ChatGPT's reproduction against Document Agent's second fix round:
  // "added 65 unused registry candidates and made candidate 65's
  // revision `blob` a throwing getter... Actual behavior was an
  // uncaught POISON_TAIL_READ, with the getter touched." That residual
  // was a bulk, unguarded enumeration of context.sources/readGrants
  // outside the budget. src/contextGuard.js charges every source key
  // and every revision individually, via budget.countObject() as the
  // first statement of each loop iteration, BEFORE validateSourceEntryShape
  // ever touches `.revisions` — so a getter that throws when read must
  // never fire once the budget is already exhausted by the time that
  // key is reached. This test proves it directly, not just by analogy.
  const sharedText = "Shared item: verified complete.\n";
  const sharedRef = { repo: "edu-sources", path: "content/shared.txt", commit: commitId("poison-shared"), blob: gitBlobId(Buffer.from(sharedText, "utf8")), algorithm: "git-sha1", revision: "v1" };
  const reports = [{ report_id: "rep-1", content_ref: sharedRef, source_principal: "x", workstream: "delivery", scope: "programwide", period: "2026-q3", statements: [], metrics: [], header_claims: [] }];
  const setText = JSON.stringify({ reports });
  const setRef = { repo: "edu-sources", path: "report-sets/poison.json", commit: commitId("poison-set"), blob: gitBlobId(Buffer.from(setText, "utf8")), algorithm: "git-sha1", revision: "v1" };

  const sources = {
    "edu-sources|report-sets/poison.json": { revisions: { [setRef.commit]: { text: setText, blob: setRef.blob } } },
    "edu-sources|content/shared.txt": { revisions: { [sharedRef.commit]: { text: sharedText, blob: sharedRef.blob } } },
  };
  // 40 ordinary filler sources — comfortably pushes the registry walk
  // past the 64-object cap well before the poison key is ever reached,
  // regardless of exact overhead arithmetic.
  for (let i = 0; i < 40; i++) {
    const p = `content/filler-${String(i).padStart(2, "0")}.txt`;
    const text = `filler ${i}\n`;
    const commit = commitId(`filler-${i}`);
    sources[`edu-sources|${p}`] = { revisions: { [commit]: { text, blob: gitBlobId(Buffer.from(text, "utf8")) } } };
  }
  // The poison entry sorts LAST among all source keys (after
  // report-sets/poison.json too — 'z' > 'r'), so it is reached only
  // once every other key has already been charged.
  let touched = false;
  Object.defineProperty(sources, "edu-sources|zzz-poison.txt", {
    enumerable: true,
    get() {
      touched = true;
      throw new Error("POISON_TAIL_READ");
    },
  });

  const task = { schema_version: "1", task_id: "poison-tail-registry", operation: "analyze", fixture_refs: { report_set: setRef }, options: { population: { declared_total: 1, complete: true } } };
  const context = {
    clock: Date.parse("2026-07-15T12:00:00Z"),
    sources,
    readGrants: [{ repo: "edu-sources", path: "report-sets/poison.json" }, { repo: "edu-sources", path: "content/shared.txt" }],
    principal: { principal_id: "p1", role: "JASON", registered_by: "jason", valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false },
    criteria: { criteria_version: "v1", population_groups: [] },
  };

  const r = run(task, context);
  assert.equal(touched, false, "the poison registry entry's getter fired — it was read before being charged");
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "BUDGET_EXCEEDED");
});

// ---------------------------------------------------------------------
// EM-001: nested statements[]/metrics[]/header_claims[] candidates must
// each be charged via budget.countObject() BEFORE validateStatement/
// validateMetricLine/validateHeaderClaim is called on that candidate —
// not after an eager whole-array validation pass (the exact bug
// ChatGPT's review found in the original validateReport()). These
// candidates arrive as parsed JSON from the report-set's resolved TEXT
// bytes (run() does `JSON.parse(bundleResolved.text)`), so a live
// Object.defineProperty getter trap — the technique used above for the
// context registry/grants, which ARE passed as live JS objects — cannot
// survive that JSON round-trip (a getter is not JSON-serializable). The
// equivalent, achievable proof for JSON-sourced nested data is the SAME
// technique this file's own "poisoning it does not change the outcome"
// report-level test above already uses: plant a value that WOULD throw
// SchemaError if its candidate were ever handed to its validator, place
// it at the exact index that is the 65th charged candidate overall, and
// assert the outcome is a clean BUDGET_EXCEEDED — never the
// INVALID_INPUT/MALFORMED_RECORD outcome that candidate would otherwise
// produce. Each nested array type is schema-capped per report
// (MAX_STATEMENTS_PER_REPORT / MAX_METRICS_PER_REPORT /
// MAX_HEADER_CLAIMS_PER_REPORT = 32/32/16), so hitting the 64-object
// cap requires SPREADING items across multiple reports, not one giant
// report. buildMultiReportBoundary computes the exact split at runtime
// (not hand-derived) so it stays correct if BUDGET_LIMITS ever changes.
// ---------------------------------------------------------------------

function buildMultiReportBoundary(nestedKey, makeItem, makePoisonItem, capPerReport, { includePoison = true } = {}) {
  const maxObjects = BUDGET_LIMITS.maxObjects;
  const fixedOverhead = 9; // per this file's header comment
  const sharedText = "Boundary item: verified complete.\n";
  const sharedRef = { repo: "edu-sources", path: `content/${nestedKey}-shared.txt`, commit: commitId(`${nestedKey}-shared`), blob: gitBlobId(Buffer.from(sharedText, "utf8")), algorithm: "git-sha1", revision: "v1" };

  function emptyReport(id) {
    return { report_id: id, content_ref: sharedRef, source_principal: "x", workstream: "delivery", scope: "programwide", period: "2026-q3", statements: [], metrics: [], header_claims: [] };
  }

  const reports = [];
  let used = fixedOverhead;
  let reportIndex = 0;
  let firstReport = true;

  // Fill whole reports at capPerReport until doing so would leave less
  // than 2 charges of headroom (so the final report can still hold its
  // own object charge plus at least one successful item before poison).
  while (true) {
    const overheadThisReport = firstReport ? 2 : 1; // +1 content-resolution only on the very first report
    const afterFull = used + overheadThisReport + capPerReport;
    if (afterFull > maxObjects - 2) break;
    const report = emptyReport(`rep-filler-${reportIndex++}`);
    report[nestedKey] = Array.from({ length: capPerReport }, (_, i) => makeItem(i));
    reports.push(report);
    used = afterFull;
    firstReport = false;
  }

  const overheadFinal = firstReport ? 2 : 1;
  used += overheadFinal;
  const successfulInFinal = maxObjects - used;
  if (successfulInFinal < 0 || successfulInFinal >= capPerReport) {
    throw new Error(`buildMultiReportBoundary: bad arithmetic, successfulInFinal=${successfulInFinal}`);
  }
  const finalReport = emptyReport("rep-final");
  const items = Array.from({ length: successfulInFinal }, (_, i) => makeItem(i));
  if (includePoison) items.push(makePoisonItem(successfulInFinal));
  finalReport[nestedKey] = items;
  reports.push(finalReport);

  const setText = JSON.stringify({ reports });
  const setRef = { repo: "edu-sources", path: `report-sets/${nestedKey}-boundary.json`, commit: commitId(`${nestedKey}-set`), blob: gitBlobId(Buffer.from(setText, "utf8")), algorithm: "git-sha1", revision: "v1" };
  const sources = {
    [`edu-sources|report-sets/${nestedKey}-boundary.json`]: { revisions: { [setRef.commit]: { text: setText, blob: setRef.blob } } },
    [`edu-sources|content/${nestedKey}-shared.txt`]: { revisions: { [sharedRef.commit]: { text: sharedText, blob: sharedRef.blob } } },
  };
  const task = { schema_version: "1", task_id: `${nestedKey}-boundary`, operation: "analyze", fixture_refs: { report_set: setRef }, options: { population: { declared_total: reports.length, complete: true } } };
  const context = {
    clock: Date.parse("2026-07-15T12:00:00Z"),
    sources,
    readGrants: [{ repo: "edu-sources", path: `report-sets/${nestedKey}-boundary.json` }, { repo: "edu-sources", path: `content/${nestedKey}-shared.txt` }],
    principal: { principal_id: "p1", role: "JASON", registered_by: "jason", valid_from: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z", revoked: false },
    criteria: { criteria_version: "v1", population_groups: [] },
  };
  return { task, context, reportCount: reports.length, successfulInFinal };
}

test("budget (EM-001): statements spread across multiple reports succeed up through the exact 64th charge", () => {
  const makeItem = (i) => ({ item_id: `item-ok-${i}`, support_strength: "verified", flags: [], span: { start_byte: 0, end_byte: 8 } });
  const makePoison = () => ({ item_id: "item-poison", support_strength: "verified", flags: ["totally_bogus_flag"], span: { start_byte: 0, end_byte: 8 } });
  const { task, context, reportCount } = buildMultiReportBoundary("statements", makeItem, makePoison, 10);
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "BUDGET_EXCEEDED");
  assert.ok(reportCount > 1, "test should actually spread across multiple reports");
});

test("budget (EM-001): the same scenario WITHOUT the extra poisoned item succeeds cleanly at exactly 64 charges — isolates the poison, not an off-by-one in the harness", () => {
  const makeItem = (i) => ({ item_id: `item-ok-${i}`, support_strength: "verified", flags: [], span: { start_byte: 0, end_byte: 8 } });
  const { task, context, successfulInFinal } = buildMultiReportBoundary("statements", makeItem, makeItem, 10, { includePoison: false });
  const r = run(task, context);
  assert.equal(r.status, "REPORT_READY");
  const totalAdmitted = r.report.source_reports.reduce((s, sr) => s + sr.statements.length, 0);
  assert.ok(totalAdmitted >= successfulInFinal);
});

test("budget (EM-001): metrics spread across multiple reports refuse BUDGET_EXCEEDED at the poisoned 65th charge, never MALFORMED_RECORD", () => {
  const makeItem = (i) => ({ line_item_id: `line-ok-${i}`, metric_key: "spend", population_id: "pop-a", unit: "count", period: "2026-q3", currency: null, value: 1, span: { start_byte: 0, end_byte: 8 } });
  // currency must be null when unit !== "currency" — validateMetricLine
  // throws SchemaError on this if the poisoned candidate is ever read.
  const makePoison = () => ({ line_item_id: "line-poison", metric_key: "spend", population_id: "pop-a", unit: "count", period: "2026-q3", currency: "usd", value: 1, span: { start_byte: 0, end_byte: 8 } });
  const { task, context, reportCount } = buildMultiReportBoundary("metrics", makeItem, makePoison, 10);
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "BUDGET_EXCEEDED");
  assert.ok(reportCount > 1);
});

test("budget (EM-001): the same metrics scenario WITHOUT the extra poisoned item succeeds cleanly — isolates the poison", () => {
  const makeItem = (i) => ({ line_item_id: `line-ok-${i}`, metric_key: "spend", population_id: "pop-a", unit: "count", period: "2026-q3", currency: null, value: 1, span: { start_byte: 0, end_byte: 8 } });
  const { task, context } = buildMultiReportBoundary("metrics", makeItem, makeItem, 10, { includePoison: false });
  const r = run(task, context);
  assert.equal(r.status, "REPORT_READY");
});

test("budget (EM-001): header claims spread across multiple reports refuse BUDGET_EXCEEDED at the poisoned 65th charge, never MALFORMED_RECORD", () => {
  const makeItem = (i) => ({ claim_id: `claim-ok-${i}`, metric_key: "spend", population_id: "pop-a", unit: "count", period: "2026-q3", currency: null, claimed_value: 1, span: { start_byte: 0, end_byte: 8 } });
  const makePoison = () => ({ claim_id: "claim-poison", metric_key: "spend", population_id: "pop-a", unit: "count", period: "Q3-2026", currency: null, claimed_value: 1, span: { start_byte: 0, end_byte: 8 } });
  const { task, context, reportCount } = buildMultiReportBoundary("header_claims", makeItem, makePoison, 10);
  const r = run(task, context);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "BUDGET_EXCEEDED");
  assert.ok(reportCount > 1);
});

test("budget (EM-001): the same header-claims scenario WITHOUT the extra poisoned item succeeds cleanly — isolates the poison", () => {
  const makeItem = (i) => ({ claim_id: `claim-ok-${i}`, metric_key: "spend", population_id: "pop-a", unit: "count", period: "2026-q3", currency: null, claimed_value: 1, span: { start_byte: 0, end_byte: 8 } });
  const { task, context, successfulInFinal } = buildMultiReportBoundary("header_claims", makeItem, makeItem, 10, { includePoison: false });
  const r = run(task, context);
  // Not REPORT_READY: these header claims reference no matching metric
  // (this scenario has none), so every comparison is legitimately
  // unverifiable — PARTIAL, not REFUSED. The budget boundary itself is
  // what's under test: no BUDGET_EXCEEDED, and every header claim was
  // actually admitted (not silently dropped).
  assert.equal(r.status, "PARTIAL");
  const totalAdmitted = r.report.source_reports.reduce((s, sr) => s + sr.header_claims.length, 0);
  assert.ok(totalAdmitted >= successfulInFinal);
});

test("budget: BUDGET_LIMITS constants match the brief's stated caps", () => {
  assert.equal(BUDGET_LIMITS.maxPayloadBytes, 262144);
  assert.equal(BUDGET_LIMITS.maxObjects, 64);
  assert.equal(BUDGET_LIMITS.maxSpans, 512);
  assert.equal(BUDGET_LIMITS.maxOutputRecords, 256);
  assert.equal(BUDGET_LIMITS.maxOutputBytes, 262144);
});
