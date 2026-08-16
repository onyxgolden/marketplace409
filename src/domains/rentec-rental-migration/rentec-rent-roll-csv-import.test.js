import { describe, expect, it } from "vitest";
import { buildRentRollImportPlan } from "./rentec-rent-roll-csv-import.js";

const units = [
  { id: "unit_1218wagner", property_id: "1218-wagner" },
  { id: "unit_670rachal", property_id: "670-rachal" },
  { id: "unit_8760oldhwy90", property_id: "8760-old-hwy-90" },
  { id: "unit_4800kentave", property_id: "4800-kent-ave" },
  { id: "unit_335butler", property_id: "335-butler" },
  { id: "unit_1900wdecker", property_id: "1900-w-decker" },
];
const tenants = [
  { id: "tenant_stelly", display_name: "Nicole Stelly" },
  { id: "tenant_saavedra", display_name: "Malissa Saavedra" },
  { id: "tenant_babino", display_name: "Anthony Babino" },
  { id: "tenant_johnson_james", display_name: "James Johnson" },
  { id: "tenant_johnson_cheryl", display_name: "Cheryl Johnson" },
  { id: "tenant_smith_nicole", display_name: "Nicole Smith" },
];
const leases = [
  { id: "lease_1218wagner", unit_id: "unit_1218wagner", status: "draft", start_date: "2026-08-01" },
  { id: "lease_670rachal", unit_id: "unit_670rachal", status: "active", start_date: "2026-05-01" },
];

const csv = [
  'PROPERTY,TENANT,"LEASE START","LEASE END",DEPOSIT,RENT,SQ FT,RENT/SQ FT',
  '"BUSINESS EXPENSES","XP Property Management, LLC",N/A,N/A,0.00,0.00,,',
  '"8760 OLD HWY 90","Babino, Anthony",N/A,11/01/2023,"1,200.00","1,675.00","3,000",0.56',
  '"4800 KENT AVE",Vacant,,,,,,,,',
  '"335 BUTLER","Johnson, James & Cheryl",05/31/2024,06/01/2025,"1,000.00","1,375.00","1,332",1.03',
  '"1218 WAGNER","Stelly, Nicole",08/01/2026,08/01/2027,"1,300.00","1,300.00",805,1.61',
  '"670 RACHAL","Saavedra, Malissa",05/01/2026,05/01/2027,"1,700.00","1,700.00","1,568",1.08',
  '"1900 W. DECKER","Smith, Nicole",07/01/2019,N/A,"1,000.00","1,425.00","1,464",0.97',
  '"999 NOWHERE","Ghost, Casper",01/01/2020,N/A,"500.00","900.00",,',
  '"335 BUTLER","Unknown, Person",01/01/2020,N/A,"500.00","900.00",,',
  'Total,,,,"20,500.00","27,295.00",,',
].join("\n");

describe("buildRentRollImportPlan", () => {
  it("skips the fake Business Expenses property", () => {
    const plan = buildRentRollImportPlan(csv, { units, tenants, leases });
    const row = plan.rows.find((item) => item.propertyLabel === "BUSINESS EXPENSES");
    expect(row).toMatchObject({ action: "skip", reason: "Not a real rental property." });
  });

  it("skips vacant rows", () => {
    const plan = buildRentRollImportPlan(csv, { units, tenants, leases });
    const row = plan.rows.find((item) => item.propertyLabel === "4800 KENT AVE");
    expect(row).toMatchObject({ action: "skip", reason: "Vacant in the rent roll." });
  });

  it("proposes adding a deposit to a lease that's already on file, slugifying the property label to match", () => {
    const plan = buildRentRollImportPlan(csv, { units, tenants, leases });
    const row = plan.rows.find((item) => item.propertyLabel === "670 RACHAL");
    expect(row).toMatchObject({ action: "add-deposit", existingLeaseId: "lease_670rachal", primaryTenantId: "tenant_saavedra", depositCents: 170000 });
  });

  it("proposes a new lease with the correct unit, tenant, rent, and dates for a property with no existing lease", () => {
    const plan = buildRentRollImportPlan(csv, { units, tenants, leases });
    const row = plan.rows.find((item) => item.propertyLabel === "8760 OLD HWY 90");
    expect(row).toMatchObject({ action: "new-lease", unitId: "unit_8760oldhwy90", tenantIds: ["tenant_babino"], endDate: "2023-11-01", monthlyRentCents: 167500, depositCents: 120000 });
  });

  it("flags a missing start date as an issue but still proposes the lease using today as a placeholder", () => {
    const plan = buildRentRollImportPlan(csv, { units, tenants, leases });
    const row = plan.rows.find((item) => item.propertyLabel === "8760 OLD HWY 90");
    expect(row.issues.some((issue) => issue.includes("No lease start date"))).toBe(true);
    expect(row.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("attaches both matched tenants for a co-tenant row", () => {
    const plan = buildRentRollImportPlan(csv, { units, tenants, leases });
    const row = plan.rows.find((item) => item.propertyLabel === "335 BUTLER" && item.tenantLabel.includes("James"));
    expect(row.tenantIds).toEqual(["tenant_johnson_james", "tenant_johnson_cheryl"]);
  });

  it("marks a row unmatched when no saved unit matches the property", () => {
    const plan = buildRentRollImportPlan(csv, { units, tenants, leases });
    const row = plan.rows.find((item) => item.propertyLabel === "999 NOWHERE");
    expect(row).toMatchObject({ action: "unmatched" });
    expect(row.reason).toContain("999-nowhere");
  });

  it("marks a row unmatched when no saved tenant matches the name", () => {
    const plan = buildRentRollImportPlan(csv, { units, tenants, leases });
    const row = plan.rows.find((item) => item.tenantLabel === "Unknown, Person");
    expect(row).toMatchObject({ action: "unmatched" });
    expect(row.reason).toContain("Unknown, Person");
  });

  it("ignores the trailing Total summary row", () => {
    const plan = buildRentRollImportPlan(csv, { units, tenants, leases });
    expect(plan.rows.some((item) => item.propertyLabel.toLowerCase() === "total")).toBe(false);
  });

  it("resolves 1900 W. Decker's period-and-space property label to the stored 1900-w-decker unit", () => {
    const plan = buildRentRollImportPlan(csv, { units, tenants, leases });
    const row = plan.rows.find((item) => item.propertyLabel === "1900 W. DECKER");
    expect(row.action).toBe("new-lease");
    expect(row.unitId).toBe("unit_1900wdecker");
  });
});
