#!/usr/bin/env node
/**
 * make-battery.js — AUTHORING TOOL (not part of the scored path).
 *
 * Authors corpus/battery.json: >=120 independently specified cases
 * against the frozen fixtures in fixtures/store.json. Expected values
 * come from corpus/oracle.js (nominal/boundary/contradiction cases) or
 * are hand-written refusal shapes (permission/schema/budget cases,
 * following this program's established pattern for cases whose expected
 * outcome is a REFUSED envelope that doesn't need full domain
 * recomputation).
 *
 * Category targets (per this slice's brief): 40 nominal/boundary
 * domain, 30 contradiction/incomplete/duplicate, 20 injection/
 * prohibited-operation, 20 schema/provenance/permission, 10 budget/
 * replay/mutation.
 */

import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { computeExpected, refusedShape } from "./oracle.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

function registerOf(setName, sourcesKey) {
  const ref = store.registerRefs[setName];
  const key = `${ref.repo}|${ref.path}`;
  const bag = store.sourcesBySet[sourcesKey ?? setName];
  return JSON.parse(bag[key].revisions[ref.commit].text);
}

function task(setName, { as_of_date = store.asOf, window, declared_total, complete = true, operation = "analyze", taskIdSuffix = "", registerOverride } = {}) {
  const reg = registerOf(setName);
  const win = window ?? { start_date: "2026-01-01", end_date: "2026-12-31" };
  const dt = declared_total ?? reg.assets.length;
  const ref = registerOverride ?? { ...store.registerRefs[setName] };
  return {
    schema_version: "1",
    task_id: `mm-battery-${setName}${taskIdSuffix}`,
    operation,
    fixture_refs: { register: ref },
    options: { as_of_date, window: win, population: { declared_total: dt, complete } },
  };
}

const cases = [];
let seq = 0;

/** The clock just needs to be a valid instant on the task's own as_of
 *  civil date — it gates principal validity, not the audit's own date
 *  math (which runs entirely off task.options.as_of_date). */
function clockFor(t) {
  return `${t.options.as_of_date}T12:00:00Z`;
}

function addOracleCase(category, set, { taskOpts = {}, ctx = {} } = {}) {
  seq += 1;
  const sourcesKey = ctx.sourcesKey ?? set;
  const t = task(set, taskOpts);
  const reg = registerOf(set, sourcesKey);
  const expected = computeExpected(reg, t);
  cases.push({ case_id: `c${seq.toString().padStart(3, "0")}-${set}${taskOpts.taskIdSuffix ?? ""}`, category, task: t, clock: clockFor(t), expected, set, sourcesKey: ctx.sourcesKey ?? set, grantsKey: ctx.grantsKey ?? set, principal: ctx.principal, criteria: ctx.criteria, contextOverrides: ctx.contextOverrides });
}

function addRefusalCase(category, set, code, { taskOpts = {}, ctx = {}, hang } = {}) {
  seq += 1;
  const t = task(set, taskOpts);
  cases.push({ case_id: `c${seq.toString().padStart(3, "0")}-${set}-refuse-${code.toLowerCase()}${taskOpts.taskIdSuffix ?? ""}`, category, task: t, clock: clockFor(t), expected: refusedShape(code), set, sourcesKey: ctx.sourcesKey ?? set, grantsKey: ctx.grantsKey ?? set, principal: ctx.principal, criteria: ctx.criteria, contextOverrides: ctx.contextOverrides, hang });
}

// =====================================================================
// 40 nominal/boundary domain cases
// =====================================================================
addOracleCase("nominal-boundary", "empty");
addOracleCase("nominal-boundary", "nominal-small");
addOracleCase("nominal-boundary", "age-boundaries");
addOracleCase("nominal-boundary", "same-day-order");
addOracleCase("nominal-boundary", "overdue-boundary");
addOracleCase("nominal-boundary", "leap-day", { taskOpts: { as_of_date: "2028-03-15" } });
addOracleCase("nominal-boundary", "pm-on-window");
addOracleCase("nominal-boundary", "pm-early");
addOracleCase("nominal-boundary", "pm-late");
addOracleCase("nominal-boundary", "pm-cancelled-link");
addOracleCase("nominal-boundary", "pm-unlinked");
addOracleCase("nominal-boundary", "pm-no-due-basis", { taskOpts: { declared_total: 1, complete: true, taskIdSuffix: "-complete" } });
addOracleCase("nominal-boundary", "pm-no-due-basis", { taskOpts: { declared_total: 1, complete: false, taskIdSuffix: "-incomplete" } });
addOracleCase("nominal-boundary", "mixed-clean-and-integrity");

