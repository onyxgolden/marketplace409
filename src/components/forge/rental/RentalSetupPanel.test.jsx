// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache, fetchWithDedupe } from "../../../hooks/swrCache";
import RentalSetupPanel, { activeBalanceCentsForUnit, countUnitsForStatusBar, filterUnitsForStatusBar, tenantLabelForUnit } from "./RentalSetupPanel";

const leases = [
  { id: "lease_1", unit_id: "unit_1", status: "active" },
  { id: "lease_2", unit_id: "unit_2", status: "ended" },
];
const leaseMemberships = [{ lease_id: "lease_1", tenant_id: "tenant_1" }, { lease_id: "lease_1", tenant_id: "tenant_2" }];
const tenants = [{ id: "tenant_1", display_name: "Ashley George" }, { id: "tenant_2", display_name: "Justin Graham" }];

describe("tenantLabelForUnit", () => {
  it("joins every tenant on the unit's active lease", () => {
    expect(tenantLabelForUnit({ id: "unit_1" }, leases, leaseMemberships, tenants)).toBe("Ashley George, Justin Graham");
  });
  it("returns null when the unit's only lease is not active", () => {
    expect(tenantLabelForUnit({ id: "unit_2" }, leases, leaseMemberships, tenants)).toBeNull();
  });
  it("returns null when the unit has no lease at all", () => {
    expect(tenantLabelForUnit({ id: "unit_3" }, leases, leaseMemberships, tenants)).toBeNull();
  });
  it("returns null when an active lease has no tenant membership recorded", () => {
    expect(tenantLabelForUnit({ id: "unit_1" }, leases, [], tenants)).toBeNull();
  });
});

describe("activeBalanceCentsForUnit", () => {
  it("totals the remaining open charges on the unit's active lease", () => {
    const charges = [
      { lease_id: "lease_1", amount_cents: 120000, paid_amount_cents: 20000 },
      { lease_id: "lease_1", amount_cents: 5000, paid_amount_cents: 0 },
      { lease_id: "lease_2", amount_cents: 90000, paid_amount_cents: 0 },
    ];
    expect(activeBalanceCentsForUnit({ id: "unit_1" }, leases, charges)).toBe(105000);
  });
  it("returns zero when an occupied unit has no open charges", () => {
    expect(activeBalanceCentsForUnit({ id: "unit_1" }, leases, [])).toBe(0);
  });
  it("returns null when the unit has no active lease", () => {
    expect(activeBalanceCentsForUnit({ id: "unit_2" }, leases, [])).toBeNull();
  });
});

describe("filterUnitsForStatusBar", () => {
  const statusUnits = [
    { id: "unit_1", status: "occupied" },
    { id: "unit_2", status: "preparing" },
    { id: "unit_3", status: "available" },
    { id: "unit_4", status: "occupied", property_id: "archived" },
    { id: "unit_5", status: "inactive" },
  ];
  // unit_1 has the active lease (not vacant); unit_2's lease ended and unit_3
  // and unit_4 have none (all vacant); unit_5 is inactive so it never appears.
  const byId = (units) => units.map((unit) => unit.id);
  it("shows every active unit with no filter", () => {
    expect(byId(filterUnitsForStatusBar(statusUnits, null, leases, leaseMemberships, tenants)))
      .toEqual(["unit_1", "unit_2", "unit_3", "unit_4"]);
  });
  it("filters by unit status", () => {
    expect(byId(filterUnitsForStatusBar(statusUnits, "preparing", leases, leaseMemberships, tenants))).toEqual(["unit_2"]);
    expect(byId(filterUnitsForStatusBar(statusUnits, "available", leases, leaseMemberships, tenants))).toEqual(["unit_3"]);
    expect(byId(filterUnitsForStatusBar(statusUnits, "occupied", leases, leaseMemberships, tenants))).toEqual(["unit_1", "unit_4"]);
  });
  it("treats vacant as no active lease, not the occupied status", () => {
    expect(byId(filterUnitsForStatusBar(statusUnits, "vacant", leases, leaseMemberships, tenants))).toEqual(["unit_2", "unit_3", "unit_4"]);
  });
  it("never shows archived units in any filtered view", () => {
    expect(byId(filterUnitsForStatusBar(statusUnits, "vacant", leases, leaseMemberships, tenants))).not.toContain("unit_5");
    expect(byId(filterUnitsForStatusBar(statusUnits, null, leases, leaseMemberships, tenants))).not.toContain("unit_5");
  });
});

