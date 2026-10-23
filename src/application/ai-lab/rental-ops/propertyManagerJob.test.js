import { Budget } from "./budgets.js";
import { buildSnapshot } from "./snapshotBuilder.js";
import { evaluatePropertyManagerSnapshot } from "./propertyManagerJob.js";
import { serializePrivateItem } from "./privateItemSerializer.js";
import { validateDecision } from "./decisionValidator.js";
import { makeAdapter, fixedClock, REQUEST } from "./snapshotBuilder.test.js";

async function run(data, opts = {}) {
  const snap = await buildSnapshot({ request: REQUEST, adapter: makeAdapter(data), budget: new Budget(), clock: fixedClock() });
  return { snap, report: evaluatePropertyManagerSnapshot(snap, opts) };
}
const shell = (over = {}) => ({
  properties: [{ property_ref: "prop-1", owner_ref: "owner-a" }],
  units: [{ unit_ref: "unit-1", property_ref: "prop-1", owner_ref: "owner-a", status: "occupied" }],
  leases: [], memberships: [], charges: [], schedules: [], ...over,
});
const lease = (over = {}) => ({
  lease_ref: "lease-1", unit_ref: "unit-1", property_ref: "prop-1", owner_ref: "owner-a",
  status: "active", start_date: "2026-01-01", end_date: "2027-01-01", monthly_rent_cents: 100000, currency: "USD", ...over,
});

describe("domain oracle — lease expiration boundaries (as_of_date 2026-10-22)", () => {
  it.each([
    ["2026-10-21", -1, true], ["2026-10-22", 0, true], ["2026-12-21", 60, true], ["2026-12-22", 61, false],
  ])("end_date %s -> %d days, included=%s", async (end, days, included) => {
    const { report } = await run(shell({ leases: [lease({ end_date: end })] }));
    const rows = report.sections.lease_expirations.rows;
    expect(rows.length).toBe(included ? 1 : 0);
    if (included) {
      expect(rows[0].days_until_expiration).toBe(days);
      expect(rows[0].already_expired).toBe(days < 0);
    }
  });

  it("non-active leases never appear as expirations; missing end dates become integrity rows", async () => {
    const { report } = await run(shell({
      leases: [lease({ lease_ref: "l-ended", status: "ended", end_date: "2026-10-25" }),
        lease({ lease_ref: "l-nodate", end_date: undefined })],
    }));
    expect(report.sections.lease_expirations.rows).toHaveLength(0);
    expect(report.sections.integrity.rows.map((r) => r.kind)).toContain("LEASE_END_DATE_MISSING");
  });
});

describe("domain oracle — overdue split (FORGE-collectible vs externally managed)", () => {
  const charge = (over = {}) => ({
    charge_ref: "ch-1", lease_ref: "lease-1", schedule_ref: "sch-1", owner_ref: "owner-a",
    status: "open", due_date: "2026-10-01", amount_cents: 10000, paid_amount_cents: 2500, currency: "USD", ...over,
  });
  const schedule = (over = {}) => ({
    schedule_ref: "sch-1", lease_ref: "lease-1", owner_ref: "owner-a",
    collection_mode: "forge", forge_cutover_date: "2026-01-01", currency: "USD", ...over,
  });

  it("splits by the reviewed collectible rule and never calls external debt FORGE debt", async () => {
    const { report } = await run(shell({
      leases: [lease()],
      charges: [charge(), charge({ charge_ref: "ch-2", schedule_ref: "sch-2", amount_cents: 4000, paid_amount_cents: 0 })],
      schedules: [schedule(), schedule({ schedule_ref: "sch-2", collection_mode: "external" })],
    }));
    const row = report.sections.overdue_balances.rows[0];
    expect(row.forge_collectible_cents).toBe(7500);
    expect(row.externally_managed_cents).toBe(4000);
    expect(report.sections.overdue_balances.forge_collectible_total_cents).toBe(7500);
    expect(report.sections.overdue_balances.externally_managed_total_cents).toBe(4000);
  });

  it("a charge due before the FORGE cutover is externally managed (fail-safe)", async () => {
    const { report } = await run(shell({
      leases: [lease()], charges: [charge({ due_date: "2025-12-15" })], schedules: [schedule()],
    }));
    const row = report.sections.overdue_balances.rows[0];
    expect(row.forge_collectible_cents).toBe(0);
    expect(row.externally_managed_cents).toBe(7500);
  });

  it("void, not-yet-due and fully paid charges are not overdue", async () => {
    const { report } = await run(shell({
      leases: [lease()],
      charges: [charge({ charge_ref: "c-void", status: "void" }),
        charge({ charge_ref: "c-future", due_date: "2026-11-01" }),
        charge({ charge_ref: "c-paid", paid_amount_cents: 10000 })],
      schedules: [schedule()],
    }));
    expect(report.sections.overdue_balances.rows).toHaveLength(0);
  });

  it("inconsistent currencies block the lease totals instead of aggregating", async () => {
    const { report } = await run(shell({
      leases: [lease()],
      charges: [charge(), charge({ charge_ref: "ch-2", currency: "EUR" })],
      schedules: [schedule()],
    }));
    const row = report.sections.overdue_balances.rows[0];
    expect(row.totals_blocked).toBe(true);
    expect(row.forge_collectible_cents).toBe(null);
    expect(report.sections.integrity.rows.map((r) => r.kind)).toContain("CURRENCY_INCONSISTENT");
  });

  it("invalid money becomes an integrity row and is excluded from totals", async () => {
    const { report } = await run(shell({
      leases: [lease()], charges: [charge({ amount_cents: -5 })], schedules: [schedule()],
    }));
    expect(report.sections.overdue_balances.rows).toHaveLength(0);
    expect(report.sections.integrity.rows.map((r) => r.kind)).toContain("MONEY_INVALID");
  });

  it("a missing schedule defaults the charge to externally managed + integrity row", async () => {
    const { report } = await run(shell({ leases: [lease()], charges: [charge()], schedules: [] }));
    const row = report.sections.overdue_balances.rows[0];
    expect(row.externally_managed_cents).toBe(7500);
    expect(report.sections.integrity.rows.map((r) => r.kind)).toContain("CHARGE_SCHEDULE_MISSING");
  });
});

