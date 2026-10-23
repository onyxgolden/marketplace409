import assert from "node:assert/strict";
import { test } from "node:test";
import { SYNTHETIC_REPOSITORIES } from "../fixtures/repositories.js";
import { makeHost, makeRequest, runPreview, onlyItem } from "./helpers.js";
import { createSyntheticAdapter } from "../src/syntheticRepository.js";
import { createMemoryPublisher, runJob } from "../src/runner.js";
import { fixedClock } from "./helpers.js";

test("two owners with colliding IDs: each run sees only its own owner's facts", async () => {
  const a = await runPreview(); // host registered owner-a; repo holds both owners
  const itemA = onlyItem(a.publisher);
  const expA = itemA.report.sections.lease_expirations.rows.find((r) => r.lease_ref === "lease-1");
  assert.equal(expA.end_date, "2026-10-17"); // owner-a's lease-1, not owner-b's 2027-06-30
  assert.equal(itemA.report.owner_ref, "owner-a");

  const b = await runPreview({
    host: makeHost({ registered_owner: "owner-b" }),
    request: makeRequest({ owner_ref: "owner-b", portfolio_ref: "portfolio-b" }),
  });
  const itemB = onlyItem(b.publisher);
  assert.equal(itemB.report.sections.lease_expirations.rows.length, 0); // owner-b lease-1 is far out
  const ovdB = itemB.report.sections.overdue_balances.rows[0];
  assert.equal(ovdB.forge_collectible_cents, 5000); // owner-b's ch-1 only — never owner-a's amounts
});

test("a leaky adapter returning cross-owner rows refuses the snapshot; zero bytes published", async () => {
  const { result, publisher } = await runPreview({ faults: { leakyOwners: true } });
  assert.deepEqual([result.outcome, result.code], ["REFUSED", "SCOPE_VIOLATION"]);
  assert.equal(publisher.items.size, 0);
});

test("dangling cross-owner join: a charge naming another owner's schedule cannot join it", async () => {
  const data = SYNTHETIC_REPOSITORIES["preview-owner-a"]();
  // owner-a charge now points at sch-9, which exists only in owner-b's world.
  data.charges[0].schedule_ref = "sch-9";
  const { publisher } = await runPreview({ datasets: data });
  const item = onlyItem(publisher);
  const ovd = item.report.sections.overdue_balances.rows[0];
  // Fail-safe: unresolvable schedule -> externally managed, never FORGE-collectible.
  assert.equal(ovd.forge_collectible_cents, 0);
  assert.equal(ovd.externally_managed_cents, 130000);
  assert.ok(item.report.sections.integrity.rows.some((r) => r.kind === "CHARGE_SCHEDULE_MISSING"));
});

test("a data-getter canary row is refused as control data without invoking the getter", async () => {
  const { result, publisher } = await runPreview({ faults: { getterCanaryDataset: "leases" } });
  assert.deepEqual([result.outcome, result.code], ["REFUSED", "CONTROL_DATA_REFUSED"]);
  assert.equal(publisher.items.size, 0);
});

test("the adapter is only ever asked for the registered owner", async () => {
  const data = SYNTHETIC_REPOSITORIES["preview-basic"]();
  const adapter = createSyntheticAdapter({ datasets: data });
  const publisher = createMemoryPublisher();
  await runJob({
    hostConfig: makeHost(), request: makeRequest(),
    adapterFactory: () => adapter, publisher, clock: fixedClock(),
  });
  assert.ok(adapter.calls.length > 0);
  assert.ok(adapter.calls.every((c) => c.owner_ref === "owner-a"));
});