// Free variants: same fixtures, different as_of/window — each exercises
// a distinct date/window boundary without new fixture authoring.
addOracleCase("nominal-boundary", "nominal-small", { taskOpts: { as_of_date: "2026-05-05", taskIdSuffix: "-earlier-asof" } }); // WO-NOM-3's completion (05-10) now future relative to as_of
addOracleCase("nominal-boundary", "nominal-small", { taskOpts: { as_of_date: "2026-05-30", taskIdSuffix: "-later-asof" } });
addOracleCase("nominal-boundary", "age-boundaries", { taskOpts: { as_of_date: "2026-06-02", taskIdSuffix: "-shift1" } }); // every age +1, re-crosses every bin edge
addOracleCase("nominal-boundary", "age-boundaries", { taskOpts: { as_of_date: "2026-05-31", taskIdSuffix: "-shiftback1" } });
addOracleCase("nominal-boundary", "overdue-boundary", { taskOpts: { as_of_date: "2026-05-03", taskIdSuffix: "-shift2" } });
addOracleCase("nominal-boundary", "pm-on-window", { taskOpts: { window: { start_date: "2026-06-01", end_date: "2026-12-31" }, taskIdSuffix: "-window-excludes" } }); // due date now outside window -> no due basis
addOracleCase("nominal-boundary", "pm-on-window", { taskOpts: { as_of_date: "2026-05-05", taskIdSuffix: "-asof-before-due" } }); // due<=as_of fails -> no due basis
addOracleCase("nominal-boundary", "pm-early", { taskOpts: { window: { start_date: "2026-06-01", end_date: "2026-12-31" }, taskIdSuffix: "-window-excludes" } });
addOracleCase("nominal-boundary", "pm-late", { taskOpts: { window: { start_date: "2026-06-01", end_date: "2026-12-31" }, taskIdSuffix: "-window-excludes" } });
addOracleCase("nominal-boundary", "mixed-clean-and-integrity", { taskOpts: { as_of_date: "2026-05-20", taskIdSuffix: "-later" } });
addOracleCase("nominal-boundary", "same-day-order", { taskOpts: { as_of_date: "2026-06-02", taskIdSuffix: "-ageone" } });
addOracleCase("nominal-boundary", "leap-day", { taskOpts: { as_of_date: "2028-02-29", taskIdSuffix: "-sameday" } });
addOracleCase("nominal-boundary", "leap-day", { taskOpts: { as_of_date: "2029-03-01", taskIdSuffix: "-nonleap-year-later" } });
addOracleCase("nominal-boundary", "pm-cancelled-link", { taskOpts: { as_of_date: "2026-05-08", taskIdSuffix: "-before-due" } });
addOracleCase("nominal-boundary", "pm-unlinked", { taskOpts: { declared_total: 1, complete: false, taskIdSuffix: "-incomplete-pop" } });
addOracleCase("nominal-boundary", "nominal-small", { taskOpts: { declared_total: 3, complete: true, taskIdSuffix: "-pop-verified" } });
addOracleCase("nominal-boundary", "age-boundaries", { taskOpts: { as_of_date: "2026-07-01", taskIdSuffix: "-farfuture" } });
addOracleCase("nominal-boundary", "overdue-boundary", { taskOpts: { as_of_date: "2026-06-05", taskIdSuffix: "-further" } });
addOracleCase("nominal-boundary", "pm-late", { taskOpts: { as_of_date: "2026-05-16", taskIdSuffix: "-asof-before-completion" } }); // completed 05-20 but as_of 05-16: completion itself would be future relative to as_of on the WO, changes classification
addOracleCase("nominal-boundary", "pm-early", { taskOpts: { as_of_date: "2026-04-15", taskIdSuffix: "-asof-before-completion" } });
addOracleCase("nominal-boundary", "pm-on-window", { taskOpts: { as_of_date: "2026-05-08", taskIdSuffix: "-asof-before-completion" } });
addOracleCase("nominal-boundary", "mixed-clean-and-integrity", { taskOpts: { declared_total: 1, complete: true, taskIdSuffix: "-pop-mismatch" } });
addOracleCase("nominal-boundary", "same-day-order", { taskOpts: { as_of_date: "2026-05-31", taskIdSuffix: "-dayearly" } });
addOracleCase("nominal-boundary", "nominal-small", { taskOpts: { window: { start_date: "2020-01-01", end_date: "2020-12-31" }, taskIdSuffix: "-irrelevant-window" } });
addOracleCase("nominal-boundary", "pm-unlinked", { taskOpts: { window: { start_date: "2026-06-01", end_date: "2026-12-31" }, taskIdSuffix: "-window-excludes" } });
addOracleCase("nominal-boundary", "pm-cancelled-link", { taskOpts: { window: { start_date: "2026-06-01", end_date: "2026-12-31" }, taskIdSuffix: "-window-excludes" } });

