import assert from "node:assert/strict";
import { test } from "node:test";
import { runPreview, onlyItem, fixedClock } from "./helpers.js";
import { SYNTHETIC_REPOSITORIES } from "../fixtures/repositories.js";

test("complete-empty is a positive result: no exceptions, status PROPOSED", async () => {
  const { result, publisher } = await runPreview({ datasets: SYNTHETIC_REPOSITORIES["preview-empty"]() });
  assert.equal(result.outcome, "COMPLETED");
  const item = onlyItem(publisher);
  assert.equal(item.report.status, "PROPOSED");
  assert.equal(item.report.no_exceptions_found, true);
});

test("a failed dataset yields PARTIAL and never an all-clear", async () => {
  const { publisher } = await runPreview({ faults: { failDataset: "leases" } });
  const item = onlyItem(publisher);
  assert.equal(item.report.status, "PARTIAL");
  assert.equal(item.report.no_exceptions_found, false);
  assert.equal(item.report.coverage.leases.complete, false);
});

test("mixed source revisions mark the snapshot PARTIAL", async () => {
  const { publisher } = await runPreview({ faults: { mixedRevisions: true } });
  const item = onlyItem(publisher);
  assert.equal(item.report.snapshot_consistency, "PARTIAL");
  assert.equal(item.report.status, "PARTIAL");
});

test("a collection finished in the future refuses outright", async () => {
  const { result, publisher } = await runPreview({ clock: fixedClock("2026-10-22T14:30:00.000Z") });
  assert.deepEqual([result.outcome, result.code], ["REFUSED", "SNAPSHOT_FROM_FUTURE"]);
  assert.equal(publisher.items.size, 0);
});

test("a stale collection is PARTIAL with a staleness diagnostic", async () => {
  const { publisher } = await runPreview({ clock: fixedClock("2026-10-22T13:00:00.000Z") });
  const item = onlyItem(publisher);
  assert.equal(item.report.status, "PARTIAL");
  assert.ok(item.report.diagnostics.some((d) => d.code === "SNAPSHOT_STALE"));
});

test("conflicting duplicate records surface as integrity rows, first admission wins", async () => {
  const data = SYNTHETIC_REPOSITORIES["preview-owner-a"]();
  data.units.push({ unit_ref: "unit-1", property_ref: "prop-1", owner_ref: "owner-a", status: "vacant" });
  const { publisher } = await runPreview({ datasets: data });
  const item = onlyItem(publisher);
  assert.ok(item.report.sections.integrity.rows.some((r) => r.kind === "DUPLICATE_CONFLICT" && r.record_ref === "unit-1"));
  assert.equal(item.report.status, "PARTIAL");
});

test("paging does not change the result: page size 1 and 100 agree byte-for-byte", async () => {
  const a = await runPreview({ faults: { pageSize: 1 } });
  const b = await runPreview({ faults: { pageSize: 100 } });
  assert.equal(JSON.stringify(onlyItem(a.publisher)), JSON.stringify(onlyItem(b.publisher)));
});

test("unknown statuses and dangling references become integrity rows, never silent skips", async () => {
  const data = SYNTHETIC_REPOSITORIES["preview-owner-a"]();
  data.leases.push({
    lease_ref: "lease-weird", unit_ref: "unit-ghost", property_ref: "prop-1", owner_ref: "owner-a",
    status: "in-limbo", start_date: "2026-01-01", end_date: "2026-11-01", monthly_rent_cents: 100, currency: "USD",
  });
  const { publisher } = await runPreview({ datasets: data });
  const kinds = onlyItem(publisher).report.sections.integrity.rows.map((r) => r.kind);
  assert.ok(kinds.includes("LEASE_STATUS_UNSUPPORTED"));
  assert.ok(kinds.includes("LEASE_UNIT_DANGLING"));
});
