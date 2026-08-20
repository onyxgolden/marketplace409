import{describe,expect,it}from"vitest";import{renderToStaticMarkup}from"react-dom/server";import RentalLeaseLifecyclePanel,{calculateProrationCents,resolveLeaseIdentity,leaseOptionLabel}from"./RentalLeaseLifecyclePanel.jsx";describe("RentalLeaseLifecyclePanel",()=>{it("requires owner-controlled changes and fees",()=>{const html=renderToStaticMarkup(<RentalLeaseLifecyclePanel/>);expect(html).toContain("Renewals, amendments, and prorating");expect(html).toContain("only an explicit owner action");expect(html).toContain("qualified Texas counsel");});it("calculates and rounds daily proration deterministically",()=>{expect(calculateProrationCents(200000,10,31)).toBe(64516);expect(calculateProrationCents(200000,32,31)).toBeNull();});});

const SANDBOX_LEASE_ID = "rental_lease_c151ed02-8b18-4534-baaa-b9aaf4aca219";
const OTHER_LEASE_ID = "rental_lease_a9f2b311-7c44-4e9a-9b1d-2a6e5f0c8d13";

const data = {
  leases: [
    { id: SANDBOX_LEASE_ID, unit_id: "unit_1", property_id: "property-1", status: "active", monthly_rent_cents: 130000 },
    { id: OTHER_LEASE_ID, unit_id: "unit_2", property_id: "property-2", status: "draft", monthly_rent_cents: 130000 },
  ],
  units: [
    { id: "unit_1", label: "TEST-", property_id: "property-1" },
    { id: "unit_2", label: "Main residence", property_id: "property-2" },
  ],
  tenants: [
    { id: "tenant_1", display_name: "Brandy Morgan" },
    { id: "tenant_2", display_name: "Anthony Babino" },
  ],
  leaseMemberships: [
    { lease_id: SANDBOX_LEASE_ID, tenant_id: "tenant_1" },
    { lease_id: OTHER_LEASE_ID, tenant_id: "tenant_2" },
  ],
  schedules: [
    { id: "schedule_1", lease_id: SANDBOX_LEASE_ID, status: "active", amount_cents: 130000 },
  ],
  leaseChanges: [], lateFeeRules: [], openCharges: [],
};

describe("resolveLeaseIdentity", () => {
  it("resolves tenant through lease memberships, unit through lease.unit_id, and property through the unit", () => {
    expect(resolveLeaseIdentity(data.leases[0], data)).toEqual({
      leaseId: SANDBOX_LEASE_ID, tenantLabel: "Brandy Morgan", unitLabel: "TEST-",
      propertyLabel: "property-1", monthlyRentCents: 130000, status: "active",
    });
  });

  it("prefers the authoritative active schedule's rent over the lease's own monthly_rent_cents", () => {
    const withDifferentScheduleRent = { ...data, schedules: [{ id: "schedule_1", lease_id: SANDBOX_LEASE_ID, status: "active", amount_cents: 150000 }] };
    expect(resolveLeaseIdentity(data.leases[0], withDifferentScheduleRent).monthlyRentCents).toBe(150000);
  });

  it("falls back to lease.monthly_rent_cents when no active schedule exists", () => {
    expect(resolveLeaseIdentity(data.leases[1], data).monthlyRentCents).toBe(130000);
  });

  it("ignores a non-active (e.g. draft) schedule and falls back to lease.monthly_rent_cents", () => {
    const withDraftSchedule = { ...data, schedules: [{ id: "schedule_x", lease_id: OTHER_LEASE_ID, status: "draft", amount_cents: 999999 }] };
    expect(resolveLeaseIdentity(data.leases[1], withDraftSchedule).monthlyRentCents).toBe(130000);
  });

  it("shows explicit Unknown warnings instead of silently omitting identity", () => {
    const orphan = { leases: [], units: [], tenants: [], leaseMemberships: [], schedules: [] };
    const unresolvableLease = { id: "rental_lease_orphan_1", unit_id: "unit_missing", property_id: null, status: "active", monthly_rent_cents: 50000 };
    expect(resolveLeaseIdentity(unresolvableLease, orphan)).toMatchObject({
      tenantLabel: "Unknown tenant", unitLabel: "Unknown unit", propertyLabel: "Unknown property",
    });
  });

  it("falls back to the lease's own property_id when the unit cannot be resolved", () => {
    const noUnits = { ...data, units: [] };
    expect(resolveLeaseIdentity(data.leases[0], noUnits).propertyLabel).toBe("property-1");
  });

  it("joins every tenant on a multi-tenant lease instead of guessing a single one", () => {
    const multiTenant = { ...data, leaseMemberships: [...data.leaseMemberships, { lease_id: SANDBOX_LEASE_ID, tenant_id: "tenant_2" }] };
    expect(resolveLeaseIdentity(data.leases[0], multiTenant).tenantLabel).toBe("Brandy Morgan, Anthony Babino");
  });
});

describe("leaseOptionLabel", () => {
  it("distinguishes two leases with opaque UUID ids and identical rent by tenant, unit, property, and status", () => {
    const labelOne = leaseOptionLabel(data.leases[0], data);
    const labelTwo = leaseOptionLabel(data.leases[1], data);
    expect(labelOne).not.toBe(labelTwo);
    expect(labelOne).toContain("Brandy Morgan");
    expect(labelOne).toContain("TEST-");
    expect(labelOne).toContain("property-1");
    expect(labelOne).toContain("active");
    expect(labelTwo).toContain("Anthony Babino");
    expect(labelTwo).toContain("Main residence");
    expect(labelTwo).toContain("property-2");
    expect(labelTwo).toContain("draft");
  });

  it("keeps the lease id present as a secondary detail", () => {
    expect(leaseOptionLabel(data.leases[0], data)).toContain(SANDBOX_LEASE_ID);
  });

  it("clearly identifies the sandbox TEST lease by its real production id without hard-coding it in the component", () => {
    const label = leaseOptionLabel(data.leases[0], data);
    expect(label).toContain("Brandy Morgan");
    expect(label).toContain("TEST-");
    expect(label).toContain(SANDBOX_LEASE_ID);
  });
});

describe("RentalLeaseLifecyclePanel Lease Changes selector", () => {
  it("shows human-readable identity for every lease option while keeping the raw lease id as the option value", () => {
    const markup = renderToStaticMarkup(<RentalLeaseLifecyclePanel initialData={data} />);
    expect(markup).toContain(`value="${SANDBOX_LEASE_ID}"`);
    expect(markup).toContain(`value="${OTHER_LEASE_ID}"`);
    expect(markup).toContain("Brandy Morgan");
    expect(markup).toContain("Anthony Babino");
    expect(markup).toContain(SANDBOX_LEASE_ID);
  });

  it("does not silently omit identity for a lease with no resolvable tenant, unit, or property", () => {
    const orphanLease = { id: "rental_lease_orphan_1", unit_id: "unit_missing", property_id: null, status: "active", monthly_rent_cents: 50000 };
    const orphanData = { ...data, leases: [orphanLease], leaseMemberships: [] };
    const markup = renderToStaticMarkup(<RentalLeaseLifecyclePanel initialData={orphanData} />);
    expect(markup).toContain("Unknown tenant");
    expect(markup).toContain("Unknown unit");
    expect(markup).toContain("Unknown property");
  });
});
