// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalPaymentsPanel, { chargeCollectionLabel, defaultChargeMonth, isChargeVoidable, resolveChargeIdentity, resolveScheduleContext } from "./RentalPaymentsPanel";

const baseData = {
  openCharges: [], payments: [], settlements: [],
  leases: [
    { id: "lease_1", unit_id: "unit_1", property_id: "property-1", status: "active" },
    { id: "lease_2", unit_id: "unit_2", property_id: "property-2", status: "active" },
  ],
  units: [
    { id: "unit_1", label: "Main residence", property_id: "property-1" },
    { id: "unit_2", label: "TEST-", property_id: "property-2" },
  ],
  tenants: [
    { id: "tenant_1", display_name: "Anthony Babino" },
    { id: "tenant_2", display_name: "Brandy Morgan" },
  ],
  leaseMemberships: [
    { lease_id: "lease_1", tenant_id: "tenant_1" },
    { lease_id: "lease_2", tenant_id: "tenant_2" },
  ],
  schedules: [
    { id: "schedule_1", lease_id: "lease_1", amount_cents: 130000, due_day: 1, status: "active" },
    { id: "schedule_2", lease_id: "lease_2", amount_cents: 130000, due_day: 1, status: "active" },
  ],
};

describe("resolveScheduleContext", () => {
  it("resolves tenant through lease memberships, unit through lease.unit_id, and property through the unit", () => {
    expect(resolveScheduleContext(baseData.schedules[1], baseData)).toEqual({
      leaseId: "lease_2", leaseStatus: "active", tenantLabel: "Brandy Morgan", unitLabel: "TEST-", propertyLabel: "property-2",
    });
  });

  it("distinguishes two schedules with identical rent and due day by tenant/unit/property", () => {
    expect(baseData.schedules[0].amount_cents).toBe(baseData.schedules[1].amount_cents);
    expect(baseData.schedules[0].due_day).toBe(baseData.schedules[1].due_day);
    const contextOne = resolveScheduleContext(baseData.schedules[0], baseData);
    const contextTwo = resolveScheduleContext(baseData.schedules[1], baseData);
    expect(contextOne.tenantLabel).not.toBe(contextTwo.tenantLabel);
    expect(contextOne.unitLabel).not.toBe(contextTwo.unitLabel);
    expect(contextOne.propertyLabel).not.toBe(contextTwo.propertyLabel);
  });

  it("joins every tenant on a multi-tenant lease instead of guessing a single one", () => {
    const data = { ...baseData, leaseMemberships: [...baseData.leaseMemberships, { lease_id: "lease_1", tenant_id: "tenant_2" }] };
    expect(resolveScheduleContext(baseData.schedules[0], data).tenantLabel).toBe("Anthony Babino, Brandy Morgan");
  });

  it("shows an explicit Unknown warning instead of silently omitting an unresolved tenant", () => {
    const data = { ...baseData, leaseMemberships: [] };
    expect(resolveScheduleContext(baseData.schedules[0], data).tenantLabel).toBe("Unknown tenant");
  });

  it("shows an explicit Unknown warning instead of silently omitting an unresolved unit", () => {
    const data = { ...baseData, units: [] };
    expect(resolveScheduleContext(baseData.schedules[0], data).unitLabel).toBe("Unknown unit");
  });

  it("falls back to the lease's own property id, then an explicit Unknown warning, when neither the unit nor lease can be resolved", () => {
    const noUnitData = { ...baseData, units: [] };
    expect(resolveScheduleContext(baseData.schedules[0], noUnitData).propertyLabel).toBe("property-1");
    const noLeaseData = { ...baseData, leases: [] };
    expect(resolveScheduleContext(baseData.schedules[0], noLeaseData).propertyLabel).toBe("Unknown property");
  });

  it("reports an unresolved lease explicitly instead of guessing a status", () => {
    const data = { ...baseData, leases: [] };
    expect(resolveScheduleContext(baseData.schedules[0], data).leaseStatus).toBeNull();
  });
});