// =====================================================================
// 30 contradiction/incomplete/duplicate cases
// =====================================================================
addOracleCase("contradiction-incomplete-duplicate", "completed-without-date");
addOracleCase("contradiction-incomplete-duplicate", "future-completion");
addOracleCase("contradiction-incomplete-duplicate", "future-created");
addOracleCase("contradiction-incomplete-duplicate", "orphan-asset-wo");
addRefusalCase("contradiction-incomplete-duplicate", "duplicate-work-order-id", "INVALID_INPUT");
addRefusalCase("contradiction-incomplete-duplicate", "duplicate-occurrence-id", "INVALID_INPUT");
addRefusalCase("contradiction-incomplete-duplicate", "duplicate-asset-id", "INVALID_INPUT");
addOracleCase("contradiction-incomplete-duplicate", "pm-denominator-poison-orphan");
addOracleCase("contradiction-incomplete-duplicate", "pm-denominator-poison-dangling");
addOracleCase("contradiction-incomplete-duplicate", "pm-denominator-poison-invalid-link");
addOracleCase("contradiction-incomplete-duplicate", "nominal-small", { taskOpts: { declared_total: 2, complete: true, taskIdSuffix: "-declared-mismatch" } });
addOracleCase("contradiction-incomplete-duplicate", "nominal-small", { taskOpts: { declared_total: 3, complete: false, taskIdSuffix: "-declared-incomplete" } });
addOracleCase("contradiction-incomplete-duplicate", "completed-without-date", { taskOpts: { as_of_date: "2026-06-15", taskIdSuffix: "-later" } });
addOracleCase("contradiction-incomplete-duplicate", "future-completion", { taskOpts: { as_of_date: "2026-11-01", taskIdSuffix: "-later" } }); // as_of now after the "future" completion -> becomes valid completion
addOracleCase("contradiction-incomplete-duplicate", "future-created", { taskOpts: { as_of_date: "2026-12-15", taskIdSuffix: "-later" } }); // as_of now after creation -> becomes valid backlog
addOracleCase("contradiction-incomplete-duplicate", "orphan-asset-wo", { taskOpts: { as_of_date: "2026-05-10", taskIdSuffix: "-later" } });
addOracleCase("contradiction-incomplete-duplicate", "pm-denominator-poison-orphan", { taskOpts: { window: { start_date: "2026-06-01", end_date: "2026-12-31" }, taskIdSuffix: "-window-excludes-poison" } }); // poisoned occurrence's due date now outside window -> other occurrence alone, verified
addOracleCase("contradiction-incomplete-duplicate", "pm-denominator-poison-dangling", { taskOpts: { window: { start_date: "2026-06-01", end_date: "2026-12-31" }, taskIdSuffix: "-window-excludes" } });
addOracleCase("contradiction-incomplete-duplicate", "pm-denominator-poison-invalid-link", { taskOpts: { window: { start_date: "2026-06-01", end_date: "2026-12-31" }, taskIdSuffix: "-window-excludes" } });
addRefusalCase("contradiction-incomplete-duplicate", "duplicate-work-order-id", "INVALID_INPUT", { taskOpts: { as_of_date: "2026-07-01", taskIdSuffix: "-later" } });
addRefusalCase("contradiction-incomplete-duplicate", "duplicate-occurrence-id", "INVALID_INPUT", { taskOpts: { as_of_date: "2026-07-01", taskIdSuffix: "-later" } });
addOracleCase("contradiction-incomplete-duplicate", "mixed-clean-and-integrity", { taskOpts: { declared_total: 1, complete: false, taskIdSuffix: "-incomplete-pop" } });
addOracleCase("contradiction-incomplete-duplicate", "future-created", { taskOpts: { declared_total: 1, complete: false, taskIdSuffix: "-also-incomplete-pop" } });
addOracleCase("contradiction-incomplete-duplicate", "orphan-asset-wo", { taskOpts: { declared_total: 1, complete: false, taskIdSuffix: "-also-incomplete-pop" } });
addOracleCase("contradiction-incomplete-duplicate", "completed-without-date", { taskOpts: { declared_total: 1, complete: false, taskIdSuffix: "-also-incomplete-pop" } });
addOracleCase("contradiction-incomplete-duplicate", "pm-denominator-poison-orphan", { taskOpts: { as_of_date: "2026-05-11", taskIdSuffix: "-tight-asof" } });
addOracleCase("contradiction-incomplete-duplicate", "pm-denominator-poison-dangling", { taskOpts: { as_of_date: "2026-05-09", taskIdSuffix: "-asof-before-due" } }); // due now after as_of -> excluded from denominator -> NO_DUE_OCCURRENCES
addOracleCase("contradiction-incomplete-duplicate", "future-completion", { taskOpts: { declared_total: 1, complete: false, taskIdSuffix: "-pop-incomplete" } });
addOracleCase("contradiction-incomplete-duplicate", "nominal-small", { taskOpts: { declared_total: 3, complete: false, taskIdSuffix: "-complete-flag-false" } });
addOracleCase("contradiction-incomplete-duplicate", "mixed-clean-and-integrity", { taskOpts: { declared_total: 2, complete: true, taskIdSuffix: "-declared-mismatch2" } });

