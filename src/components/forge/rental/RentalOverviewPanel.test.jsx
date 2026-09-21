// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalOverviewPanel from "./RentalOverviewPanel";
import { resetRentalSummaryClient } from "./rentalSummaryClient";

const baseData = { units: [{ id: "u1" }], leases: [{ id: "l1", unit_id: "u1", status: "active" }] };

// RentalOverviewPanel computes "today" internally from the real clock (it takes no date prop), so
// component-level date fixtures must be relative to now, not a hardcoded calendar date.
function daysFromNow(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
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
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

function card(container, label) {
  return container.querySelector(`[data-dashboard-card="${label}"]`);
}

describe("RentalOverviewPanel five-card dashboard", () => {
  let mounted;
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } vi.unstubAllGlobals(); resetRentalSummaryClient(); });

  function richFixture() {
    return {
      units: [{ id: "u1" }, { id: "u2" }],
      leases: [
        { id: "l1", unit_id: "u1", status: "active", end_date: daysFromNow(20) },
        { id: "l2", unit_id: "u2", status: "active", end_date: daysFromNow(200) },
      ],
      payments: [
        { status: "succeeded", succeeded_at: new Date().toISOString(), amount_cents: 150000, refunded_amount_cents: 0 },
        { status: "succeeded", succeeded_at: new Date().toISOString(), amount_cents: 50000, refunded_amount_cents: 10000 },
      ],
      maintenanceRequests: [{ status: "open" }, { status: "completed" }],
      workOrders: [{ status: "assigned" }],
    };
  }
  const report = { summary: { openBalanceCents: 87550, overdueBalanceCents: 12000 } };

  it("renders exactly five glanceable cards, each derived from real API data", () => {
    mounted = mount(<RentalOverviewPanel initialData={richFixture()} initialReport={report} onNavigate={() => {}} />);
    const cards = mounted.container.querySelectorAll("[data-dashboard-card]");
    expect(Array.from(cards).map((el) => el.getAttribute("data-dashboard-card"))).toEqual([
      "Rent collected", "Outstanding balances", "Occupancy", "Open maintenance", "Expiring leases",
    ]);
  });

  it("labels Rent collected with an explicit reporting period and sums only qualifying payments, net of refunds", () => {
    mounted = mount(<RentalOverviewPanel initialData={richFixture()} initialReport={report} onNavigate={() => {}} />);
    const tile = card(mounted.container, "Rent collected");
    const periodLabel = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });
    expect(tile.textContent).toContain("$1,900.00");
    expect(tile.textContent).toContain(periodLabel);
    expect(tile.textContent).toContain("succeeded payments, net of refunds");
  });

  it("derives Outstanding balances from the authoritative open-charge balance, calling out the overdue portion", () => {
    mounted = mount(<RentalOverviewPanel initialData={richFixture()} initialReport={report} onNavigate={() => {}} />);
    const tile = card(mounted.container, "Outstanding balances");
    expect(tile.textContent).toContain("$875.50");
    expect(tile.textContent).toContain("$120.00 overdue");
    expect(tile.textContent).toContain("Open rent-charge balances");
  });

  it("shows an honest nothing-overdue state instead of hiding the card", () => {
    mounted = mount(<RentalOverviewPanel initialData={richFixture()} initialReport={{ summary: { openBalanceCents: 0, overdueBalanceCents: 0 } }} onNavigate={() => {}} />);
    const tile = card(mounted.container, "Outstanding balances");
    expect(tile.textContent).toContain("$0.00");
    expect(tile.textContent).toContain("nothing overdue");
  });

  it("derives Occupancy from actual leased units over total units", () => {
    mounted = mount(<RentalOverviewPanel initialData={richFixture()} initialReport={report} onNavigate={() => {}} />);
    const tile = card(mounted.container, "Occupancy");
    expect(tile.textContent).toContain("100%");
    expect(tile.textContent).toContain("2 of 2 units leased");
  });

  it("counts Open maintenance by explicit open statuses only", () => {
    mounted = mount(<RentalOverviewPanel initialData={richFixture()} initialReport={report} onNavigate={() => {}} />);
    const tile = card(mounted.container, "Open maintenance");
    expect(tile.textContent).toContain("2");
    expect(tile.textContent).toContain("Open, pending, submitted, assigned, or in progress");
  });

  it("shows the true 30-day-of-90-day relationship on the Expiring leases card", () => {
    mounted = mount(<RentalOverviewPanel initialData={richFixture()} initialReport={report} onNavigate={() => {}} />);
    const tile = card(mounted.container, "Expiring leases");
    expect(tile.textContent).toContain("1");
    expect(tile.textContent).toContain("1 due within 30 days");
    expect(tile.textContent).toContain("90-day window");
  });

  it("navigates each card to its supporting function, never a dead decorative card", () => {
    const visited = [];
    mounted = mount(<RentalOverviewPanel initialData={richFixture()} initialReport={report} onNavigate={(id) => visited.push(id)} />);
    for (const [label, destination] of [["Rent collected", "charges"], ["Outstanding balances", "charges"], ["Occupancy", "setup"], ["Open maintenance", "maintenance"], ["Expiring leases", "lease-lifecycle"]]) {
      act(() => { card(mounted.container, label).click(); });
      expect(visited.at(-1)).toBe(destination);
    }
    expect(visited).toEqual(["charges", "charges", "setup", "maintenance", "lease-lifecycle"]);
  });

  it("shows honest zero cards, not an error, when the portfolio has data but nothing outstanding", () => {
    const readyData = {
      ...baseData,
      insurancePolicies: [{ lease_id: "l1", status: "verified" }],
      deposits: [{ lease_id: "l1" }],
      inspections: [{ lease_id: "l1", inspection_type: "move_in", status: "finalized" }],
    };
    mounted = mount(<RentalOverviewPanel initialData={readyData} initialReport={{ summary: { openBalanceCents: 0, overdueBalanceCents: 0 } }} onNavigate={() => {}} />);
    expect(card(mounted.container, "Outstanding balances").textContent).toContain("$0.00");
    expect(card(mounted.container, "Open maintenance").textContent).toContain("No open requests");
    expect(card(mounted.container, "Expiring leases").textContent).toContain("Nothing expiring");
  });
});

