// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache, fetchWithDedupe } from "../../../hooks/swrCache";
import { resetRentalSummaryClient } from "./rentalSummaryClient";
import { buildRentalSurface } from "./RentalApplicationShell";
import RentalPageClient from "./RentalPageClient";
import RentalSetupPanel, { isUnitVacant } from "./RentalSetupPanel";
import RentalLeasePanel, { isLeaseExpiringSoon } from "./RentalLeasePanel";
import RentalPaymentsPanel, { isChargeOverdue } from "./RentalPaymentsPanel";
import RentalMaintenancePanel, { isMaintenanceRequestOpen } from "./RentalMaintenancePanel";

function daysFromNow(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
function daysAgo(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}
function unmount({ container, root }) {
  act(() => { root.unmount(); });
  container.remove();
}
async function flushEffects() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("exception view-filter predicates", () => {
  it("predicates keep their default `today` when used inside Array.filter callbacks", () => {
    // Regression guard: Array.filter passes (item, index, array) — the panels
    // must wrap the predicate so the index never lands in the `today` slot.
    const leases = [{ status: "active", end_date: daysFromNow(10) }];
    expect(leases.filter((lease) => isLeaseExpiringSoon(lease))).toHaveLength(1);
    const charges = [{ kind: "charge", status: "open", amount_cents: 100, paid_amount_cents: 0, due_date: daysAgo(3) }];
    expect(charges.filter((charge) => isChargeOverdue(charge))).toHaveLength(1);
  });

  it("isUnitVacant: vacant only when no active lease is on file", () => {
    const leases = [{ id: "l1", unit_id: "u1", status: "active" }, { id: "l2", unit_id: "u2", status: "ended" }];
    const memberships = [{ lease_id: "l1", tenant_id: "t1" }];
    const tenants = [{ id: "t1", display_name: "Tenant One" }];
    expect(isUnitVacant({ id: "u1" }, leases, memberships, tenants)).toBe(false);
    expect(isUnitVacant({ id: "u2" }, leases, memberships, tenants)).toBe(true);
    expect(isUnitVacant({ id: "u3" }, leases, memberships, tenants)).toBe(true);
    expect(isUnitVacant({ id: "u1" }, leases, [], tenants)).toBe(true);
  });

  it("isLeaseExpiringSoon: active leases ending within the 90-day window", () => {
    expect(isLeaseExpiringSoon({ status: "active", end_date: daysFromNow(20) })).toBe(true);
    expect(isLeaseExpiringSoon({ status: "active", end_date: daysFromNow(90) })).toBe(true);
    expect(isLeaseExpiringSoon({ status: "active", end_date: daysFromNow(91) })).toBe(false);
    expect(isLeaseExpiringSoon({ status: "active", end_date: daysAgo(1) })).toBe(false);
    expect(isLeaseExpiringSoon({ status: "draft", end_date: daysFromNow(20) })).toBe(false);
    expect(isLeaseExpiringSoon({ status: "active", end_date: null })).toBe(false);
  });

  it("isChargeOverdue: a charge with a balance past its due date, never voided or paid", () => {
    const base = { kind: "charge", status: "open", amount_cents: 160000, paid_amount_cents: 0 };
    expect(isChargeOverdue({ ...base, due_date: daysAgo(5) })).toBe(true);
    expect(isChargeOverdue({ ...base, due_date: daysAgo(5), paid_amount_cents: 160000 })).toBe(false);
    expect(isChargeOverdue({ ...base, due_date: daysFromNow(5) })).toBe(false);
    expect(isChargeOverdue({ ...base, due_date: daysAgo(5), status: "void" })).toBe(false);
    expect(isChargeOverdue({ ...base, due_date: null })).toBe(false);
    expect(isChargeOverdue({ kind: "payment", status: "succeeded", amount_cents: 160000, due_date: daysAgo(5) })).toBe(false);
  });

  it("isMaintenanceRequestOpen: open-family statuses only", () => {
    for (const status of ["open", "pending", "submitted", "assigned", "in_progress", "In_Progress"]) {
      expect(isMaintenanceRequestOpen({ status })).toBe(true);
    }
    for (const status of ["completed", "cancelled", "reviewing", "scheduled"]) {
      expect(isMaintenanceRequestOpen({ status })).toBe(false);
    }
  });
});

describe("filtered queue views", () => {
  beforeEach(() => { clearSWRCache(); });
  afterEach(() => { clearSWRCache(); });

  it("setup with the vacant filter lists only units without an active lease, behind a labeled banner", async () => {
    await fetchWithDedupe("rental:setup", () => Promise.resolve({
      units: [
        { id: "u1", label: "Occupied Unit", property_id: "p1", status: "active" },
        { id: "u2", label: "Vacant Unit", property_id: "p1", status: "active" },
      ],
      leases: [{ id: "l1", unit_id: "u1", status: "active" }],
      leaseMemberships: [{ lease_id: "l1", tenant_id: "t1" }],
      tenants: [{ id: "t1", display_name: "Tenant One" }],
      openCharges: [],
    }));
    const markup = renderToStaticMarkup(<RentalSetupPanel initialViewFilter="vacant" initialUnits={[{ id: "u1" }, { id: "u2" }]} />);
    expect(markup).toContain("Vacant units only");
    expect(markup).toContain("Vacant Unit");
    expect(markup).not.toContain("Occupied Unit");
    expect(markup).toContain("1 record");
  });

  it("leases with the expiring filter lists only 90-day expiring leases, behind a labeled banner", async () => {
    await fetchWithDedupe("rental:lease-setup", () => Promise.resolve({
      units: [{ id: "u1", label: "Unit 1" }],
      tenants: [],
      leases: [
        { id: "l1", unit_id: "u1", status: "active", end_date: daysFromNow(10), monthly_rent_cents: 160000 },
        { id: "l2", unit_id: "u1", status: "active", end_date: daysFromNow(200), monthly_rent_cents: 160000 },
        { id: "l3", unit_id: "u1", status: "ended", end_date: daysFromNow(5), monthly_rent_cents: 160000 },
      ],
      schedules: [],
      leaseMemberships: [],
    }));
    const markup = renderToStaticMarkup(<RentalLeasePanel initialViewFilter="expiring" initialShowCreate={false} />);
    expect(markup).toContain("Leases expiring within 90 days");
    expect(markup).toContain("1 record");
  });

  it("charges with the overdue filter lists only overdue charges, behind a labeled banner", async () => {
    await fetchWithDedupe("rental:payments", () => Promise.resolve({
      openCharges: [
        { id: "c1", lease_id: "l1", charge_type: "rent", period: "2026-08", status: "open", amount_cents: 160000, paid_amount_cents: 0, due_date: daysAgo(10) },
        { id: "c2", lease_id: "l1", charge_type: "rent", period: "2026-10", status: "open", amount_cents: 160000, paid_amount_cents: 0, due_date: daysFromNow(5) },
        { id: "c3", lease_id: "l1", charge_type: "rent", period: "2026-07", status: "open", amount_cents: 160000, paid_amount_cents: 160000, due_date: daysAgo(40) },
      ],
      payments: [],
      settlements: [],
      schedules: [],
      billingEnabled: false,
    }));
    const markup = renderToStaticMarkup(<RentalPaymentsPanel initialViewFilter="overdue" initialAccount={null} />);
    expect(markup).toContain("Overdue rent charges");
    expect(markup).toContain("1 record");
    expect(markup).toContain("2026-08");
    expect(markup).not.toContain("2026-10");
  });

  it("maintenance with the open filter lists only open requests, behind a labeled banner", async () => {
    await fetchWithDedupe("rental:maintenance", () => Promise.resolve({
      maintenanceRequests: [
        { id: "r1", title: "Leaky faucet", status: "open", priority: "normal" },
        { id: "r2", title: "Paint touch-up", status: "completed", priority: "low" },
        { id: "r3", title: "AC not cooling", status: "in_progress", priority: "high" },
      ],
      contractors: [],
      workOrders: [],
      workEvents: [],
    }));
    const markup = renderToStaticMarkup(<RentalMaintenancePanel initialViewFilter="open" />);
    expect(markup).toContain("Open maintenance requests");
    expect(markup).toContain("2 records");
    expect(markup).toContain("Leaky faucet");
    expect(markup).toContain("AC not cooling");
    expect(markup).not.toContain("Paint touch-up");
  });

  it("no banner renders without a view filter", async () => {
    await fetchWithDedupe("rental:maintenance", () => Promise.resolve({
      maintenanceRequests: [], contractors: [], workOrders: [], workEvents: [],
    }));
    const markup = renderToStaticMarkup(<RentalMaintenancePanel />);
    expect(markup).not.toContain("data-view-filter-banner");
  });
});

describe("buildRentalSurface view-filter plumbing", () => {
  beforeEach(() => { clearSWRCache(); });
  afterEach(() => { clearSWRCache(); });

  it("passes the view filter through to the destination panel", async () => {
    await fetchWithDedupe("rental:maintenance", () => Promise.resolve({
      maintenanceRequests: [], contractors: [], workOrders: [], workEvents: [],
    }));
    const markup = renderToStaticMarkup(buildRentalSurface("maintenance", { viewFilter: "open" }));
    expect(markup).toContain("Open maintenance requests");
  });

  it("renders the plain queue when no view filter is passed", async () => {
    await fetchWithDedupe("rental:maintenance", () => Promise.resolve({
      maintenanceRequests: [], contractors: [], workOrders: [], workEvents: [],
    }));
    const markup = renderToStaticMarkup(buildRentalSurface("maintenance", {}));
    expect(markup).not.toContain("data-view-filter-banner");
  });
});

describe("RentalPageClient exception deep-linking", () => {
  let mounted;
  beforeEach(() => { clearSWRCache(); });
  afterEach(() => {
    if (mounted) { unmount(mounted); mounted = null; }
    vi.unstubAllGlobals();
    resetRentalSummaryClient();
    clearSWRCache();
  });

  it("clicking an action-needed exception box lands on the filtered queue, and Show all clears it", async () => {
    const rentalBody = {
      units: [
        { id: "u1", label: "Unit 1", property_id: "p1" },
        { id: "u2", label: "Unit 2", property_id: "p1" },
      ],
      leases: [{ id: "l1", unit_id: "u1", status: "active" }],
      maintenanceRequests: [
        { id: "r1", title: "Leaky faucet", status: "open", priority: "normal", submitted_at: new Date().toISOString() },
      ],
      workOrders: [],
    };
    vi.stubGlobal("fetch", async (url) => {
      if (url === "/api/rental") return { ok: true, json: async () => rentalBody };
      if (url === "/api/rental/reports") {
        return { ok: true, json: async () => ({ report: { summary: { overdueBalanceCents: 0, openBalanceCents: 0 } } }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    await fetchWithDedupe("rental:maintenance", () => Promise.resolve({
      maintenanceRequests: rentalBody.maintenanceRequests, contractors: [], workOrders: [], workEvents: [],
    }));
    mounted = mount(<RentalPageClient />);
    await flushEffects();

    const box = mounted.container.querySelector('[data-exception-box="open-work-orders"]');
    expect(box.tagName).toBe("BUTTON");
    expect(box.textContent).toContain("1");
    act(() => { box.click(); });
    await flushEffects();

    expect(mounted.container.querySelector("[data-active-function-surface]").getAttribute("data-active-function-surface")).toBe("maintenance");
    const banner = mounted.container.querySelector("[data-view-filter-banner]");
    expect(banner).toBeTruthy();
    expect(banner.querySelector("[data-view-filter-label]").textContent).toBe("Open maintenance requests");
    expect(mounted.container.textContent).toContain("Leaky faucet");

    act(() => { banner.querySelector("button").click(); });
    await flushEffects();
    expect(mounted.container.querySelector("[data-view-filter-banner]")).toBeNull();
  });

  it("clicking the vacancy box lands on the properties queue filtered to vacant units", async () => {
    const rentalBody = {
      units: [
        { id: "u1", label: "Occupied House", property_id: "p1" },
        { id: "u2", label: "Vacant House", property_id: "p1" },
      ],
      leases: [{ id: "l1", unit_id: "u1", status: "active" }],
      leaseMemberships: [{ lease_id: "l1", tenant_id: "t1" }],
      tenants: [{ id: "t1", display_name: "Tenant One" }],
      maintenanceRequests: [],
      workOrders: [],
    };
    vi.stubGlobal("fetch", async (url) => {
      if (url === "/api/rental") return { ok: true, json: async () => rentalBody };
      if (url === "/api/rental/reports") {
        return { ok: true, json: async () => ({ report: { summary: { overdueBalanceCents: 0, openBalanceCents: 0 } } }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    await fetchWithDedupe("rental:setup", () => Promise.resolve({
      units: rentalBody.units,
      leases: rentalBody.leases,
      leaseMemberships: rentalBody.leaseMemberships,
      tenants: rentalBody.tenants,
      openCharges: [],
    }));
    mounted = mount(<RentalPageClient />);
    await flushEffects();

    const box = mounted.container.querySelector('[data-exception-box="vacancies"]');
    expect(box.tagName).toBe("BUTTON");
    act(() => { box.click(); });
    await flushEffects();

    expect(mounted.container.querySelector("[data-active-function-surface]").getAttribute("data-active-function-surface")).toBe("setup");
    const banner = mounted.container.querySelector("[data-view-filter-banner]");
    expect(banner.querySelector("[data-view-filter-label]").textContent).toBe("Vacant units only");
    expect(mounted.container.textContent).toContain("Vacant House");
    expect(mounted.container.textContent).not.toContain("Occupied House");
  });
});