describe("escalation + policy behavior", () => {
  it("every money/tenant row escalates with execution_authorized false, even for $0-adjacent small amounts", async () => {
    const { report } = await run(shell({
      leases: [lease({ end_date: "2026-11-15" })],
      charges: [{ charge_ref: "ch-1", lease_ref: "lease-1", schedule_ref: "sch-1", owner_ref: "owner-a", status: "open", due_date: "2026-10-01", amount_cents: 1, paid_amount_cents: 0, currency: "USD" }],
      schedules: [{ schedule_ref: "sch-1", lease_ref: "lease-1", owner_ref: "owner-a", collection_mode: "forge", forge_cutover_date: "2026-01-01", currency: "USD" }],
    }));
    const touchpoints = report.escalations.map((e) => e.touchpoint).sort();
    expect(touchpoints).toEqual(["money", "tenant"]);
    expect(report.escalations.every((e) => e.execution_authorized_for_agent === false)).toBe(true);
    expect(report.execution_authorized).toBe(false);
  });

  it("an unknown policy BLOCKS the affected recommendation and emits no escalation for it", async () => {
    const { report } = await run(shell({ leases: [lease({ end_date: "2026-11-15" })] }), { policies: {} });
    expect(report.status).toBe("BLOCKED");
    const rec = report.recommendations.find((r) => r.action_class === "REVIEW_LEASE_EXPIRATION");
    expect(rec.status).toBe("BLOCKED");
    expect(report.escalations).toHaveLength(0);
  });

  it("vacancy is NOT_MODELED and an empty complete snapshot is a positive no-exceptions result", async () => {
    const { report } = await run(shell({ leases: [lease()] }));
    expect(report.sections.vacancy_assessment).toBe("NOT_MODELED");
    expect(report.no_exceptions_found).toBe(true);
    expect(report.status).toBe("PROPOSED");
  });

  it("a partial snapshot never claims all-clear", async () => {
    const snap = await buildSnapshot({ request: REQUEST, adapter: makeAdapter(shell(), { failOn: "units" }), budget: new Budget(), clock: fixedClock() });
    const report = evaluatePropertyManagerSnapshot(snap);
    expect(report.status).toBe("PARTIAL");
    expect(report.no_exceptions_found).toBe(false);
  });
});

describe("private item + decision binding", () => {
  it("three fixed-clock runs produce byte-identical items", async () => {
    const bytes = [];
    for (let i = 0; i < 3; i++) {
      const { snap, report } = await run(shell({ leases: [lease({ end_date: "2026-11-01" })] }));
      const item = serializePrivateItem({ report, snapshot: snap, publishedAt: "2026-10-22T14:05:00.000Z" });
      bytes.push(JSON.stringify(item));
    }
    expect(bytes[0]).toBe(bytes[1]);
    expect(bytes[1]).toBe(bytes[2]);
  });

  it("decisions bind item + digest + row; stale digests and unknown rows refuse", async () => {
    const { snap, report } = await run(shell({ leases: [lease({ end_date: "2026-11-01" })] }));
    const item = serializePrivateItem({ report, snapshot: snap, publishedAt: "2026-10-22T14:05:00.000Z" });
    const ok = { item_id: item.item_id, report_digest: item.report_digest, row_id: "exp:lease-1", actor: "jason", decision: "accept", note: "", at: "2026-10-22T15:00:00.000Z", decision_id: "d-1" };
    expect(validateDecision(item, ok)).toMatchObject({ decision: "accept" });
    expect(() => validateDecision(item, { ...ok, report_digest: "0".repeat(64) })).toThrow(/STALE_DIGEST/);
    expect(() => validateDecision(item, { ...ok, row_id: "exp:nope" })).toThrow(/UNKNOWN_ROW/);
    expect(() => validateDecision(item, { ...ok, note: "x".repeat(501) })).toThrow(/BAD_DECISION/);
  });
});
