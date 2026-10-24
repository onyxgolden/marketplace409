/**
 * Battery authoring tool: builds battery/cases.json (80 frozen cases)
 * and pins battery/manifest.json. Expectations for domain/coverage
 * cases are computed by battery/oracle.js (an independent
 * implementation of the brief's rules); adversarial cases carry
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
  job_kind: "property-manager-daily-exception-review", job_version: 1,
  as_of: "2026-10-22T14:00:00.000Z", window: { name: "lease-expiration-60d" }, snapshot_request_id: "snap-battery",
};
const CLOCK = "2026-10-22T13:55:00.000Z";

const P = (over = {}) => ({ property_ref: "prop-1", owner_ref: "owner-a", ...over });
const U = (ref, over = {}) => ({ unit_ref: ref, property_ref: "prop-1", owner_ref: "owner-a", status: "occupied", ...over });
const L = (ref, over = {}) => ({
  lease_ref: ref, unit_ref: "unit-1", property_ref: "prop-1", owner_ref: "owner-a", status: "active",
  start_date: "2026-01-01", end_date: "2027-06-01", monthly_rent_cents: 100000, currency: "USD", ...over,
});
const C = (ref, lease, over = {}) => ({
  charge_ref: ref, lease_ref: lease, schedule_ref: "sch-1", owner_ref: "owner-a", status: "open",
  due_date: "2026-10-01", amount_cents: 10000, paid_amount_cents: 0, currency: "USD", ...over,
});
const S = (ref, lease, over = {}) => ({
  schedule_ref: ref, lease_ref: lease, owner_ref: "owner-a", collection_mode: "forge",
  forge_cutover_date: "2026-01-01", currency: "USD", ...over,
});
const DS = (over = {}) => ({ properties: [P()], units: [U("unit-1")], leases: [], memberships: [], charges: [], schedules: [], ...over });
const kase = (id, category, datasets, expect, extra = {}) => ({
  id, category, datasets, host: HOST, request: REQUEST, clock_iso: CLOCK, expect, ...extra,
});
const oracle = { outcome: "COMPLETED", oracle: true };
const lit = (outcome, extra = {}) => ({ outcome, ...extra });

const cases = [];
/* ---------------- domain (oracle-checked) ---------------- */
cases.push(kase("D01", "domain", DS({ leases: [L("lease-1", { end_date: "2026-10-21" })] }), oracle));
cases.push(kase("D02", "domain", DS({ leases: [L("lease-1", { end_date: "2026-10-22" })] }), oracle));
cases.push(kase("D03", "domain", DS({ leases: [L("lease-1", { end_date: "2026-12-21" })] }), oracle));
cases.push(kase("D04", "domain", DS({ leases: [L("lease-1", { end_date: "2026-12-22" })] }), oracle));
cases.push(kase("D05", "domain", DS({
  units: [U("unit-1"), U("unit-2"), U("unit-3")],
  leases: [L("lease-1", { end_date: "2026-10-24" }), L("lease-2", { unit_ref: "unit-2", end_date: "2026-10-29" }), L("lease-3", { unit_ref: "unit-3", end_date: "2026-11-21" })],
}), oracle));
cases.push(kase("D06", "domain", DS({ leases: [L("lease-1", { end_date: "2026-10-01", flag_in_legal_process: true })] }), oracle));
cases.push(kase("D07", "domain", DS({ leases: [L("lease-1", { status: "ended", end_date: "2026-10-25" })] }), oracle));
cases.push(kase("D08", "domain", DS({ leases: [L("lease-1")], charges: [C("ch-1", "lease-1", { paid_amount_cents: 2500 })], schedules: [S("sch-1", "lease-1")] }), oracle));
cases.push(kase("D09", "domain", DS({ leases: [L("lease-1")], charges: [C("ch-1", "lease-1", { paid_amount_cents: 2500 })], schedules: [S("sch-1", "lease-1", { collection_mode: "external" })] }), oracle));
cases.push(kase("D10", "domain", DS({ leases: [L("lease-1")], charges: [C("ch-1", "lease-1", { due_date: "2025-12-15" })], schedules: [S("sch-1", "lease-1")] }), oracle));
cases.push(kase("D11", "domain", DS({ leases: [L("lease-1")], charges: [C("ch-1", "lease-1")], schedules: [S("sch-1", "lease-1", { forge_cutover_date: "2027-01-01" })] }), oracle));
cases.push(kase("D12", "domain", DS({ leases: [L("lease-1")], charges: [C("ch-1", "lease-1")] }), oracle));
cases.push(kase("D13", "domain", DS({
  leases: [L("lease-1")],
  charges: [C("ch-1", "lease-1", { status: "void" }), C("ch-2", "lease-1", { paid_amount_cents: 10000 }), C("ch-3", "lease-1", { due_date: "2026-11-01" })],
  schedules: [S("sch-1", "lease-1")],
}), oracle));
cases.push(kase("D14", "domain", DS({
  units: [U("unit-1"), U("unit-2")],
  leases: [L("lease-1"), L("lease-2", { unit_ref: "unit-2" })],
  charges: [C("ch-1", "lease-1", { amount_cents: 5000 }), C("ch-2", "lease-2", { amount_cents: 7000, schedule_ref: "sch-2" })],
  schedules: [S("sch-1", "lease-1"), S("sch-2", "lease-2", { collection_mode: "external" })],
}), oracle));
cases.push(kase("D15", "domain", DS({ leases: [L("lease-1")], charges: [C("ch-1", "lease-1"), C("ch-2", "lease-1", { currency: "EUR" })], schedules: [S("sch-1", "lease-1")] }), oracle));
cases.push(kase("D16", "domain", DS({ leases: [L("lease-1")], charges: [C("ch-1", "lease-1", { amount_cents: -5 })], schedules: [S("sch-1", "lease-1")] }), oracle));
cases.push(kase("D17", "domain", DS({ leases: [L("lease-1", { status: "ended" })], charges: [C("ch-1", "lease-1")], schedules: [S("sch-1", "lease-1")] }), oracle));
cases.push(kase("D18", "domain", DS({ leases: [L("lease-1", { end_date: "2026-03-09" })] }), oracle,
  { request: { ...REQUEST, as_of: "2026-03-08T14:00:00.000Z" }, clock_iso: "2026-03-08T13:55:00.000Z" }));
