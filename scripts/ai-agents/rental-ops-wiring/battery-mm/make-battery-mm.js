/**
 * Maintenance Manager battery authoring tool: builds
 * battery-mm/cases-mm.json (80 frozen cases) and pins
 * battery-mm/manifest-mm.json. Expectations for domain/coverage
 * cases are computed by battery-mm/oracle-mm.js (an independent
 * implementation of the brief's P2a-2 rules); adversarial cases carry
 * literal expected outcomes. Never imports the evaluator.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = { mode: "SYNTHETIC_PREVIEW", adapter_kind: "synthetic", registered_principal: "host:workbench-operator", registered_owner: "owner-a", registered_portfolio: "portfolio-a" };
const REQUEST = {
  principal_ref: "host:workbench-operator", owner_ref: "owner-a", portfolio_ref: "portfolio-a",
  job_kind: "maintenance-manager-backlog-review", job_version: 1,
  as_of: "2026-10-22T14:00:00.000Z", window: { name: "maintenance-backlog-open" }, snapshot_request_id: "snap-mm-battery",
};
const CLOCK = "2026-10-22T13:55:00.000Z";

const P = (over = {}) => ({ property_ref: "prop-1", owner_ref: "owner-a", ...over });
const U = (ref, over = {}) => ({ unit_ref: ref, property_ref: "prop-1", owner_ref: "owner-a", status: "occupied", ...over });
const W = (ref, over = {}) => ({
  work_order_ref: ref, request_ref: "req-1", unit_ref: "unit-1", property_ref: "prop-1",
  owner_ref: "owner-a", status: "assigned", created_date: "2026-10-15", priority: "high",
  due_date: null, completed_date: null, ...over,
});
const DS = (over = {}) => ({
  properties: [P()], units: [U("unit-1")], leases: [], memberships: [], charges: [], schedules: [], work_orders: [], ...over,
});
const kase = (id, category, datasets, expect, extra = {}) => ({
  id, category, datasets, host: HOST, request: REQUEST, clock_iso: CLOCK, expect, ...extra,
});
const oracle = { outcome: "COMPLETED", oracle: true };
const lit = (outcome, extra = {}) => ({ outcome, ...extra });

const cases = [];
/* ---------------- domain (oracle-checked) ---------------- */
cases.push(kase("D01", "domain", DS({ work_orders: [W("wo-1", { created_date: "2026-10-22" })] }), oracle));
cases.push(kase("D02", "domain", DS({ work_orders: [W("wo-1", { created_date: "2026-10-15" })] }), oracle));
cases.push(kase("D03", "domain", DS({ work_orders: [W("wo-1", { created_date: "2026-10-14" })] }), oracle));
cases.push(kase("D04", "domain", DS({ work_orders: [W("wo-1", { created_date: "2026-09-22" })] }), oracle));
cases.push(kase("D05", "domain", DS({ work_orders: [W("wo-1", { created_date: "2026-09-21" })] }), oracle));
cases.push(kase("D06", "domain", DS({ work_orders: [W("wo-1", { created_date: "2026-07-24" })] }), oracle));
cases.push(kase("D07", "domain", DS({ work_orders: [W("wo-1", { created_date: "2026-07-23" })] }), oracle));
cases.push(kase("D08", "domain", DS({ work_orders: [W("wo-1", { due_date: "2026-10-21" })] }), oracle));
cases.push(kase("D09", "domain", DS({ work_orders: [W("wo-1", { due_date: "2026-10-22" })] }), oracle));
cases.push(kase("D10", "domain", DS({ work_orders: [W("wo-1", { due_date: null })] }), oracle));
cases.push(kase("D11", "domain", DS({
  work_orders: [W("wo-1", { status: "draft" }), W("wo-2", { status: "in_progress" }), W("wo-3", { status: "scheduled" })],
}), oracle));
cases.push(kase("D12", "domain", DS({ work_orders: [W("wo-1", { status: "completed" })] }), oracle));
cases.push(kase("D13", "domain", DS({ work_orders: [W("wo-1", { status: "teleported" })] }), oracle));
cases.push(kase("D14", "domain", DS({ work_orders: [W("wo-1", { created_date: undefined })] }), oracle));
cases.push(kase("D15", "domain", DS({ work_orders: [W("wo-1", { unit_ref: "unit-ghost", request_ref: "req-orphan" })] }), oracle));
cases.push(kase("D16", "domain", DS({
  work_orders: [W("wo-1", { priority: "urgent" }), W("wo-2", { priority: "P1" }), W("wo-3", { priority: undefined })],
}), oracle));
cases.push(kase("D17", "domain", DS({ work_orders: [W("wo-1", { priority: "EMERGENCY" })] }), oracle));
cases.push(kase("D18", "domain", DS({ work_orders: [W("wo-1", { due_date: "tomorrow" })] }), oracle));
cases.push(kase("D19", "domain", DS({}), oracle));
cases.push(kase("D20", "domain", DS({
  work_orders: [
    W("wo-1", { created_date: "2026-10-01", due_date: "2026-10-20", priority: "urgent" }),
    W("wo-2", { status: "in_progress", created_date: "2026-06-01", priority: "low", due_date: "2026-12-01" }),
    W("wo-3", { status: "cancelled", created_date: "2026-01-01" }),
  ],
}), oracle));

