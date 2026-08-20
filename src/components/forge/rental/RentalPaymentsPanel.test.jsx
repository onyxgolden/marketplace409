// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalPaymentsPanel, { defaultChargeMonth, resolveScheduleContext } from "./RentalPaymentsPanel";

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