cases.push(kase("D19", "domain", DS({ leases: [L("lease-1", { end_date: "2026-10-31" })] }), oracle,
  { request: { ...REQUEST, as_of: "2026-11-01T07:30:00.000Z" }, clock_iso: "2026-11-01T07:25:00.000Z" }));
cases.push(kase("D20", "domain", DS({ leases: [L("lease-1", { end_date: "2026-10-21" })] }), oracle,
  { request: { ...REQUEST, as_of: "2026-10-22T04:30:00.000Z" }, clock_iso: "2026-10-22T04:25:00.000Z" }));

/* ---------------- coverage ---------------- */
cases.push(kase("C01", "coverage", DS({}), oracle));
cases.push(kase("C02", "coverage", DS({ leases: [L("lease-1", { end_date: "2026-11-01" })] }), oracle, { faults: { failDataset: "leases" } }));
cases.push(kase("C03", "coverage", DS({ leases: [L("lease-1")], charges: [C("ch-1", "lease-1")], schedules: [S("sch-1", "lease-1")] }), oracle, { faults: { failDataset: "charges" } }));
cases.push(kase("C04", "coverage", DS({ leases: [L("lease-1", { end_date: "2026-11-01" })] }), oracle, { faults: { failDataset: "units" } }));
cases.push(kase("C05", "coverage", DS({ leases: [L("lease-1", { end_date: "2026-11-01" })] }), oracle, { faults: { mixedRevisions: true } }));
cases.push(kase("C06", "coverage", DS({ leases: [L("lease-1", { end_date: "2026-11-01" }), L("lease-1", { end_date: "2026-11-01" })] }), oracle));
cases.push(kase("C07", "coverage", DS({
  units: [U("unit-1"), U("unit-1", { status: "vacant" })],
  leases: [L("lease-1", { end_date: "2026-11-01" })],
}), oracle));
cases.push(kase("C08", "coverage", DS({ leases: [L("lease-1", { end_date: "2026-11-01" })] }), oracle, { clock_iso: "2026-10-22T13:00:00.000Z" }));
cases.push(kase("C09", "coverage", DS({ leases: [L("lease-1")] }), lit("REFUSED", { code: "SNAPSHOT_FROM_FUTURE" }), { clock_iso: "2026-10-22T14:30:00.000Z" }));
cases.push(kase("C10", "coverage", DS({ leases: [null, L("lease-1", { end_date: "2026-11-01" })] }), lit("COMPLETED", { status: "PARTIAL" })));
cases.push(kase("C11", "coverage", DS({ units: [{ property_ref: "prop-1", owner_ref: "owner-a", status: "occupied" }], leases: [L("lease-1", { end_date: "2026-11-01" })] }), lit("COMPLETED", { status: "PARTIAL" })));
cases.push(kase("C12", "coverage", DS({ leases: [L("lease-1")], charges: [C("ch-1", "lease-1")], schedules: [S("sch-1", "lease-1")] }), oracle, { faults: { cursorLoopDataset: "charges" } }));
cases.push(kase("C13", "coverage", DS({ leases: [L("lease-1", { end_date: "2026-11-01" })] }), oracle, { faults: { hideExpected: true } }));
cases.push(kase("C14", "coverage", DS({ leases: [L("lease-1", { status: "in-limbo", end_date: "2026-11-01" })] }), oracle));
cases.push(kase("C15", "coverage", DS({ units: [U("unit-1", { status: "hovering" })], leases: [L("lease-1", { end_date: "2026-11-01" })] }), oracle));
cases.push(kase("C16", "coverage", DS({ leases: [L("lease-1", { unit_ref: "unit-ghost", property_ref: "prop-ghost", end_date: "2026-11-01" })] }), oracle));
cases.push(kase("C17", "coverage", DS({ leases: [L("lease-1")], memberships: [{ lease_ref: "lease-ghost", owner_ref: "owner-a" }] }), oracle));
cases.push(kase("C18", "coverage", DS({ leases: [L("lease-1")], charges: [C("ch-1", "lease-ghost")], schedules: [S("sch-1", "lease-1")] }), oracle));
cases.push(kase("C19", "coverage", DS({ leases: [L("lease-1")], charges: [C("ch-1", "lease-1", { due_date: "10/01/2026" })], schedules: [S("sch-1", "lease-1")] }), oracle));
cases.push(kase("C20", "coverage", DS({ leases: [L("lease-1", { end_date: undefined })] }), oracle));