describe("countUnitsForStatusBar", () => {
  it("counts active units per chip and excludes archived units", () => {
    const units = [
      { id: "unit_1", status: "occupied" },
      { id: "unit_2", status: "preparing" },
      { id: "unit_3", status: "available" },
      { id: "unit_5", status: "inactive" },
    ];
    expect(countUnitsForStatusBar(units, leases, leaseMemberships, tenants)).toEqual({
      all: 3, preparing: 1, available: 1, occupied: 1, vacant: 2,
    });
  });
});

describe("RentalSetupPanel status bar", () => {
  it("renders one chip per status with the matching unit count", () => {
    const markup = renderToStaticMarkup(<RentalSetupPanel initialUnits={[
      { id: "unit_1", label: "930 Highland Drive", property_id: "930-highland-drive", status: "preparing" },
      { id: "unit_2", label: "308 Paula", property_id: "308-paula", status: "available" },
      { id: "unit_3", label: "4225 Barnhill", property_id: "4225-barnhill", status: "occupied" },
    ]} />);
    // No leases in the seed, so every unit counts as vacant.
    expect(markup).toContain("All (3)");
    expect(markup).toContain("Preparing (1)");
    expect(markup).toContain("Available (1)");
    expect(markup).toContain("Occupied (1)");
    expect(markup).toContain("Vacant (3)");
  });
});

describe("RentalSetupPanel new-unit creation", () => {
  afterEach(() => { clearSWRCache(); });
  it("labels the create action generically instead of naming a specific property", async () => {
    // Seed the SWR cache so the converted panel renders its create form instead
    // of the loading skeleton on a cold static render.
    await fetchWithDedupe("rental:setup", () => Promise.resolve({ units: [], leases: [], leaseMemberships: [], tenants: [], openCharges: [] }));
    const markup = renderToStaticMarkup(<RentalSetupPanel />);
    expect(markup).toContain("Review and create property / unit");
    expect(markup).not.toContain("Save Kent Avenue unit");
  });
  it("uses one-line property, address, tenant, status, and balance columns like the tenant index", () => {
    const markup = renderToStaticMarkup(<RentalSetupPanel initialUnits={[{ id: "unit_1", label: "930 Highland Drive", property_id: "930-highland-drive", status: "occupied" }]} />);
    expect(markup).toContain('data-list-size="wide"');
    expect(markup).toContain(">Property<");
    expect(markup).toContain(">Address<");
    expect(markup).toContain(">Tenant<");
    expect(markup).toContain(">Status<");
    expect(markup).toContain("Active balance");
    expect(markup).toContain("930 Highland Drive");
    expect(markup).not.toContain("Property address");
  });
  it("offers Add tenant instead of labeling an unleased property vacant", () => {
    const markup = renderToStaticMarkup(<RentalSetupPanel initialUnits={[{ id: "unit_1", label: "930 Highland Drive", property_id: "930-highland-drive", status: "available" }]} />);
    expect(markup).toContain("Add tenant");
    expect(markup).not.toContain(">Vacant<");
  });
});

