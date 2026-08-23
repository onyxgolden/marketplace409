// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import RentalOverviewPanel from "./RentalOverviewPanel";

const baseData = { units: [{ id: "u1" }], leases: [{ id: "l1", unit_id: "u1", status: "active" }] };

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

describe("RentalOverviewPanel collection-authority labeling (rendered DOM)", () => {
  let mounted;
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } });

  // Rendered-component regression guard for the rental billing cutover containment correction:
  // the dashboard must never render an externally-managed obligation under the FORGE-collectible
  // overdue tile — it must remain visible, but only under its own tile, keyed by a stable data
  // attribute so this stays true no matter how the surrounding markup is redesigned.
  it("never renders the $14,270 externally-managed balance under the FORGE-collectible overdue tile", () => {
    const report = { summary: { overdueBalanceCents: 0, externallyManagedCents: 1427000, externallyManagedChargeCount: 9, monthlyScheduledCents: 200000, collectedCents: 0 } };
    mounted = mount(<RentalOverviewPanel initialData={baseData} initialReport={report} />);
    const overdueTile = mounted.container.querySelector('[data-metric-tile="overdue-forge"]');
    const externalTile = mounted.container.querySelector('[data-metric-tile="externally-managed"]');
    expect(overdueTile).toBeTruthy();
    expect(externalTile).toBeTruthy();
    expect(overdueTile.textContent).toContain("FORGE-collectible overdue");
    expect(overdueTile.textContent).toContain("$0.00");
    expect(overdueTile.textContent).not.toContain("$14,270.00");
    expect(externalTile.textContent).toContain("Externally managed — reconciliation required");
    expect(externalTile.textContent).toContain("$14,270.00");
  });

  it("renders a nonzero FORGE overdue figure once a lease is actually cut over and collectible, and it never leaks onto the externally-managed tile", () => {
    const report = { summary: { overdueBalanceCents: 20000, externallyManagedCents: 0, externallyManagedChargeCount: 0, monthlyScheduledCents: 200000, collectedCents: 0 } };
    mounted = mount(<RentalOverviewPanel initialData={baseData} initialReport={report} />);
    const overdueTile = mounted.container.querySelector('[data-metric-tile="overdue-forge"]');
    const externalTile = mounted.container.querySelector('[data-metric-tile="externally-managed"]');
    expect(overdueTile.textContent).toContain("$200.00");
    expect(externalTile.textContent).toContain("$0.00");
    expect(externalTile.textContent).not.toContain("$200.00");
  });
});

describe("RentalOverviewPanel billing status visibility", () => {
  let mounted;
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } });

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
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } });

  it("uses a real heading hierarchy: one Summary heading and labelled subsections", () => {
    mounted = mount(<RentalOverviewPanel initialData={baseData} initialReport={null} />);
    const h2 = mounted.container.querySelectorAll("h2");
    expect(Array.from(h2).some((el) => el.textContent === "Summary")).toBe(true);
    const h3s = Array.from(mounted.container.querySelectorAll("h3")).map((el) => el.textContent);
    expect(h3s).toContain("Needs attention");
    expect(h3s).toContain("Portfolio performance");
    expect(mounted.container.querySelector("#rental-needs-attention-heading")).toBeTruthy();
    expect(mounted.container.querySelector("[aria-labelledby='rental-needs-attention-heading']")).toBeTruthy();
  });

  it("shows a positive empty state instead of a queue when nothing needs attention", () => {
    const readyData = {
      ...baseData,
      insurancePolicies: [{ lease_id: "l1", status: "verified" }],
      deposits: [{ lease_id: "l1" }],
      inspections: [{ lease_id: "l1", inspection_type: "move_in", status: "finalized" }],
    };
    mounted = mount(<RentalOverviewPanel initialData={readyData} initialReport={{ summary: { overdueBalanceCents: 0, externallyManagedCents: 0, externallyManagedChargeCount: 0, monthlyScheduledCents: 0, collectedCents: 0 } }} />);
    expect(mounted.container.textContent).toContain("Nothing needs your attention right now.");
  });

  it("shows an onboarding empty state, not a wall of zero KPIs, when the portfolio has no units yet", () => {
    let navigated = null;
    mounted = mount(<RentalOverviewPanel initialData={{ units: [], leases: [] }} initialReport={null} onNavigate={(id) => { navigated = id; }} />);
    expect(mounted.container.querySelector("[data-rental-overview-empty]")).toBeTruthy();
    expect(mounted.container.textContent).toContain("Add your first property to get started");
    expect(mounted.container.querySelector('[data-metric-tile]')).toBeNull();
    act(() => { Array.from(mounted.container.querySelectorAll("button")).find((b) => b.textContent === "Add a property").click(); });
    expect(navigated).toBe("setup");
  });

  it("every KPI tile either navigates somewhere or is explicitly labelled Informational — never a dead decorative card", () => {
    mounted = mount(<RentalOverviewPanel initialData={baseData} initialReport={null} onNavigate={() => {}} />);
    const tiles = mounted.container.querySelectorAll("[data-metric-tile]");
    expect(tiles.length).toBeGreaterThan(0);
    tiles.forEach((tile) => {
      const isButton = tile.tagName === "BUTTON";
      const isInformational = tile.textContent.includes("Informational");
      expect(isButton || isInformational).toBe(true);
    });
  });
});

describe("RentalOverviewPanel (static markup smoke test)", () => {
  it("renders the loading state before data arrives", () => {
    const markup = renderToStaticMarkup(<RentalOverviewPanel />);
    expect(markup).toContain("Loading rental summary");
  });
});
