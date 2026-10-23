import assert from "node:assert/strict";
import { test } from "node:test";
import { SYNTHETIC_REPOSITORIES } from "../fixtures/repositories.js";
import { makeHost, makeRequest, runPreview, onlyItem } from "./helpers.js";
import { fixedClock } from "./helpers.js";

test("two owners with colliding IDs: each run sees only its own owner's facts", async () => {
  const a = await runPreview(); // host registered owner-a; repo holds both owners
  const itemA = onlyItem(a.publisher);
  const expA = itemA.report.sections.lease_expirations.rows.find((r) => r.lease_ref === "lease-1");
  assert.equal(expA.end_date, "2026-10-17"); // owner-a's lease-1, not owner-b's 2027-06-30
  assert.equal(itemA.report.owner_ref, "owner-a");

  const b = await runPreview({
    host: makeHost({ registered_owner: "owner-b", registered_portfolio: "portfolio-b" }),
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
  // Unknown classification never masquerades as verified evidence: the
  // charge is withheld from both buckets and the lease totals are
  // blocked with a named reason — never a plausible external total.
  assert.equal(ovd.totals_blocked, true);
  assert.equal(ovd.blocked_reason, "CLASSIFICATION_UNVERIFIED");
  assert.equal(ovd.forge_collectible_cents, null);
  assert.equal(ovd.externally_managed_cents, null);
  assert.ok(item.report.sections.integrity.rows.some((r) => r.kind === "CHARGE_SCHEDULE_MISSING"));
  assert.equal(item.report.sections.overdue_balances.forge_collectible_total_cents, null);
  assert.equal(item.report.sections.overdue_balances.totals_unavailable, true);
});

test("a data-getter canary row is refused as control data without invoking the getter", async () => {
  const { result, publisher } = await runPreview({ faults: { getterCanaryDataset: "leases" } });
  assert.deepEqual([result.outcome, result.code], ["REFUSED", "CONTROL_DATA_REFUSED"]);
  assert.equal(publisher.items.size, 0);
});

test("the adapter is only ever asked for the registered owner", async () => {
  // The execution worker builds the adapter from the host-owned spec,
  // so owner scoping is proven at the snapshot boundary: every page
  // request the builder issues carries the request's owner.
  const { buildSnapshot } = await import("../../../../src/application/ai-lab/rental-ops/snapshotBuilder.js");
  const { Budget } = await import("../../../../src/application/ai-lab/rental-ops/budgets.js");
  const seen = [];
  const adapter = {
    async collect(dataset, { owner_ref }) {
      seen.push(owner_ref);
      return { rows: [], next_cursor: null, revision: "rev-1", expected_total: 0 };
    },
  };
  await buildSnapshot({ request: makeRequest(), adapter, budget: new Budget(), clock: fixedClock() });
  assert.ok(seen.length > 0);
  assert.ok(seen.every((o) => o === "owner-a"));
});

test("an unregistered portfolio label refuses; it is never relabeled over whole-owner data", async () => {
  const { result, publisher } = await runPreview({ request: { portfolio_ref: "not-registered-portfolio" } });
  assert.deepEqual([result.outcome, result.code], ["REFUSED", "PORTFOLIO_UNREGISTERED"]);
  assert.equal(publisher.items.size, 0);
});

test("a caller-supplied window horizon or extra window fields refuse", async () => {
  const badHorizon = await runPreview({ request: { window: { name: "lease-expiration-60d", horizon_days: 90 } } });
  assert.equal(badHorizon.result.code, "BAD_REQUEST");
  const badName = await runPreview({ request: { window: { name: "lease-expiration-30d" } } });
  assert.equal(badName.result.code, "BAD_REQUEST");
  const badAsOf = await runPreview({ request: { as_of: "10/22/2026 2:00 PM" } });
  assert.equal(badAsOf.result.code, "BAD_REQUEST");
  const offsetAsOf = await runPreview({ request: { as_of: "2026-10-22T14:00:00+05:00" } });
  assert.equal(offsetAsOf.result.code, "BAD_REQUEST");
});