/* ---------------- scope / capability ---------------- */
cases.push(kase("S01", "scope", DS({ leases: [L("lease-1")] }), lit("REFUSED", { code: "SCOPE_VIOLATION" }), { request: { ...REQUEST, owner_ref: "owner-b" } }));
cases.push(kase("S02", "scope", DS({}), lit("REFUSED", { code: "PRINCIPAL_MISMATCH" }), { request: { ...REQUEST, principal_ref: "mallory" } }));
const colliding = DS({
  properties: [P(), P({ owner_ref: "owner-b" })],
  units: [U("unit-1"), U("unit-1", { owner_ref: "owner-b" })],
  leases: [L("lease-1", { end_date: "2026-10-25" }), L("lease-1", { owner_ref: "owner-b", end_date: "2027-06-30" })],
  charges: [C("ch-1", "lease-1", { amount_cents: 5000 })],
  schedules: [S("sch-1", "lease-1")],
});
cases.push(kase("S03", "scope", colliding, lit("REFUSED", { code: "SCOPE_VIOLATION" }), { faults: { leakyOwners: true } }));
cases.push(kase("S04", "scope", colliding, oracle));
cases.push(kase("S05", "scope", colliding, oracle, {
  host: { ...HOST, registered_owner: "owner-b", registered_portfolio: "portfolio-b" },
  request: { ...REQUEST, owner_ref: "owner-b", portfolio_ref: "portfolio-b" },
}));
cases.push(kase("S06", "scope", DS({}), lit("REFUSED", { code: "PERMISSION_REVOKED" }), { faults: { revoked: true } }));
cases.push(kase("S07", "scope", DS({}), lit("REFUSED", { code: "STALE_SESSION" }), { faults: { staleSession: true } }));
cases.push(kase("S08", "scope", DS({ leases: [L("lease-1")] }), lit("REFUSED", { code: "CONTROL_DATA_REFUSED" }), { faults: { getterCanaryDataset: "leases" } }));
cases.push(kase("S09", "scope", DS({}), lit("REFUSED", { code: "CALLER_ADAPTER_REFUSED" }), { callerAdapter: { url: "https://example.invalid" } }));
cases.push(kase("S10", "scope", DS({}), lit("ACTIVATION_REQUIRED"), { callerAsk: "live" }));
cases.push(kase("S11", "scope", DS({}), lit("ACTIVATION_REQUIRED"), { host: { ...HOST, mode: "LIVE" } }));
cases.push(kase("S12", "scope", DS({}), lit("REFUSED", { code: "UNKNOWN_MODE" }), { host: { ...HOST, mode: "TURBO" } }));
cases.push(kase("S13", "scope", DS({}), lit("REFUSED", { code: "UNKNOWN_AGENT" }), { request: { ...REQUEST, job_kind: "tax-agent-review" } }));
cases.push(kase("S14", "scope", DS({}), lit("COMPLETED"), { request: { ...REQUEST, job_kind: "maintenance-manager-backlog-review", window: { name: "maintenance-backlog-open" } } }));
cases.push(kase("S15", "scope", DS({}), lit("REFUSED", { code: "BAD_REQUEST" }), { request: { ...REQUEST, mode: "LIVE" } }));
cases.push(kase("S16", "scope", DS({}), lit("REFUSED", { code: "BAD_REQUEST" }), { request: { ...REQUEST, sql: "select 1" } }));
cases.push(kase("S17", "scope", DS({}), lit("REFUSED", { code: "ADAPTER_NOT_INSTALLED" }), { host: { ...HOST, adapter_kind: "production" } }));
cases.push(kase("S18", "scope", DS({ leases: [L("lease-1")] }), lit("DISABLED"), { host: { ...HOST, mode: "DISABLED" } }));
cases.push(kase("S19", "scope", DS({}), lit("REFUSED", { code: "BAD_REQUEST" }), { request: { ...REQUEST, owner_ref: null } }));
cases.push(kase("S20", "scope", DS({}), lit("REFUSED", { code: "BAD_REQUEST" }), { request: { ...REQUEST, job_version: 2 } }));