describe("defaultChargeMonth", () => {
  it("defaults to the current month when the schedule was already effective before it", () => {
    const schedule = { due_day: 1, effective_start_date: "2026-07-01" };
    expect(defaultChargeMonth(schedule, new Date("2026-08-19T12:00:00Z"))).toBe("2026-08");
  });

  it("rolls forward to next month when the current month's due date falls before the schedule's effective start", () => {
    const schedule = { due_day: 1, effective_start_date: "2026-08-19" };
    expect(defaultChargeMonth(schedule, new Date("2026-08-19T12:00:00Z"))).toBe("2026-09");
  });

  it("rolls forward correctly across a year boundary", () => {
    const schedule = { due_day: 1, effective_start_date: "2026-12-19" };
    expect(defaultChargeMonth(schedule, new Date("2026-12-19T12:00:00Z"))).toBe("2027-01");
  });

  it("uses the current month when the schedule has no recorded effective start date", () => {
    const schedule = { due_day: 1, effective_start_date: null };
    expect(defaultChargeMonth(schedule, new Date("2026-08-19T12:00:00Z"))).toBe("2026-08");
  });
});

describe("RentalPaymentsPanel charge-generation identity", () => {
  it("shows tenant, unit, and property for every charge-generation row, distinguishing identical-rent leases", () => {
    const markup = renderToStaticMarkup(<RentalPaymentsPanel initialData={baseData} initialAccount={null} initialShowSetup />);
    expect(markup).toContain("Anthony Babino");
    expect(markup).toContain("Main residence");
    expect(markup).toContain("property-1");
    expect(markup).toContain("Brandy Morgan");
    expect(markup).toContain("TEST-");
    expect(markup).toContain("property-2");
  });

  it("keeps the Generate monthly charge action tied to the correct schedule", () => {
    const markup = renderToStaticMarkup(<RentalPaymentsPanel initialData={baseData} initialAccount={null} initialShowSetup />);
    expect(markup.split("Generate monthly charge").length - 1).toBe(2);
  });

  it("shows an explicit Unknown warning in the row instead of silently omitting identity", () => {
    const orphanData = { ...baseData, leaseMemberships: [], units: [], leases: [] };
    const markup = renderToStaticMarkup(<RentalPaymentsPanel initialData={orphanData} initialAccount={null} initialShowSetup />);
    expect(markup).toContain("Unknown tenant");
    expect(markup).toContain("Unknown unit");
    expect(markup).toContain("Unknown property");
  });
});

function findButtonByText(container, text) {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === text);
  if (!button) throw new Error(`No button found with text "${text}"`);
  return button;
}
function findAllButtonsByText(container, text) {
  return Array.from(container.querySelectorAll("button")).filter((candidate) => candidate.textContent === text);
}
function clickButton(button) {
  act(() => { button.click(); });
}
async function clickButtonAndFlush(button) {
  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}
function mountPanel(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}
function unmountPanel({ container, root }) {
  act(() => { root.unmount(); });
  container.remove();
}