describe("RentalOverviewPanel billing status visibility", () => {
  let mounted;
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } vi.unstubAllGlobals(); resetRentalSummaryClient(); });

  it("visibly shows billing as PAUSED when billingEnabled is absent, with no pause/resume control rendered", () => {
    mounted = mount(<RentalOverviewPanel initialData={baseData} initialReport={null} />);
    const chip = mounted.container.querySelector('[data-billing-status]');
    expect(chip.getAttribute("data-billing-status")).toBe("paused");
    expect(chip.textContent).toContain("Paused");
    expect(mounted.container.textContent).not.toContain("Resume FORGE billing");
    expect(mounted.container.textContent).not.toContain("Pause FORGE billing");
    expect(mounted.container.textContent).not.toContain("Pay now");
  });

  it("visibly shows billing as ACTIVE only when billingEnabled is explicitly true, still with no collection-authority control", () => {
    mounted = mount(<RentalOverviewPanel initialData={{ ...baseData, billingEnabled: true }} initialReport={null} />);
    const chip = mounted.container.querySelector('[data-billing-status]');
    expect(chip.getAttribute("data-billing-status")).toBe("active");
    expect(chip.textContent).toContain("Active");
    expect(mounted.container.textContent).not.toContain("Resume FORGE billing");
    expect(mounted.container.textContent).not.toContain("Confirm resume");
  });

  it("navigates a click on the billing status chip to Rent & Payments instead of acting on billing itself", () => {
    let navigated = null;
    mounted = mount(<RentalOverviewPanel initialData={baseData} initialReport={null} onNavigate={(id) => { navigated = id; }} />);
    act(() => { mounted.container.querySelector('[data-billing-status]').click(); });
    expect(navigated).toBe("charges");
  });
});

describe("RentalOverviewPanel structure and empty state", () => {
  let mounted;
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } vi.unstubAllGlobals(); resetRentalSummaryClient(); });

  it("uses a real heading hierarchy: one Dashboard heading", () => {
    mounted = mount(<RentalOverviewPanel initialData={baseData} initialReport={null} />);
    const h2 = mounted.container.querySelectorAll("h2");
    expect(Array.from(h2).some((el) => el.textContent === "Dashboard")).toBe(true);
  });

  it("embeds Today's Priorities instead of duplicating its logic", async () => {
    const rentalBody = { ...baseData, actingUserId: "user_1", canonicalOwnerId: "owner_1" };
    vi.stubGlobal("fetch", async (url) => {
      if (url === "/api/rental") return { ok: true, json: async () => rentalBody };
      if (url === "/api/rental/reports") return { ok: true, json: async () => ({ report: null }) };
      throw new Error(`unexpected fetch ${url}`);
    });
    mounted = mount(<RentalOverviewPanel initialData={baseData} initialReport={null} onNavigate={() => {}} />);
    await flushEffects();
    expect(mounted.container.textContent).toContain("Today's priorities");
  });

  it("shows an onboarding empty state, not a wall of zero cards, when the portfolio has no units yet", () => {
    let navigated = null;
    mounted = mount(<RentalOverviewPanel initialData={{ units: [], leases: [] }} initialReport={null} onNavigate={(id) => { navigated = id; }} />);
    expect(mounted.container.querySelector("[data-rental-overview-empty]")).toBeTruthy();
    expect(mounted.container.textContent).toContain("Add your first property to get started");
    expect(mounted.container.querySelector('[data-dashboard-card]')).toBeNull();
    act(() => { Array.from(mounted.container.querySelectorAll("button")).find((b) => b.textContent === "Add a property").click(); });
    expect(navigated).toBe("setup");
  });

  it("every dashboard card is a button that navigates somewhere — never a dead decorative card", () => {
    mounted = mount(<RentalOverviewPanel initialData={baseData} initialReport={null} onNavigate={() => {}} />);
    const tiles = mounted.container.querySelectorAll("[data-dashboard-card]");
    expect(tiles.length).toBe(5);
    tiles.forEach((tile) => expect(tile.tagName).toBe("BUTTON"));
  });
});

describe("RentalOverviewPanel (static markup smoke test)", () => {
  it("renders the loading state before data arrives", () => {
    const markup = renderToStaticMarkup(<RentalOverviewPanel />);
    expect(markup).toContain("Loading rental summary");
  });
});