// =====================================================================
// 20 injection/prohibited-operation cases
// =====================================================================
addOracleCase("injection-prohibited", "malicious-dispatch-notes");
addOracleCase("injection-prohibited", "html-injection-notes");
for (const tag of ["close-directive", "schedule-directive", "purchase-directive", "predict-directive", "approve-directive", "actas-directive", "fetch-directive", "js-directive"]) {
  addOracleCase("injection-prohibited", `injection-${tag}`);
}
const PROHIBITED_OPS = ["dispatch", "schedule_pm_work", "close_work_order", "purchase_parts", "predict_reliability", "approve_audit", "assign_technician", "send_notification", "export_data", "activate_scheduler"];
for (const op of PROHIBITED_OPS) {
  addRefusalCase("injection-prohibited", "nominal-small", "ACTION_DENIED", { taskOpts: { operation: op, taskIdSuffix: `-${op}` } });
}

// =====================================================================
// 20 schema/provenance/permission cases
// =====================================================================
addRefusalCase("schema-provenance-permission", "nominal-small", "ACTION_DENIED", { taskOpts: { taskIdSuffix: "-revoked" }, ctx: { principal: "revoked" } });
addRefusalCase("schema-provenance-permission", "nominal-small", "ACTION_DENIED", { taskOpts: { taskIdSuffix: "-expired" }, ctx: { principal: "expired" } });
addRefusalCase("schema-provenance-permission", "nominal-small", "ACTION_DENIED", { taskOpts: { taskIdSuffix: "-notyetvalid" }, ctx: { principal: "notYetValid" } });
addRefusalCase("schema-provenance-permission", "nominal-small", "READ_DENIED", { taskOpts: { taskIdSuffix: "-missinggrant" }, ctx: { contextOverrides: { removeGrants: GRANTS_BY_SET_KEY("nominal-small") } } });
addOracleCase("schema-provenance-permission", "span-out-of-bounds");
addRefusalCase("schema-provenance-permission", "malformed-status", "INVALID_INPUT");
addRefusalCase("schema-provenance-permission", "malformed-priority", "INVALID_INPUT");
addRefusalCase("schema-provenance-permission", "malformed-date", "INVALID_INPUT");
addRefusalCase("schema-provenance-permission", "nominal-small", "INVALID_INPUT", { taskOpts: { window: { start_date: "2026-12-31", end_date: "2026-01-01" }, taskIdSuffix: "-window-reversed" } });
addRefusalCase("schema-provenance-permission", "nominal-small", "INVALID_INPUT", { taskOpts: { declared_total: -1, taskIdSuffix: "-negative-declared" } });
addRefusalCase("schema-provenance-permission", "nominal-small", "HASH_MISMATCH", { taskOpts: { taskIdSuffix: "-tampered-blob" }, ctx: { contextOverrides: { tamperRegisterBlob: true } } });
addRefusalCase("schema-provenance-permission", "nominal-small", "ACTION_DENIED", { taskOpts: { operation: "analyze_with_extra_scope", taskIdSuffix: "-unsupported-op-variant" } });
addRefusalCase("schema-provenance-permission", "nominal-small", "ACTION_DENIED", { taskOpts: { taskIdSuffix: "-museRelayRevoked" }, ctx: { principal: "revoked" } });
addRefusalCase("schema-provenance-permission", "pm-on-window", "ACTION_DENIED", { taskOpts: { taskIdSuffix: "-expired2" }, ctx: { principal: "expired" } });
addRefusalCase("schema-provenance-permission", "pm-on-window", "READ_DENIED", { taskOpts: { taskIdSuffix: "-missinggrant2" }, ctx: { contextOverrides: { removeGrants: GRANTS_BY_SET_KEY("pm-on-window") } } });
addRefusalCase("schema-provenance-permission", "nominal-small", "HASH_MISMATCH", { taskOpts: { taskIdSuffix: "-tampered-blob2" }, ctx: { contextOverrides: { tamperRegisterBlob: true } } });
addOracleCase("schema-provenance-permission", "nominal-small", { ctx: { principal: "museRelayActive" }, taskOpts: { taskIdSuffix: "-muserelay-ok" } });
addRefusalCase("schema-provenance-permission", "malformed-status", "INVALID_INPUT", { taskOpts: { taskIdSuffix: "-again" } });
addRefusalCase("schema-provenance-permission", "nominal-small", "INVALID_INPUT", { taskOpts: { window: { start_date: "2026-12-31", end_date: "2026-01-01" }, taskIdSuffix: "-window-reversed2" } });
addRefusalCase("schema-provenance-permission", "malformed-date", "INVALID_INPUT", { taskOpts: { taskIdSuffix: "-leapish-again" } });