describe("RentalPaymentsPanel Generate monthly charge interaction", () => {
  let mounted;

  afterEach(() => {
    if (mounted) { unmountPanel(mounted); mounted = null; }
    vi.unstubAllGlobals();
  });

  it("submits the correct schedule id for the clicked row, even when two leases share identical rent and due day", async () => {
    const fetchMock = vi.fn((url, options) => {
      if (options?.method === "POST") {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, charge: { id: "charge_1", period: "2026-08" } }) });
      }
      return Promise.resolve({ ok: true, json: async () => baseData });
    });
    vi.stubGlobal("fetch", fetchMock);

    mounted = mountPanel(<RentalPaymentsPanel initialData={baseData} initialAccount={{ status: "enabled", requirements_due: [] }} />);
    const { container } = mounted;

    clickButton(findButtonByText(container, "Billing setup"));

    const generateButtons = findAllButtonsByText(container, "Generate monthly charge");
    expect(generateButtons).toHaveLength(2);

    await clickButtonAndFlush(generateButtons[1]);

    const postCall = fetchMock.mock.calls.find(([, options]) => options?.method === "POST");
    expect(postCall).toBeTruthy();
    const body = JSON.parse(postCall[1].body);
    expect(body).toMatchObject({ operation: "generate-charge", scheduleId: "schedule_2" });
  });

  it("reproduces and fixes the reported failure: a schedule activated today with due_day 1 must not default to today's month", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T12:00:00Z"));
    try {
      const freshlyActivatedData = {
        ...baseData,
        leases: [baseData.leases[0]],
        units: [baseData.units[0]],
        tenants: [baseData.tenants[0]],
        leaseMemberships: [baseData.leaseMemberships[0]],
        schedules: [{ id: "schedule_1", lease_id: "lease_1", amount_cents: 130000, due_day: 1, status: "active", effective_start_date: "2026-08-19" }],
      };
      const fetchMock = vi.fn((url, options) => {
        if (options?.method === "POST") return Promise.resolve({ ok: true, json: async () => ({ success: true, charge: { id: "charge_1", period: "2026-09" } }) });
        return Promise.resolve({ ok: true, json: async () => freshlyActivatedData });
      });
      vi.stubGlobal("fetch", fetchMock);

      mounted = mountPanel(<RentalPaymentsPanel initialData={freshlyActivatedData} initialAccount={{ status: "enabled", requirements_due: [] }} />);
      const { container } = mounted;
      clickButton(findButtonByText(container, "Billing setup"));

      const periodInput = container.querySelector('input[name="period"]');
      expect(periodInput.value).toBe("2026-09");

      await clickButtonAndFlush(findButtonByText(container, "Generate monthly charge"));

      const postCall = fetchMock.mock.calls.find(([, options]) => options?.method === "POST");
      const body = JSON.parse(postCall[1].body);
      expect(body).toMatchObject({ operation: "generate-charge", scheduleId: "schedule_1", period: "2026-09" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("isChargeVoidable", () => {
  it("allows voiding an unpaid, not-yet-void charge", () => {
    expect(isChargeVoidable({ status: "due", paid_amount_cents: 0 })).toBe(true);
  });
  it("refuses to void a charge with any payment recorded", () => {
    expect(isChargeVoidable({ status: "partially_paid", paid_amount_cents: 50000 })).toBe(false);
    expect(isChargeVoidable({ status: "paid", paid_amount_cents: 130000 })).toBe(false);
  });
  it("refuses to void an already-void charge", () => {
    expect(isChargeVoidable({ status: "void", paid_amount_cents: 0 })).toBe(false);
  });
});

describe("RentalPaymentsPanel Void charge action", () => {
  const voidableCharge = { id: "charge_1", lease_id: "lease_1", schedule_id: "schedule_1", period: "2026-08",
    due_date: "2026-08-01", amount_cents: 130000, paid_amount_cents: 0, currency_code: "USD", status: "due", charge_type: "rent" };
  const withCharge = { ...baseData, openCharges: [voidableCharge] };
  let mounted;

  afterEach(() => {
    if (mounted) { unmountPanel(mounted); mounted = null; }
    vi.unstubAllGlobals();
  });

  it("shows a Void charge action for an unpaid open charge", () => {
    const markup = renderToStaticMarkup(<RentalPaymentsPanel initialData={withCharge} initialAccount={null} />);
    expect(markup).toContain("Void charge");
  });

  it("does not show a Void charge action for an already-paid charge", () => {
    const paidData = { ...baseData, openCharges: [{ ...voidableCharge, status: "paid", paid_amount_cents: 130000 }] };
    const markup = renderToStaticMarkup(<RentalPaymentsPanel initialData={paidData} initialAccount={null} />);
    expect(markup).not.toContain("Void charge");
  });

  it("requires an explicit confirmation step before a reason and confirmed void request can be submitted", async () => {
    const fetchMock = vi.fn((url, options) => {
      if (options?.method === "POST") return Promise.resolve({ ok: true, json: async () => ({ success: true, charge: { id: "charge_1", status: "void" } }) });
      return Promise.resolve({ ok: true, json: async () => ({ ...withCharge, openCharges: [] }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    mounted = mountPanel(<RentalPaymentsPanel initialData={withCharge} initialAccount={{ status: "enabled", requirements_due: [] }} />);
    const { container } = mounted;

    expect(container.querySelector('form[aria-label="Void charge"]')).toBeNull();
    clickButton(findButtonByText(container, "Void charge"));
    const voidForm = container.querySelector('form[aria-label="Void charge"]');
    expect(voidForm).toBeTruthy();
    expect(voidForm.querySelector('input[name="reason"]')).toBeTruthy();
    expect(voidForm.querySelector('input[name="confirmed"][type="checkbox"]')).toBeTruthy();

    voidForm.querySelector('input[name="reason"]').value = "Generated against the wrong lease.";
    voidForm.querySelector('input[name="confirmed"]').checked = true;

    await act(async () => {
      voidForm.querySelector('button[type="submit"]').click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    const postCall = fetchMock.mock.calls.find(([, options]) => options?.method === "POST");
    expect(postCall).toBeTruthy();
    const body = JSON.parse(postCall[1].body);
    expect(body).toEqual({ operation: "void-charge", chargeId: "charge_1", reason: "Generated against the wrong lease." });
  });

  it("disappears from open charges once voided, without any client-side deletion of the record", async () => {
    const fetchMock = vi.fn((url, options) => {
      if (options?.method === "POST") return Promise.resolve({ ok: true, json: async () => ({ success: true, charge: { id: "charge_1", status: "void" } }) });
      return Promise.resolve({ ok: true, json: async () => ({ ...withCharge, openCharges: [] }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    mounted = mountPanel(<RentalPaymentsPanel initialData={withCharge} initialAccount={{ status: "enabled", requirements_due: [] }} />);
    const { container } = mounted;

    clickButton(findButtonByText(container, "Void charge"));
    const voidForm = container.querySelector('form[aria-label="Void charge"]');
    voidForm.querySelector('input[name="reason"]').value = "Generated against the wrong lease.";
    voidForm.querySelector('input[name="confirmed"]').checked = true;
    await act(async () => {
      voidForm.querySelector('button[type="submit"]').click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(container.textContent).toContain("No rent charges or payments recorded.");
  });
});

describe("resolveChargeIdentity", () => {
  it("resolves tenant, unit, and property through charge.lease_id, not by guessing from amount or unit", () => {
    expect(resolveChargeIdentity({ lease_id: "lease_2" }, baseData)).toMatchObject({
      leaseId: "lease_2", tenantLabel: "Brandy Morgan", unitLabel: "TEST-", propertyLabel: "property-2",
    });
  });

  it("shows explicit Unknown warnings instead of silently omitting identity", () => {
    expect(resolveChargeIdentity({ lease_id: "lease_missing" }, baseData)).toMatchObject({
      tenantLabel: "Unknown tenant", unitLabel: "Unknown unit", propertyLabel: "Unknown property",
    });
  });
});

describe("RentalPaymentsPanel charge identity safety (regression)", () => {
  const REAL_LEASE_ID = "rental_lease_rentec_1628399";
  const SANDBOX_LEASE_ID = "rental_lease_c151ed02-8b18-4534-baaa-b9aaf4aca219";

  const identityData = {
    openCharges: [{
      id: "rent_charge_rent_schedule_e6569d58-3382-496b-9667-3cd8c0f3582a_202608",
      lease_id: REAL_LEASE_ID, schedule_id: "rent_schedule_e6569d58-3382-496b-9667-3cd8c0f3582a",
      period: "2026-08", due_date: "2026-08-01", amount_cents: 130000, paid_amount_cents: 0,
      currency_code: "USD", status: "due", charge_type: "rent",
    }],
    payments: [], settlements: [],
    leases: [
      { id: REAL_LEASE_ID, unit_id: "unit_real", property_id: "4800-kent-ave", status: "active" },
      { id: SANDBOX_LEASE_ID, unit_id: "unit_sandbox", property_id: "FORGE SANDBOX TEST PROPERTY", status: "active" },
    ],
    units: [
      { id: "unit_real", label: "Main residence", property_id: "4800-kent-ave" },
      { id: "unit_sandbox", label: "TEST-", property_id: "FORGE SANDBOX TEST PROPERTY" },
    ],
    tenants: [
      { id: "tenant_real", display_name: "Existing Tenant" },
      { id: "tenant_sandbox", display_name: "Brandy Morgan" },
    ],
    leaseMemberships: [
      { lease_id: REAL_LEASE_ID, tenant_id: "tenant_real" },
      { lease_id: SANDBOX_LEASE_ID, tenant_id: "tenant_sandbox" },
    ],
    schedules: [],
  };

  it("proves a $1,300 charge on the real lease cannot be visually mistaken for the sandbox lease", () => {
    const markup = renderToStaticMarkup(<RentalPaymentsPanel initialData={identityData} initialAccount={null} />);
    // The charge must clearly identify the real tenant/lease it actually belongs to.
    expect(markup).toContain("Existing Tenant");
    expect(markup).toContain(REAL_LEASE_ID);
    // It must never carry the sandbox tenant's name or the sandbox lease id anywhere.
    expect(markup).not.toContain("Brandy Morgan");
    expect(markup).not.toContain(SANDBOX_LEASE_ID);
    // The sandbox property/unit labels must not appear attached to this charge either.
    expect(markup).not.toContain("FORGE SANDBOX TEST PROPERTY");
  });

  it("the sandbox lease itself has no charges to confuse with the real one", () => {
    const sandboxCharges = identityData.openCharges.filter((charge) => charge.lease_id === SANDBOX_LEASE_ID);
    expect(sandboxCharges).toHaveLength(0);
  });
});

describe("chargeCollectionLabel", () => {
  it("labels a charge FORGE collectible when its schedule is cut over", () => {
    const schedules = [{ id: "schedule_1", collection_mode: "forge", forge_cutover_date: "2026-01-01" }];
    expect(chargeCollectionLabel({ schedule_id: "schedule_1", due_date: "2026-08-01" }, schedules, "2026-08-16")).toBe("FORGE collectible");
  });
  it("labels a charge externally managed when its schedule is still external", () => {
    const schedules = [{ id: "schedule_2", collection_mode: "external", forge_cutover_date: null }];
    expect(chargeCollectionLabel({ schedule_id: "schedule_2", due_date: "2026-08-01" }, schedules, "2026-08-16")).toBe("Externally managed — reconciliation required");
  });
  it("labels a charge externally managed when no schedule matches (fails safe)", () => {
    expect(chargeCollectionLabel({ schedule_id: "schedule_missing", due_date: "2026-08-01" }, [], "2026-08-16")).toBe("Externally managed — reconciliation required");
  });
  it("defaults 'today' to the real current date when omitted, so a future cutover is never misclassified as already collectible", () => {
    const schedules = [{ id: "schedule_future", collection_mode: "forge", forge_cutover_date: "2099-01-01" }];
    expect(chargeCollectionLabel({ schedule_id: "schedule_future", due_date: "2099-01-02" }, schedules)).toBe("Externally managed — reconciliation required");
  });
});

// "Landlord charge lists" containment: every charge row must show whether it's FORGE-collectible
// or still externally managed — never inferred from status, which looks identical either way.
describe("RentalPaymentsPanel charge collection-authority visibility", () => {
  const externallyManagedData = {
    ...baseData,
    openCharges: [{ id: "charge_1", lease_id: "lease_1", schedule_id: "schedule_external", period: "2026-08",
      due_date: "2026-08-01", amount_cents: 1427000, paid_amount_cents: 0, currency_code: "USD", status: "due", charge_type: "rent" }],
    schedules: [{ id: "schedule_external", lease_id: "lease_1", amount_cents: 130000, due_day: 1, status: "active",
      collection_mode: "external", forge_cutover_date: null }],
  };

  it("labels an externally-managed charge as such in the record list, and still shows its amount in full", () => {
    const markup = renderToStaticMarkup(<RentalPaymentsPanel initialData={externallyManagedData} initialAccount={null} />);
    expect(markup).toContain("Externally managed — reconciliation required");
    expect(markup).toContain("$14,270.00");
  });

  it("labels a FORGE-collectible charge as such, not externally managed", () => {
    const forgeData = { ...externallyManagedData, schedules: [{ ...externallyManagedData.schedules[0], id: "schedule_forge",
      collection_mode: "forge", forge_cutover_date: "2020-01-01" }],
      openCharges: [{ ...externallyManagedData.openCharges[0], schedule_id: "schedule_forge" }] };
    const markup = renderToStaticMarkup(<RentalPaymentsPanel initialData={forgeData} initialAccount={null} />);
    expect(markup).toContain("FORGE collectible");
    expect(markup).not.toContain("Externally managed — reconciliation required");
  });
});

// Rental billing master pause banner — required at the top of Rent & Payments.
describe("RentalPaymentsPanel billing pause banner", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("shows PAUSED by default and offers a Resume FORGE billing control", () => {
    const markup = renderToStaticMarkup(<RentalPaymentsPanel initialData={{ ...baseData, billingEnabled: false }} initialAccount={null} />);
    expect(markup).toContain("Rental online billing: PAUSED");
    expect(markup).toContain("Resume FORGE billing");
    expect(markup).not.toContain("Rental online billing: ACTIVE");
  });

  it("shows ACTIVE and a Pause FORGE billing control when billing is enabled", () => {
    const markup = renderToStaticMarkup(<RentalPaymentsPanel initialData={{ ...baseData, billingEnabled: true }} initialAccount={null} />);
    expect(markup).toContain("Rental online billing: ACTIVE");
    expect(markup).toContain("Pause FORGE billing");
    expect(markup).not.toContain("Rental online billing: PAUSED");
  });

  it("requires an explicit confirmation before resuming — clicking Resume does not immediately call the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mountPanel(<RentalPaymentsPanel initialData={{ ...baseData, billingEnabled: false }} initialAccount={null} />);
    clickButton(findButtonByText(mounted.container, "Resume FORGE billing"));
    expect(mounted.container.textContent).toContain("only leases already individually cut over to FORGE will begin collecting");
    expect(fetchMock).not.toHaveBeenCalled();
    unmountPanel(mounted);
  });

  it("calls set-billing-enabled:true only after the resume confirmation is confirmed", async () => {
    const fetchMock = vi.fn((url) => {
      if (String(url).endsWith("/api/rental")) return Promise.resolve({ ok: true, json: async () => ({ success: true, ...baseData, billingEnabled: true }) });
      return Promise.resolve({ ok: true, json: async () => ({ account: null }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mountPanel(<RentalPaymentsPanel initialData={{ ...baseData, billingEnabled: false }} initialAccount={null} />);
    clickButton(findButtonByText(mounted.container, "Resume FORGE billing"));
    await clickButtonAndFlush(findButtonByText(mounted.container, "Confirm resume"));
    const rentalPostCalls = fetchMock.mock.calls.filter(([url, options]) => String(url).endsWith("/api/rental") && options?.method === "POST");
    expect(rentalPostCalls).toHaveLength(1);
    expect(JSON.parse(rentalPostCalls[0][1].body)).toEqual({ operation: "set-billing-enabled", enabled: true });
    unmountPanel(mounted);
  });

  it("pausing requires no confirmation and calls set-billing-enabled:false immediately", async () => {
    const fetchMock = vi.fn((url) => {
      if (String(url).endsWith("/api/rental")) return Promise.resolve({ ok: true, json: async () => ({ success: true, ...baseData, billingEnabled: false }) });
      return Promise.resolve({ ok: true, json: async () => ({ account: null }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mountPanel(<RentalPaymentsPanel initialData={{ ...baseData, billingEnabled: true }} initialAccount={null} />);
    await clickButtonAndFlush(findButtonByText(mounted.container, "Pause FORGE billing"));
    const rentalPostCalls = fetchMock.mock.calls.filter(([url, options]) => String(url).endsWith("/api/rental") && options?.method === "POST");
    expect(rentalPostCalls).toHaveLength(1);
    expect(JSON.parse(rentalPostCalls[0][1].body)).toEqual({ operation: "set-billing-enabled", enabled: false });
    unmountPanel(mounted);
  });

  it("cancelling the resume confirmation never calls the API", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mountPanel(<RentalPaymentsPanel initialData={{ ...baseData, billingEnabled: false }} initialAccount={null} />);
    clickButton(findButtonByText(mounted.container, "Resume FORGE billing"));
    clickButton(findButtonByText(mounted.container, "Cancel"));
    expect(mounted.container.textContent).toContain("Resume FORGE billing");
    expect(fetchMock).not.toHaveBeenCalled();
    unmountPanel(mounted);
  });
});