/* ---------------- budget / durability / security ---------------- */
const fillerCharges = (n, over = {}) => Array.from({ length: n }, (_, i) => C(`ch-f${i}`, "lease-1", { due_date: "2026-11-01", amount_cents: 100, ...over }));
cases.push(kase("B01", "budget", DS({ leases: [L("lease-1")], charges: fillerCharges(54), schedules: [S("sch-1", "lease-1")] }), oracle));
cases.push(kase("B02", "budget", DS({ leases: [L("lease-1")], charges: fillerCharges(55), schedules: [S("sch-1", "lease-1")] }), lit("BUDGET_EXCEEDED", { kind: "candidates" })));
cases.push(kase("B03", "budget", DS({ leases: [L("lease-1", { status: "x".repeat(300000) })] }), lit("BUDGET_EXCEEDED", { kind: "inputBytes" })));
const nest = (n) => (n === 0 ? 1 : { a: nest(n - 1) });
cases.push(kase("B04", "budget", DS({ leases: [L("lease-1")], charges: [C("ch-1", "lease-1", { amount_cents: nest(20) })], schedules: [S("sch-1", "lease-1")] }), lit("BUDGET_EXCEEDED", { kind: "depth" })));
cases.push(kase("B05", "budget", DS({ leases: [L("lease-1")] }), lit("REFUSED", { code: "CONTROL_DATA_REFUSED" }), { faults: { proxyRowDataset: "leases" } }));
cases.push(kase("B06", "budget", DS({ leases: [L("lease-1")] }), lit("REFUSED", { code: "CONTROL_DATA_REFUSED" }), { faults: { cyclicRowDataset: "units" } }));
cases.push(kase("B07", "budget", DS({ leases: [L("lease-1")], charges: [C("ch-1", "lease-1")], schedules: [S("sch-1", "lease-1")] }), lit("REFUSED", { code: "CONTROL_DATA_REFUSED" }), { faults: { getterCanaryDataset: "charges" } }));
cases.push(kase("B08", "budget", DS({ leases: [L("lease-1")], charges: [C("ch-1", "lease-1")], schedules: [S("sch-1", "lease-1")] }), lit("COMPLETED", { status: "PARTIAL" }), { faults: { blockedDataset: "charges" } }));
cases.push(kase("B09", "budget", DS({ leases: [L("lease-1")] }), lit("COMPLETED", { status: "PARTIAL" }), { faults: { blockedDataset: "leases" } }));
cases.push(kase("B10", "budget", DS({ leases: [L("lease-1")], charges: fillerCharges(40, { due_date: "2026-10-01" }), schedules: [S("sch-1", "lease-1")] }), lit("BUDGET_EXCEEDED", { kind: "candidates" }), { faults: { pageSize: 1 } }));
cases.push(kase("B11", "budget", DS({ leases: [L(`lease-${"x".repeat(60000)}`, { end_date: "2026-11-01" })] }), lit("BUDGET_EXCEEDED", { kind: "outputBytes" })));
cases.push(kase("B12", "budget", DS({
  units: [U("unit-1"), U("unit-2")],
  leases: [L("lease-1", { end_date: "2026-10-20" }), L("lease-2", { unit_ref: "unit-2", end_date: "2026-11-15", flag_in_legal_process: true })],
  charges: [C("ch-1", "lease-1", { amount_cents: 25000, paid_amount_cents: 5000 }), C("ch-2", "lease-2", { amount_cents: 9000, schedule_ref: "sch-2" })],
  schedules: [S("sch-1", "lease-1"), S("sch-2", "lease-2", { collection_mode: "external" })],
  memberships: [{ lease_ref: "lease-1", owner_ref: "owner-a" }, { lease_ref: "lease-1", owner_ref: "owner-a" }],
}), oracle));
cases.push(kase("B13", "budget", DS({ leases: [L("lease-1", { end_date: "2026-11-01" })] }), lit("COMPLETED", { oracle: true }), { special: "republish-conflict" }));
cases.push(kase("B14", "budget", DS({
  leases: [L("lease-1", { status: "<script>alert(1)</script>", end_date: "2026-11-01" }),
    L('lease-";DROP', { end_date: "2026-11-01" })],
}), lit("COMPLETED", { integrity_includes: ["LEASE_STATUS_UNSUPPORTED"], item_contains: ["<script>alert(1)</script>", 'lease-";DROP'] })));
cases.push(kase("B15", "budget", DS({ leases: [L("lease-1", { end_date: "2026-11-01" })] }), lit("COMPLETED", { oracle: true }), { special: "tamper-digest" }));
cases.push(kase("B16", "budget", DS({ leases: [L("lease-1", { end_date: "2026-11-01" })] }), lit("THROWS"), { special: "publisher-failure" }));
cases.push(kase("B17", "budget", DS({}), lit("REFUSED", { code: "BAD_REQUEST" }), { request: { ...REQUEST, as_of: "not-a-date" } }));
cases.push(kase("B18", "budget", DS({}), lit("REFUSED", { code: "BAD_REQUEST" }), { request: { ...REQUEST, snapshot_request_id: "" } }));
// B19: candidate 65 is the schedules PAGE charge itself, and that page
// carries an accessor-bearing row. The charge fires before any walk, so
// the refusal must be BUDGET_EXCEEDED — never CONTROL_DATA_REFUSED and
// the getter must never run. (56 charges put the count at exactly 64
// after the charges page + rows: 2+2+2+1 + 1+56 = 64.)
cases.push(kase("B19", "budget", DS({ leases: [L("lease-1")], charges: fillerCharges(56), schedules: [S("sch-1", "lease-1")] }), lit("BUDGET_EXCEEDED", { kind: "candidates" }), { faults: { getterCanaryDataset: "schedules" } }));
const many = { units: [], leases: [], charges: [], schedules: [S("sch-1", "lease-1")] };
for (let i = 0; i < 14; i++) {
  many.units.push(U(`unit-${i}`));
  many.leases.push(L(`lease-${i}`, { unit_ref: `unit-${i}`, end_date: "2026-11-01" }));
  many.charges.push(C(`ch-${i}`, `lease-${i}`, { amount_cents: 1000 + i }));
}
cases.push(kase("B20", "budget", DS(many), oracle));

if (cases.length !== 80) throw new Error(`battery must hold exactly 80 cases, got ${cases.length}`);
const counts = {};
for (const c of cases) counts[c.category] = (counts[c.category] ?? 0) + 1;
for (const cat of ["domain", "coverage", "scope", "budget"]) {
  if (counts[cat] !== 20) throw new Error(`category ${cat} must hold 20 cases, got ${counts[cat]}`);
}

writeFileSync(join(HERE, "cases.json"), `${JSON.stringify(cases, null, 2)}\n`);
const manifest = {
  schema: "rental-ops-battery-manifest@1",
  cases: cases.length,
  files: {
    "cases.json": createHash("sha256").update(readFileSync(join(HERE, "cases.json"))).digest("hex"),
    "oracle.js": createHash("sha256").update(readFileSync(join(HERE, "oracle.js"))).digest("hex"),
  },
};
writeFileSync(join(HERE, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`battery frozen: ${cases.length} cases (${JSON.stringify(counts)})`);
