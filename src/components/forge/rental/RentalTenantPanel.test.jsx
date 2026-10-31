import { describe, expect, it, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalTenantPanel, { activeBalanceCentsForTenant, availableCoTenants, propertyLabelForTenant, tenantHouseholdForSelection, tenantInviteLabel, tenantProfilePayload } from "./RentalTenantPanel";
import { clearSWRCache, seedCacheEntry } from "@/hooks/swrCache";

const leases = [
  { id: "lease_1", unit_id: "unit_1", status: "active" },
  { id: "lease_2", unit_id: "unit_2", status: "ended" },
];
const leaseMemberships = [{ lease_id: "lease_1", tenant_id: "tenant_1" }, { lease_id: "lease_2", tenant_id: "tenant_2" }];
const units = [{ id: "unit_1", label: "Main residence" }, { id: "unit_2", label: "Rear unit" }];

describe("propertyLabelForTenant", () => {
  it("resolves the unit label from the tenant's active lease", () => {
    expect(propertyLabelForTenant({ id: "tenant_1" }, leases, leaseMemberships, units)).toBe("Main residence");
  });
  it("returns null when the tenant's only lease is not active", () => {
    expect(propertyLabelForTenant({ id: "tenant_2" }, leases, leaseMemberships, units)).toBeNull();
  });
  it("returns null when the tenant has no lease membership at all", () => {
    expect(propertyLabelForTenant({ id: "tenant_3" }, leases, leaseMemberships, units)).toBeNull();
  });
  it("falls back to the raw unit id if the unit record is missing", () => {
    expect(propertyLabelForTenant({ id: "tenant_1" }, leases, leaseMemberships, [])).toBe("unit_1");
  });
});

describe("tenantInviteLabel", () => {
  it("says the invite was not sent when invited_at is missing, even if status is invited", () => {
    expect(tenantInviteLabel({ id: "t1", status: "invited", invited_at: null, auth_user_id: null })).toBe("Invite not sent");
  });
  it("shows the invite date once invited_at is set", () => {
    expect(tenantInviteLabel({ id: "t1", status: "invited", invited_at: "2026-10-01T10:00:00Z", auth_user_id: null }))
      .toBe(`Invite sent ${new Date("2026-10-01T10:00:00Z").toLocaleDateString()}`);
  });
  it("shows the portal as claimed once auth_user_id is set", () => {
    expect(tenantInviteLabel({ id: "t1", status: "active", invited_at: "2026-10-01T10:00:00Z", auth_user_id: "user_1" })).toBe("Portal claimed");
  });
});

describe("activeBalanceCentsForTenant", () => {
  it("totals the remaining open charges on the tenant's active lease", () => {
    const charges = [
      { lease_id: "lease_1", amount_cents: 120000, paid_amount_cents: 20000 },
      { lease_id: "lease_1", amount_cents: 5000, paid_amount_cents: 0 },
      { lease_id: "lease_2", amount_cents: 90000, paid_amount_cents: 0 },
    ];
    expect(activeBalanceCentsForTenant({ id: "tenant_1" }, leases, leaseMemberships, charges)).toBe(105000);
  });
  it("returns zero when an active tenant has no open charges", () => {
    expect(activeBalanceCentsForTenant({ id: "tenant_1" }, leases, leaseMemberships, [])).toBe(0);
  });
  it("returns null when the tenant has no active lease", () => {
    expect(activeBalanceCentsForTenant({ id: "tenant_2" }, leases, leaseMemberships, [])).toBeNull();
  });
});

describe("tenantHouseholdForSelection", () => {
  it("keeps the stored primary tenant first and returns co-tenants separately", () => {
    const householdTenants = [{ id: "tenant_1", display_name: "Primary" }, { id: "tenant_2", display_name: "Spouse" }];
    const memberships = [{ lease_id: "lease_1", tenant_id: "tenant_1", occupancy_role: "primary" }, { lease_id: "lease_1", tenant_id: "tenant_2", occupancy_role: "co_tenant" }];
    const household = tenantHouseholdForSelection(householdTenants[1], householdTenants, [{ id: "lease_1", unit_id: "unit_1", status: "active" }], memberships, units);
    expect(household.primaryTenant.display_name).toBe("Primary");
    expect(household.coTenants.map((tenant) => tenant.display_name)).toEqual(["Spouse"]);
  });
});

// FORGE does not collect tenant birth dates -- verifies the field is gone from the form and never
// re-appears even for a legacy tenant record that still happens to carry a stored date_of_birth
// value (proving it's not displayed, not merely not requested for new tenants).
describe("RentalTenantPanel birth-date removal", () => {
  it("never renders a date-of-birth field or label, even for a legacy tenant record with a stored value", () => {
    const legacyTenant = {
      id: "tenant_1", display_name: "Ashley George", email: "ashley@example.com", phone: "555-1000",
      date_of_birth: "1990-01-01", status: "active",
    };
    const markup = renderToStaticMarkup(<RentalTenantPanel initialTenants={[legacyTenant]} />);
    expect(markup).not.toContain("Date of birth");
    expect(markup).not.toContain("dateOfBirth");
    expect(markup).not.toContain("1990-01-01");
  });

  it("does not include a dateOfBirth field in the tenant-creation form submission shape", () => {
    // The create form only ever sends displayName/email/phone (see RentalTenantPanel.jsx's save()) --
    // this pins that shape so a birth-date field can't be silently reintroduced there either.
    const markup = renderToStaticMarkup(<RentalTenantPanel initialTenants={[]} />);
    expect(markup).not.toContain("Date of birth");
    expect(markup).not.toContain('name="dateOfBirth"');
  });
});

describe("RentalTenantPanel contextual creation", () => {
  it("opens the add-tenant card when linked from an unleased property", () => {
    const markup = renderToStaticMarkup(<RentalTenantPanel initialTenants={[{ id: "tenant_1", display_name: "Existing", email: "existing@example.com" }]} recordContext={{ openCreateTenant: true }} />);
    expect(markup).toContain("Tenant name");
    expect(markup).toContain("Save tenant");
  });
});

describe("availableCoTenants", () => {
  const tenants = [
    { id: "t1", display_name: "Primary", email: "primary@example.com" },
    { id: "t2", display_name: "Spouse", email: "spouse@example.com" },
    { id: "t3", display_name: "Unassigned", email: "unassigned@example.com" },
  ];
  const memberships = [
    { lease_id: "l1", tenant_id: "t1", occupancy_role: "primary" },
    { lease_id: "l1", tenant_id: "t2", occupancy_role: "co_tenant" },
  ];

  it("lists only tenants not already on the lease", () => {
    expect(availableCoTenants(tenants, memberships, "l1").map((tenant) => tenant.id)).toEqual(["t3"]);
  });

  it("lists everyone when nobody is on the lease yet", () => {
    expect(availableCoTenants(tenants, memberships, "l2").map((tenant) => tenant.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("returns an empty list without a lease id", () => {
    expect(availableCoTenants(tenants, memberships, null)).toEqual([]);
  });
});

describe("RentalTenantPanel co-tenant controls", () => {
  const primary = { id: "t1", display_name: "Primary", email: "primary@example.com", status: "active" };
  const spouse = { id: "t2", display_name: "Spouse", email: "spouse@example.com", status: "invited" };
  const unassigned = { id: "t3", display_name: "Unassigned", email: "unassigned@example.com", status: "invited" };
  const lease = { id: "l1", unit_id: "u1", status: "active" };
  const units = [{ id: "u1", label: "4225 Barnhill" }];

  function seed(memberships, tenants) {
    clearSWRCache();
    seedCacheEntry("rental:tenants", { tenants, leases: [lease], leaseMemberships: memberships, units, openCharges: [] });
  }
  function recordMarkup(recordId) {
    return renderToStaticMarkup(<RentalTenantPanel recordContext={{ recordType: "tenant", recordId }} />);
  }

  it("lists only tenants not on the lease in the Add co-tenant dropdown", () => {
    seed([
      { lease_id: "l1", tenant_id: "t1", occupancy_role: "primary" },
      { lease_id: "l1", tenant_id: "t2", occupancy_role: "co_tenant" },
    ], [primary, spouse, unassigned]);
    const markup = recordMarkup("t1");
    expect(markup).toContain("Add co-tenant");
    expect(markup).toContain("Unassigned — unassigned@example.com");
    expect(markup).not.toContain("Spouse — spouse@example.com");
    expect(markup).not.toContain("Primary — primary@example.com");
  });

  it("renders an added co-tenant with email, invite, and remove controls", () => {
    seed([
      { lease_id: "l1", tenant_id: "t1", occupancy_role: "primary" },
      { lease_id: "l1", tenant_id: "t2", occupancy_role: "co_tenant" },
    ], [primary, spouse, unassigned]);
    const markup = recordMarkup("t1");
    expect(markup).toContain("Co-tenants / spouse");
    expect(markup).toContain("spouse@example.com");
    expect(markup).toContain("Send invite email");
    expect(markup).toContain("Remove co-tenant");
    expect(markup).toContain("Make primary tenant");
  });

  it("keeps the empty state when no co-tenant is assigned", () => {
    seed([{ lease_id: "l1", tenant_id: "t1", occupancy_role: "primary" }], [primary, unassigned]);
    const markup = recordMarkup("t1");
    expect(markup).toContain("No co-tenant is assigned to this lease.");
    expect(markup).toContain("Add co-tenant");
  });

  it("never offers Delete unused duplicate for an attached co-tenant", () => {
    seed([
      { lease_id: "l1", tenant_id: "t1", occupancy_role: "primary" },
      { lease_id: "l1", tenant_id: "t2", occupancy_role: "co_tenant" },
    ], [primary, spouse, unassigned]);
    // Opening the co-tenant's record shows the household's primary record;
    // the delete box keys off the primary's membership, which exists.
    const markup = recordMarkup("t2");
    expect(markup).not.toContain("Delete unused duplicate");
  });
});

describe("RentalTenantPanel tenant name editing", () => {
  const primary = { id: "t1", display_name: "Steven & Jessica Crabtree", email: "combined@example.com", status: "active" };
  const lease = { id: "l1", unit_id: "u1", status: "active" };

  function recordMarkup() {
    clearSWRCache();
    seedCacheEntry("rental:tenants", { tenants: [primary], leases: [lease],
      leaseMemberships: [{ lease_id: "l1", tenant_id: "t1", occupancy_role: "primary" }],
      units: [{ id: "u1", label: "4225 Barnhill" }], openCharges: [] });
    return renderToStaticMarkup(<RentalTenantPanel recordContext={{ recordType: "tenant", recordId: "t1" }} />);
  }

  it("renders a Tenant name field prefilled with the current display name", () => {
    const markup = recordMarkup();
    expect(markup).toContain("Tenant name");
    expect(markup).toContain('name="tenantName"');
    expect(markup).toContain('value="Steven &amp; Jessica Crabtree"');
    expect(markup).toContain("Save tenant information");
  });

  it("builds the save payload from the Tenant name field", () => {
    const form = new Map([
      ["tenantName", "Jessica Crabtree"],
      ["phone", "555-1000"],
      ["monthlyIncome", ""],
    ]);
    const payload = tenantProfilePayload({ get: (name) => form.get(name) ?? null });
    expect(payload.displayName).toBe("Jessica Crabtree");
    expect(payload.phone).toBe("555-1000");
    expect(payload.monthlyIncomeCents).toBeNull();
  });
});