/* ---------------- coverage / evidence ---------------- */
cases.push(kase("C01", "coverage", DS({}), lit("COMPLETED", { oracle: true })));
cases.push(kase("C02", "coverage", DS({ work_orders: [W("wo-1")] }), lit("COMPLETED", { oracle: true }), { faults: { failDataset: "work_orders" } }));
cases.push(kase("C03", "coverage", DS({ work_orders: [W("wo-1")] }), lit("COMPLETED", { oracle: true }), { faults: { failDataset: "units" } }));
cases.push(kase("C04", "coverage", DS({ work_orders: [W("wo-1")] }), lit("COMPLETED", { oracle: true }), { faults: { mixedRevisions: true } }));
cases.push(kase("C05", "coverage", DS({
  work_orders: [W("wo-1", { priority: "high" }), W("wo-1", { priority: "low" })],
}), lit("COMPLETED", { oracle: true })));
cases.push(kase("C06", "coverage", DS({ work_orders: [W("wo-1")] }), lit("COMPLETED", { oracle: true }), { clock_iso: "2026-10-22T13:38:00.000Z" }));
cases.push(kase("C07", "coverage", DS({ work_orders: [{ unit_ref: "unit-1", owner_ref: "owner-a", status: "assigned" }] }), lit("COMPLETED", { oracle: true })));
cases.push(kase("C08", "coverage", DS({ work_orders: [W("wo-1")] }), lit("COMPLETED", { oracle: true }), { faults: { hideExpected: true } }));
cases.push(kase("C09", "coverage", DS({ work_orders: [W("wo-1")] }), lit("COMPLETED", { oracle: true }), { faults: { cursorLoopDataset: "work_orders" } }));
cases.push(kase("C10", "coverage", DS({ work_orders: [W("wo-1")] }), lit("REFUSED", { code: "CONTROL_DATA_REFUSED" }), { faults: { getterCanaryDataset: "work_orders" } }));
cases.push(kase("C11", "coverage", DS({ work_orders: [W("wo-1")] }), lit("REFUSED", { code: "CONTROL_DATA_REFUSED" }), { faults: { proxyRowDataset: "work_orders" } }));
cases.push(kase("C12", "coverage", DS({ work_orders: [W("wo-1")] }), lit("REFUSED", { code: "CONTROL_DATA_REFUSED" }), { faults: { cyclicRowDataset: "work_orders" } }));
cases.push(kase("C13", "coverage", DS({ work_orders: [W("wo-1", { due_date: "2026-10-21" })] }), lit("COMPLETED", { oracle: true }), { special: "tamper-digest" }));
cases.push(kase("C14", "coverage", DS({ work_orders: [W("wo-1")] }), lit("COMPLETED", { oracle: true }), { special: "republish-conflict" }));
cases.push(kase("C15", "coverage", DS({ work_orders: [W("wo-1")] }), lit("THROWS"), { special: "publisher-failure" }));
cases.push(kase("C16", "coverage", DS({ work_orders: [W("wo-1")] }), lit("COMPLETED", { status: "PARTIAL" }), { faults: { blockedDataset: "work_orders" } }));
cases.push(kase("C17", "coverage", DS({ work_orders: [W("wo-1")] }), lit("COMPLETED", { oracle: true }), { faults: { slowReadMs: 100 } }));
cases.push(kase("C18", "coverage", DS({
  work_orders: [W("wo-1", { status: "<script>alert(1)</script>" }), W("wo-\";DROP", { status: "assigned" })],
}), lit("COMPLETED", { integrity_includes: ["WO_STATUS_UNSUPPORTED"], item_contains: ["<script>alert(1)</script>", "wo-\";DROP"] })));
cases.push(kase("C19", "coverage", DS({
  properties: [P({ property_ref: "prop-1", owner_ref: "owner-a" }), P({ property_ref: "prop-1", owner_ref: "owner-b" })],
  units: [U("unit-1"), { ...U("unit-1"), owner_ref: "owner-b" }],
  work_orders: [W("wo-1"), { ...W("wo-1"), owner_ref: "owner-b", priority: "low" }],
}), lit("COMPLETED", { oracle: true })));
cases.push(kase("C20", "coverage", DS({
  work_orders: [W("wo-1", { property_ref: "prop-ghost" }), W("wo-2", { completed_date: "not-a-date" })],
}), lit("COMPLETED", { oracle: true })));