describe("RentalSetupPanel eyebrow and create form", () => {
  afterEach(() => { clearSWRCache(); });
  it("derives the panel eyebrow from the selected unit's property label", async () => {
    await fetchWithDedupe("rental:setup", () => Promise.resolve({ units: [{ id: "unit_1", label: "930 Highland Drive", property_id: "930-highland-drive", status: "occupied" }], leases: [], leaseMemberships: [], tenants: [], openCharges: [] }));
    const markup = renderToStaticMarkup(<RentalSetupPanel />);
    expect(markup).toContain("930 Highland Drive setup");
    expect(markup).not.toContain("Kent Avenue setup");
  });
  it("ships the create form with blank fields instead of another property's sample data", async () => {
    await fetchWithDedupe("rental:setup", () => Promise.resolve({ units: [], leases: [], leaseMemberships: [], tenants: [], openCharges: [] }));
    const markup = renderToStaticMarkup(<RentalSetupPanel />);
    expect(markup).toContain("Create a new property / unit");
    expect(markup).not.toContain('value="4800-kent-ave"');
    expect(markup).not.toContain('value="Main residence"');
    expect(markup).not.toContain('value="Remodel in progress."');
  });
  it("renders structured address fields on the create form", async () => {
    await fetchWithDedupe("rental:setup", () => Promise.resolve({ units: [], leases: [], leaseMemberships: [], tenants: [], openCharges: [] }));
    const markup = renderToStaticMarkup(<RentalSetupPanel />);
    expect(markup).toContain("Property address");
    expect(markup).toContain('name="addressStreet"');
    expect(markup).toContain('name="addressUnit"');
    expect(markup).toContain('name="addressCity"');
    expect(markup).toContain('name="addressState"');
    expect(markup).toContain('name="addressZip"');
    expect(markup).toContain('value="TX"');
    expect(markup).toContain("District of Columbia");
  });
  it("displays a structured address on the property card and falls back to the label", () => {
    const withAddress = { id: "unit_1", label: "308 Paula", property_id: "308-paula", status: "occupied",
      address_street: "308 Paula St", address_unit: "", address_city: "Groves", address_state: "TX", address_zip: "77605" };
    const legacy = { id: "unit_2", label: "930 Highland Drive", property_id: "930-highland-drive", status: "available" };
    const markup = renderToStaticMarkup(<RentalSetupPanel initialUnits={[withAddress, legacy]} />);
    expect(markup).toContain("308 Paula St, Groves, TX 77605");
    expect(markup).toContain("930 Highland Drive");
    expect(markup).toContain(">Address</dt>");
  });
});

describe("RentalSetupPanel property row context menu", () => {
  let container;
  let root;
  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    root = null;
    clearSWRCache();
  });

  it("right-clicking a property row opens the full property menu (tenant parity)", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<RentalSetupPanel initialUnits={[{ id: "unit_1", label: "930 Highland Drive", property_id: "930-highland-drive", status: "occupied" }]} />));
    const row = [...container.querySelectorAll('tr[role="button"]')].find((r) => r.textContent.includes("930 Highland Drive"));
    expect(row).not.toBeUndefined();
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 80, clientY: 90 });
    act(() => row.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    const menu = container.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    for (const label of ["View ledger", "Open full expenses ledger", "Edit property details", "Manage lease", "Rent & payments", "Financial setup", "Work orders", "Inspections", "File library", "Archive duplicate / inactive property"]) {
      expect(menu.textContent).toContain(label);
    }
  });

  it("keeps every property table cell on one line", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<RentalSetupPanel initialUnits={[{ id: "unit_1", label: "930 Highland Drive", property_id: "930-highland-drive", status: "occupied", address_street: "930 Highland Drive", address_city: "Groves", address_state: "TX", address_zip: "77605" }]} />));
    const row = [...container.querySelectorAll('tr[role="button"]')].find((r) => r.textContent.includes("930 Highland Drive"));
    expect(row).not.toBeUndefined();
    for (const cell of row.querySelectorAll("td")) {
      // No stacked multi-line blocks: each cell's content is a single line.
      expect(cell.querySelectorAll(":scope > .block").length).toBeLessThanOrEqual(1);
    }
  });
});
