import { describe, expect, it } from "vitest";
import { buildContextualRentalData } from "./RentalContextualSurface.jsx";

const data = {
  units: [{ id: "u1" }, { id: "u2" }],
  tenants: [{ id: "t1" }, { id: "t2" }],
  leases: [{ id: "l1", unit_id: "u1" }, { id: "l2", unit_id: "u2" }],
  leaseMemberships: [{ lease_id: "l1", tenant_id: "t1" }, { lease_id: "l2", tenant_id: "t2" }],
  schedules: [{ id: "s1", lease_id: "l1" }, { id: "s2", lease_id: "l2" }],
  openCharges: [{ id: "c1", lease_id: "l1" }, { id: "c2", lease_id: "l2" }],
  payments: [{ id: "p1", lease_id: "l1", tenant_id: "t1" }, { id: "p2", lease_id: "l2", tenant_id: "t2" }],
  maintenanceRequests: [], inspections: [], notifications: [], documents: [],
};

describe("RentalContextualSurface", () => {
  it("scopes every related collection and form option to the selected tenant", () => {
    const scoped = buildContextualRentalData(data, { recordType: "tenant", recordId: "t1" });
    expect(scoped.units.map((item) => item.id)).toEqual(["u1"]);
    expect(scoped.tenants.map((item) => item.id)).toEqual(["t1"]);
    expect(scoped.leases.map((item) => item.id)).toEqual(["l1"]);
    expect(scoped.leaseMemberships).toEqual([{ lease_id: "l1", tenant_id: "t1" }]);
    expect(scoped.schedules.map((item) => item.id)).toEqual(["s1"]);
    expect(scoped.openCharges.map((item) => item.id)).toEqual(["c1"]);
    expect(scoped.payments.map((item) => item.id)).toEqual(["p1"]);
  });

  it("scopes every related form option through the selected unit", () => {
    const scoped = buildContextualRentalData(data, { recordType: "unit", recordId: "u2" });
    expect(scoped.units.map((item) => item.id)).toEqual(["u2"]);
    expect(scoped.tenants.map((item) => item.id)).toEqual(["t2"]);
    expect(scoped.leases.map((item) => item.id)).toEqual(["l2"]);
    expect(scoped.leaseMemberships).toEqual([{ lease_id: "l2", tenant_id: "t2" }]);
  });
});