/* ---------------- scope / capability ---------------- */
cases.push(kase("S01", "scope", DS({ work_orders: [W("wo-1")] }), lit("REFUSED", { code: "SCOPE_VIOLATION" }), { request: { ...REQUEST, owner_ref: "owner-b" } }));
cases.push(kase("S02", "scope", DS({}), lit("REFUSED", { code: "PRINCIPAL_MISMATCH" }), { request: { ...REQUEST, principal_ref: "mallory" } }));
cases.push(kase("S03", "scope", DS({
  properties: [P(), { ...P(), owner_ref: "owner-b" }],
  units: [U("unit-1"), { ...U("unit-1"), owner_ref: "owner-b" }],
  work_orders: [W("wo-1"), { ...W("wo-1"), owner_ref: "owner-b", priority: "low" }],
}), lit("REFUSED", { code: "SCOPE_VIOLATION" }), { faults: { leakyOwners: true } }));
cases.push(kase("S04", "scope", DS({}), lit("REFUSED", { code: "PERMISSION_REVOKED" }), { faults: { revoked: true } }));
cases.push(kase("S05", "scope", DS({}), lit("REFUSED", { code: "STALE_SESSION" }), { faults: { staleSession: true } }));
cases.push(kase("S06", "scope", DS({ work_orders: [W("wo-1")] }), lit("DISABLED"), { host: { ...HOST, mode: "DISABLED" } }));
cases.push(kase("S07", "scope", DS({}), lit("ACTIVATION_REQUIRED"), { callerAsk: "live" }));
cases.push(kase("S08", "scope", DS({}), lit("REFUSED", { code: "CALLER_ADAPTER_REFUSED" }), { callerAdapter: {} }));
cases.push(kase("S09", "scope", DS({}), lit("REFUSED", { code: "UNKNOWN_AGENT" }), { request: { ...REQUEST, job_kind: "janitor-nightly" } }));
cases.push(kase("S10", "scope", DS({}), lit("REFUSED", { code: "BAD_REQUEST" }), { request: { ...REQUEST, window: { name: "nope" } } }));
cases.push(kase("S11", "scope", DS({}), lit("REFUSED", { code: "BAD_REQUEST" }), { request: { ...REQUEST, mode: "LIVE" } }));
cases.push(kase("S12", "scope", DS({}), lit("REFUSED", { code: "BAD_REQUEST" }), { request: { ...REQUEST, as_of: "2026-10-22" } }));
cases.push(kase("S13", "scope", DS({}), lit("REFUSED", { code: "PORTFOLIO_UNREGISTERED" }), { request: { ...REQUEST, portfolio_ref: "portfolio-evil" } }));
cases.push(kase("S14", "scope", DS({}), lit("REFUSED", { code: "ADAPTER_NOT_INSTALLED" }), { host: { ...HOST, adapter_kind: "postgres" } }));
cases.push(kase("S15", "scope", DS({}), lit("REFUSED", { code: "BAD_REQUEST" }), { request: { ...REQUEST, job_version: 2 } }));
cases.push(kase("S16", "scope", DS({}), lit("COMPLETED", { oracle: true })));
cases.push(kase("S17", "scope", DS({}), lit("REFUSED", { code: "BAD_REQUEST" }), { request: { ...REQUEST, snapshot_request_id: "" } }));
cases.push(kase("S18", "scope", DS({ work_orders: [W("wo-1")] }), lit("COMPLETED", { report_kind: "property-manager-daily-exception-review" }), {
  request: { ...REQUEST, job_kind: "property-manager-daily-exception-review", window: { name: "lease-expiration-60d" } },
}));
cases.push(kase("S19", "scope", DS({ work_orders: [W("wo-1")] }), lit("REFUSED", { code: "UNKNOWN_MODE" }), { host: { ...HOST, mode: "MAYBE" } }));
cases.push(kase("S20", "scope", DS({ work_orders: [W("wo-1")] }), lit("ACTIVATION_REQUIRED"), { host: { ...HOST, mode: "LIVE" } }));