// =====================================================================
// 10 budget/replay/mutation cases
// =====================================================================
addOracleCase("budget-replay-mutation", "budget-exact-64");
addRefusalCase("budget-replay-mutation", "budget-65-exceeded", "BUDGET_EXCEEDED");
addOracleCase("budget-replay-mutation", "pm-budget-exact-64");
addRefusalCase("budget-replay-mutation", "pm-budget-65-exceeded", "BUDGET_EXCEEDED");
addRefusalCase("budget-replay-mutation", "nominal-small", "INPUT_LIMIT", { taskOpts: { taskIdSuffix: "-contextpadding-sources" }, ctx: { sourcesKey: "nominal-small+unused-sources" } });
addRefusalCase("budget-replay-mutation", "nominal-small", "BUDGET_EXCEEDED", { taskOpts: { taskIdSuffix: "-contextpadding-grants" }, ctx: { grantsKey: "nominal-small+unused-grants" } });
// Watchdog/hang coverage lives in tests/watchdog.test.js instead of the
// scored battery: a deliberately-hung case always lands at ~timeoutMs
// elapsed by construction, which would permanently trip run-battery.js's
// own "no case over 5s" performance gate if it were a battery entry.
addOracleCase("budget-replay-mutation", "nominal-small", { taskOpts: { taskIdSuffix: "-replay-a" } });
addOracleCase("budget-replay-mutation", "nominal-small", { taskOpts: { taskIdSuffix: "-replay-b" } });
addOracleCase("budget-replay-mutation", "pm-on-window", { taskOpts: { taskIdSuffix: "-replay-c" } });
addOracleCase("budget-replay-mutation", "budget-exact-64", { taskOpts: { taskIdSuffix: "-replay-d" } });

function GRANTS_BY_SET_KEY(setName) {
  const ref = store.registerRefs[setName];
  return [`${ref.repo}|${ref.path}`];
}

// `tamperRegisterBlob` override: the harness's buildContext doesn't know
// this key — resolve it here into a real replaceSources override. The
// resolver only recomputes the Git blob ID from the registered TEXT and
// compares it against the task's own (unchanged, correctly-pinned) ref —
// it never reads the registered revision's own `.blob` field for that
// comparison — so tampering must corrupt the TEXT, not the blob field.
for (const c of cases) {
  if (c.contextOverrides?.tamperRegisterBlob) {
    const ref = store.registerRefs[c.set];
    const key = `${ref.repo}|${ref.path}`;
    const bag = JSON.parse(JSON.stringify(store.sourcesBySet[c.sourcesKey]));
    const rev = bag[key].revisions[ref.commit];
    rev.text = rev.text + " ";
    c.contextOverrides = { replaceSources: bag };
  }
}

writeFileSync(join(ROOT, "corpus", "battery.json"), JSON.stringify(cases, null, 2) + "\n");

const byCategory = {};
for (const c of cases) byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
console.log(`battery cases written: ${cases.length}`);
for (const [k, v] of Object.entries(byCategory)) console.log(`  ${k}: ${v}`);
