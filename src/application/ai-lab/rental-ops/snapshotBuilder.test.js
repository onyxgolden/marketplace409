import { Budget } from "./budgets.js";
import { buildSnapshot } from "./snapshotBuilder.js";

const AS_OF = "2026-10-22T14:00:00.000Z";
export const fixedClock = (iso = "2026-10-22T13:55:00.000Z") => ({ nowIso: () => iso });
export const REQUEST = {
  principal_ref: "host:workbench-operator", owner_ref: "owner-a", portfolio_ref: "portfolio-a",
  job_kind: "property-manager-daily-exception-review", job_version: 1,
  as_of: AS_OF, window: { name: "lease-expiration-60d" }, snapshot_request_id: "snap-1",
};

export function makeAdapter(datasets, { pageSize = 100, revision = "rev-1", failOn = null } = {}) {
  const calls = [];
  return {
    source_system: "synthetic-repository",
    calls,
    async collect(dataset, { owner_ref, cursor }) {
      calls.push({ dataset, owner_ref, cursor });
      if (failOn === dataset) throw Object.assign(new Error("boom"), { code: "SOURCE_DOWN" });
      const all = datasets[dataset] ?? [];
      const start = cursor === null ? 0 : Number(cursor);
      const rows = all.slice(start, start + pageSize);
      const next = start + pageSize < all.length ? String(start + pageSize) : null;
      return { rows, next_cursor: next, revision, expected_total: all.length };
    },
    close() {},
  };
}

const baseData = () => ({
  properties: [{ property_ref: "prop-1", owner_ref: "owner-a", name: "CANARY-NAME-1", address: "1 Canary St" }],
  units: [{ unit_ref: "unit-1", property_ref: "prop-1", owner_ref: "owner-a", status: "occupied" }],
  leases: [{
    lease_ref: "lease-1", unit_ref: "unit-1", property_ref: "prop-1", owner_ref: "owner-a",
    status: "active", start_date: "2026-01-01", end_date: "2026-11-01", monthly_rent_cents: 160000,
    currency: "USD", tenant_email: "canary@example.com",
  }],
  memberships: [{ lease_ref: "lease-1", owner_ref: "owner-a", tenant_id: "tenant-secret-1" }],
  charges: [],
  schedules: [],
});

describe("snapshot builder", () => {
  it("projects through the allowlist: PII fields never enter the snapshot", async () => {
    const snap = await buildSnapshot({ request: REQUEST, adapter: makeAdapter(baseData()), budget: new Budget(), clock: fixedClock() });
    const bytes = JSON.stringify(snap);
    expect(bytes).not.toContain("CANARY-NAME-1");
    expect(bytes).not.toContain("canary@example.com");
    expect(bytes).not.toContain("tenant-secret-1");
    expect(snap.records.leases[0].tenant_email).toBeUndefined();
    expect(snap.evidence.leases["lease-1"].dropped_fields).toContain("tenant_email");
    expect(snap.consistency).toBe("CONSISTENT");
    expect(snap.as_of_date).toBe("2026-10-22");
    expect(snap.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces an identical digest regardless of page size / arrival order", async () => {
    const data = baseData();
    data.charges = [
      { charge_ref: "ch-2", lease_ref: "lease-1", schedule_ref: "sch-1", owner_ref: "owner-a", status: "open", due_date: "2026-10-01", amount_cents: 500, paid_amount_cents: 0, currency: "USD" },
      { charge_ref: "ch-1", lease_ref: "lease-1", schedule_ref: "sch-1", owner_ref: "owner-a", status: "open", due_date: "2026-09-01", amount_cents: 700, paid_amount_cents: 0, currency: "USD" },
    ];
    data.schedules = [{ schedule_ref: "sch-1", lease_ref: "lease-1", owner_ref: "owner-a", collection_mode: "forge", forge_cutover_date: "2026-01-01", currency: "USD" }];
    const a = await buildSnapshot({ request: REQUEST, adapter: makeAdapter(data, { pageSize: 1 }), budget: new Budget(), clock: fixedClock() });
    const b = await buildSnapshot({ request: REQUEST, adapter: makeAdapter(data, { pageSize: 100 }), budget: new Budget(), clock: fixedClock() });
    expect(a.digest).toBe(b.digest);
    expect(a.records.charges.map((c) => c.charge_ref)).toEqual(["ch-1", "ch-2"]);
  });

  it("refuses the whole snapshot on a cross-owner row (no bytes returned)", async () => {
    const data = baseData();
    data.units.push({ unit_ref: "unit-x", property_ref: "prop-1", owner_ref: "owner-b", status: "occupied" });
    await expect(buildSnapshot({ request: REQUEST, adapter: makeAdapter(data), budget: new Budget(), clock: fixedClock() }))
      .rejects.toMatchObject({ code: "SCOPE_VIOLATION" });
  });

  it("marks a failed page PARTIAL instead of turning it into a zero total", async () => {
    const snap = await buildSnapshot({ request: REQUEST, adapter: makeAdapter(baseData(), { failOn: "charges" }), budget: new Budget(), clock: fixedClock() });
    expect(snap.consistency).toBe("PARTIAL");
    expect(snap.datasets.charges.complete).toBe(false);
    expect(snap.collection_errors).toContainEqual({ dataset: "charges", code: "SOURCE_DOWN" });
  });

  it("refuses a snapshot collected in the future", async () => {
    await expect(buildSnapshot({ request: REQUEST, adapter: makeAdapter(baseData()), budget: new Budget(), clock: fixedClock("2026-10-22T14:30:00.000Z") }))
      .rejects.toMatchObject({ code: "SNAPSHOT_FROM_FUTURE" });
  });

  it("flags a stale collection PARTIAL, and mixed revisions PARTIAL", async () => {
    const stale = await buildSnapshot({ request: REQUEST, adapter: makeAdapter(baseData()), budget: new Budget(), clock: fixedClock("2026-10-22T13:00:00.000Z") });
    expect(stale.stale).toBe(true);
    expect(stale.consistency).toBe("PARTIAL");
    const mixed = makeAdapter(baseData());
    const orig = mixed.collect.bind(mixed);
    let n = 0;
    mixed.collect = async (ds, req) => { const p = await orig(ds, req); return { ...p, revision: `rev-${(n += 1)}` }; };
    const snap2 = await buildSnapshot({ request: REQUEST, adapter: mixed, budget: new Budget(), clock: fixedClock() });
    expect(snap2.consistency).toBe("PARTIAL");
    expect(snap2.source_revision).toBe(null);
  });

  it("records duplicate conflicts and keeps the first admitted row", async () => {
    const data = baseData();
    data.units.push({ unit_ref: "unit-1", property_ref: "prop-1", owner_ref: "owner-a", status: "vacant" });
    const snap = await buildSnapshot({ request: REQUEST, adapter: makeAdapter(data), budget: new Budget(), clock: fixedClock() });
    expect(snap.consistency).toBe("PARTIAL");
    expect(snap.conflicts).toContainEqual({ dataset: "units", record_ref: "unit-1", code: "DUPLICATE_CONFLICT" });
    expect(snap.records.units).toHaveLength(1);
    expect(snap.records.units[0].status).toBe("occupied");
  });
});
