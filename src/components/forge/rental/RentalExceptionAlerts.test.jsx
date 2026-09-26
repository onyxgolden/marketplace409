// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RentalExceptionAlerts,
  RentalQuickAccess,
  buildExceptionAlerts,
  buildQuickAccessLinks,
} from "./RentalExceptionAlerts";

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

function richSummary() {
  return {
    vacancies: 2,
    expiringLeases: 3,
    expiringLeasesWithin30Days: 1,
    overdueBalanceCents: 240000,
    openBalanceCents: 240000,
    openMaintenance: 4,
    occupiedUnits: 5,
    totalUnits: 7,
  };
}
function emptySummary() {
  return {
    vacancies: 0,
    expiringLeases: 0,
    expiringLeasesWithin30Days: 0,
    overdueBalanceCents: 0,
    openMaintenance: 0,
    occupiedUnits: 0,
    totalUnits: 0,
  };
}
function box(container, id) {
  return container.querySelector(`[data-exception-box="${id}"]`);
}

describe("buildExceptionAlerts", () => {
  it("describes the four exception boxes with correct counts, destinations, and filters", () => {
    const alerts = buildExceptionAlerts(richSummary());
    expect(alerts.map((alert) => alert.id)).toEqual(["vacancies", "expiring-leases", "rent-overdue", "open-work-orders"]);
    expect(alerts.map((alert) => [alert.destination, alert.viewFilter])).toEqual([
      ["setup", "vacant"],
      ["leases", "expiring"],
      ["charges", "overdue"],
      ["maintenance", "open"],
    ]);
    expect(alerts.map((alert) => alert.displayValue)).toEqual(["2", "3", "$2,400.00", "4"]);
    expect(alerts.every((alert) => alert.hasAction)).toBe(true);
  });

  it("marks every box as no-action when all counts are zero", () => {
    const alerts = buildExceptionAlerts(emptySummary());
    expect(alerts.every((alert) => !alert.hasAction)).toBe(true);
  });

  it("marks boxes independently -- one exception does not light up the others", () => {
    const alerts = buildExceptionAlerts({ ...emptySummary(), openMaintenance: 1 });
    const byId = Object.fromEntries(alerts.map((alert) => [alert.id, alert]));
    expect(byId["open-work-orders"].hasAction).toBe(true);
    expect(byId["vacancies"].hasAction).toBe(false);
    expect(byId["expiring-leases"].hasAction).toBe(false);
    expect(byId["rent-overdue"].hasAction).toBe(false);
  });
});

describe("RentalExceptionAlerts rendering", () => {
  let mounted;
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } });

  it("renders all four boxes with their real counts", () => {
    mounted = mount(<RentalExceptionAlerts summary={richSummary()} onNavigate={() => {}} />);
    expect(box(mounted.container, "vacancies").textContent).toContain("2");
    expect(box(mounted.container, "expiring-leases").textContent).toContain("3");
    expect(box(mounted.container, "rent-overdue").textContent).toContain("$2,400.00");
    expect(box(mounted.container, "open-work-orders").textContent).toContain("4");
  });

  it("renders zero-count boxes as quiet all-clear states -- not buttons, not links", () => {
    mounted = mount(<RentalExceptionAlerts summary={emptySummary()} onNavigate={() => {}} />);
    for (const id of ["vacancies", "expiring-leases", "rent-overdue", "open-work-orders"]) {
      const element = box(mounted.container, id);
      expect(element.getAttribute("data-exception-state")).toBe("all-clear");
      expect(element.tagName).not.toBe("BUTTON");
      expect(element.tagName).not.toBe("A");
      expect(element.textContent).toContain("All clear");
    }
  });

  it("clicking an action-needed box deep-links to the filtered queue for that exception", () => {
    const calls = [];
    mounted = mount(<RentalExceptionAlerts summary={richSummary()} onNavigate={(...args) => calls.push(args)} />);
    act(() => { box(mounted.container, "vacancies").click(); });
    act(() => { box(mounted.container, "expiring-leases").click(); });
    act(() => { box(mounted.container, "rent-overdue").click(); });
    act(() => { box(mounted.container, "open-work-orders").click(); });
    expect(calls).toEqual([
      ["setup", null, "vacant"],
      ["leases", null, "expiring"],
      ["charges", null, "overdue"],
      ["maintenance", null, "open"],
    ]);
  });

  it("an all-clear box is not clickable -- clicking it navigates nowhere", () => {
    const onNavigate = vi.fn();
    mounted = mount(<RentalExceptionAlerts summary={{ ...richSummary(), vacancies: 0 }} onNavigate={onNavigate} />);
    const element = box(mounted.container, "vacancies");
    expect(element.getAttribute("data-exception-state")).toBe("all-clear");
    act(() => { element.click(); });
    expect(onNavigate).not.toHaveBeenCalled();
    // The other boxes still link out.
    act(() => { box(mounted.container, "open-work-orders").click(); });
    expect(onNavigate).toHaveBeenCalledWith("maintenance", null, "open");
  });
});

describe("buildQuickAccessLinks", () => {
  it("shows all three links when everything is actionable", () => {
    expect(buildQuickAccessLinks(richSummary()).map((link) => link.id))
      .toEqual(["record-payment", "add-property", "open-work-orders"]);
  });

  it("hides record-payment when no balance is owed, even with tenants on file", () => {
    const ids = buildQuickAccessLinks({ ...richSummary(), openBalanceCents: 0 }).map((link) => link.id);
    expect(ids).not.toContain("record-payment");
  });

  it("hides add-property before the portfolio exists", () => {
    const ids = buildQuickAccessLinks({ ...emptySummary() }).map((link) => link.id);
    expect(ids).not.toContain("add-property");
  });

  it("hides open-work-orders when no work order is open", () => {
    const ids = buildQuickAccessLinks({ ...richSummary(), openMaintenance: 0 }).map((link) => link.id);
    expect(ids).not.toContain("open-work-orders");
  });
});

describe("RentalQuickAccess rendering", () => {
  let mounted;
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } });

  function quickLink(container, id) {
    return container.querySelector(`[data-quick-access="${id}"]`);
  }

  it("renders nothing at all when no link is actionable", () => {
    mounted = mount(<RentalQuickAccess summary={emptySummary()} onNavigate={() => {}} />);
    expect(mounted.container.querySelector('[aria-label="Quick access"]')).toBeNull();
  });

  it("renders only the actionable links and navigates each to its destination", () => {
    const calls = [];
    mounted = mount(<RentalQuickAccess summary={{ ...richSummary(), openMaintenance: 0 }} onNavigate={(...args) => calls.push(args)} />);
    expect(quickLink(mounted.container, "record-payment")).toBeTruthy();
    expect(quickLink(mounted.container, "add-property")).toBeTruthy();
    expect(quickLink(mounted.container, "open-work-orders")).toBeNull();
    act(() => { quickLink(mounted.container, "record-payment").click(); });
    act(() => { quickLink(mounted.container, "add-property").click(); });
    expect(calls).toEqual([["charges", null, null], ["setup", null, null]]);
  });

  it("the open-work-orders quick link deep-links to the filtered maintenance queue", () => {
    const calls = [];
    mounted = mount(<RentalQuickAccess summary={richSummary()} onNavigate={(...args) => calls.push(args)} />);
    act(() => { quickLink(mounted.container, "open-work-orders").click(); });
    expect(calls).toEqual([["maintenance", null, "open"]]);
  });
});