/* ---------------- budget / durability / security ---------------- */
const fillerWOs = (n, over = {}) => Array.from({ length: n }, (_, i) => W(`wo-f${i}`, { due_date: "2026-11-01", ...over }));
// MM budget calibration (3 datasets: properties, units, work_orders):
// candidates = 3 pages + rows; output records = 21 + 5 per work order
// (row + 2 evidence spans + recommendation + envelope share). The
// candidate cap (64) and the output-record cap (256) bind together:
// 47 work orders is the largest completion under both (52 candidates,
// 256 output records would tip at 48).
cases.push(kase("B01", "budget", DS({ work_orders: fillerWOs(47) }), oracle));
cases.push(kase("B02", "budget", DS({ work_orders: fillerWOs(60) }), lit("BUDGET_EXCEEDED", { kind: "candidates" })));
cases.push(kase("B03", "budget", DS({ work_orders: [W("wo-1", { status: "x".repeat(300000) })] }), lit("BUDGET_EXCEEDED", { kind: "inputBytes" })));
const nest = (n) => (n === 0 ? 1 : { a: nest(n - 1) });
cases.push(kase("B04", "budget", DS({ work_orders: [W("wo-1", { priority: nest(20) })] }), lit("BUDGET_EXCEEDED", { kind: "depth" })));
cases.push(kase("B05", "budget", DS({ work_orders: [W("wo-1")] }), lit("REFUSED", { code: "CONTROL_DATA_REFUSED" }), { faults: { getterCanaryDataset: "properties" } }));
cases.push(kase("B06", "budget", DS({ work_orders: [W("wo-1")] }), lit("REFUSED", { code: "EXECUTION_TIMEOUT" }), { faults: { syncSpinMs: 6000 } }));
cases.push(kase("B07", "budget", DS({ work_orders: [W("wo-1")] }), lit("COMPLETED", { status: "PARTIAL" }), { faults: { blockedDataset: "units" } }));
cases.push(kase("B08", "budget", DS({ work_orders: fillerWOs(40) }), lit("BUDGET_EXCEEDED", { kind: "candidates" }), { faults: { pageSize: 1 } }));
cases.push(kase("B09", "budget", DS({ work_orders: [W(`wo-${"x".repeat(60000)}`)] }), lit("BUDGET_EXCEEDED", { kind: "outputBytes" })));
const manyUnits = [];
for (let i = 0; i < 10; i++) manyUnits.push(U(`unit-${i}`));
const manyWOs = [];
for (let i = 0; i < 10; i++) manyWOs.push(W(`wo-m${i}`, { unit_ref: `unit-${i}`, created_date: "2026-09-01", priority: i % 2 ? "low" : "high" }));
cases.push(kase("B10", "budget", DS({ units: manyUnits, work_orders: manyWOs }), oracle));
cases.push(kase("B11", "budget", DS({ work_orders: [W("wo-1", { due_date: "2026-10-20" })] }), lit("COMPLETED", { oracle: true }), { special: "republish-conflict" }));
cases.push(kase("B12", "budget", DS({
  work_orders: [W("wo-1", { status: "<img src=x onerror=alert(1)>", due_date: "2026-10-20" })],
}), lit("COMPLETED", { integrity_includes: ["WO_STATUS_UNSUPPORTED"], item_contains: ["<img src=x onerror=alert(1)>"] })));
cases.push(kase("B13", "budget", DS({ work_orders: [W("wo-1")] }), lit("COMPLETED", { oracle: true }), { special: "tamper-digest" }));
cases.push(kase("B14", "budget", DS({ work_orders: [W("wo-1")] }), lit("THROWS"), { special: "publisher-failure" }));
cases.push(kase("B15", "budget", DS({ work_orders: [W("wo-1", { priority: "URGENT" })] }), oracle));
cases.push(kase("B16", "budget", DS({ work_orders: [W("wo-1"), W("wo-1")] }), oracle));
cases.push(kase("B17", "budget", DS({ work_orders: [W("wo-1", { created_date: "2026-10-23" })] }), oracle));
cases.push(kase("B18", "budget", DS({ work_orders: [W("wo-1", { due_date: "2026-10-22", status: "completed" })] }), oracle));
cases.push(kase("B19", "budget", DS({ work_orders: fillerWOs(40) }), lit("COMPLETED", { oracle: true }), { faults: { pageSize: 7 } }));
cases.push(kase("B20", "budget", DS({ work_orders: [W("wo-1", { request_ref: "x".repeat(300000) })] }), lit("BUDGET_EXCEEDED", { kind: "inputBytes" })));

if (cases.length !== 80) throw new Error(`battery must hold exactly 80 cases, got ${cases.length}`);
const counts = {};
for (const c of cases) counts[c.category] = (counts[c.category] ?? 0) + 1;
for (const cat of ["domain", "coverage", "scope", "budget"]) {
  if (counts[cat] !== 20) throw new Error(`category ${cat} must hold 20 cases, got ${counts[cat]}`);
}

writeFileSync(join(HERE, "cases-mm.json"), `${JSON.stringify(cases, null, 2)}\n`);
const manifest = {
  schema: "rental-ops-battery-manifest@1",
  cases: cases.length,
  files: {
    "cases-mm.json": createHash("sha256").update(readFileSync(join(HERE, "cases-mm.json"))).digest("hex"),
    "oracle-mm.js": createHash("sha256").update(readFileSync(join(HERE, "oracle-mm.js"))).digest("hex"),
  },
};
writeFileSync(join(HERE, "manifest-mm.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`battery frozen: ${cases.length} cases (${JSON.stringify(counts)})`);
