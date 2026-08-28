// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalTodaysPrioritiesPanel from "./RentalTodaysPrioritiesPanel";

function rentalBody(overrides = {}) {
  return {
    actingUserId: "user_1",
    canonicalOwnerId: "owner_1",
    units: [{ id: "unit_1", label: "Unit 1" }],
    leases: [{ id: "lease_1", unit_id: "unit_1", status: "active" }],
    payments: [],
    maintenanceRequests: [],
    workOrders: [],
    insurancePolicies: [{ id: "policy_1", lease_id: "lease_1", status: "verified" }],
    deposits: [{ id: "deposit_1", lease_id: "lease_1" }],
    inspections: [{ id: "inspection_1", lease_id: "lease_1", inspection_type: "move_in", status: "final" }],
    supportCases: [],
    schedules: [],
    financialEvents: [],
    billingEnabled: true,
    ...overrides,
  };
}

function reportBody(overrides = {}) {
  return { report: { summary: { overdueBalanceCents: 0, externallyManagedCents: 0, externallyManagedChargeCount: 0, monthlyScheduledCents: 0, collectedCents: 0, ...overrides } } };
}

function stubFetch(sequence) {
  let call = 0;
  const fetch = vi.fn(async (url) => {
    const step = sequence[Math.min(call, sequence.length - 1)];
    if (String(url).includes("/api/rental/reports")) { call += 1; return { ok: true, json: async () => step.report }; }
    return { ok: true, json: async () => step.rental };
  });
  return fetch;
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
async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

describe("RentalTodaysPrioritiesPanel", () => {
  let mounted;
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } vi.unstubAllGlobals(); });

  it("shows the highest-priority real attention item first, with a live priority count", async () => {
    const fetch = stubFetch([{
      rental: rentalBody({ units: [{ id: "u1" }, { id: "u2" }] }), // one vacant unit -> "vacancies"
      report: reportBody(),
    }]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalTodaysPrioritiesPanel />);
    await flush();
    expect(mounted.container.textContent).toContain("Today's priorities");
    expect(mounted.container.querySelector('[data-guided-workflow-step="vacancies"]')).toBeTruthy();
    expect(mounted.container.textContent).toContain("Priority 1 of 1");
  });

  it("shows 'Nothing urgent' when the live needs-attention queue is empty", async () => {
    const fetch = stubFetch([{ rental: rentalBody(), report: reportBody() }]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalTodaysPrioritiesPanel />);
    await flush();
    expect(mounted.container.textContent).toContain("Nothing urgent right now.");
  });

  it("reveals the explanation only after 'Why does this matter?' is clicked", async () => {
    const fetch = stubFetch([{ rental: rentalBody({ units: [{ id: "u1" }, { id: "u2" }] }), report: reportBody() }]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalTodaysPrioritiesPanel />);
    await flush();
    expect(mounted.container.textContent).not.toContain("An empty unit isn't generating rent");
    act(() => { mounted.container.querySelector('[data-guided-workflow-control="why"]').click(); });
    expect(mounted.container.textContent).toContain("An empty unit isn't generating rent");
  });

  it("re-evaluates against fresh data on Next, rather than trusting the earlier fetch", async () => {
    const fetch = stubFetch([
      { rental: rentalBody({ units: [{ id: "u1" }, { id: "u2" }] }), report: reportBody() }, // initial: vacancy
      { rental: rentalBody({ units: [{ id: "u1" }] }), report: reportBody() }, // after Next: resolved
    ]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalTodaysPrioritiesPanel />);
    await flush();
    expect(mounted.container.querySelector('[data-guided-workflow-step="vacancies"]')).toBeTruthy();
    await act(async () => {
      mounted.container.querySelector('[data-guided-workflow-control="next"]').click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(mounted.container.textContent).toContain("Nothing urgent right now.");
  });

  it("pauses and resumes", async () => {
    const fetch = stubFetch([{ rental: rentalBody({ units: [{ id: "u1" }, { id: "u2" }] }), report: reportBody() }]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalTodaysPrioritiesPanel />);
    await flush();
    act(() => { mounted.container.querySelector('[data-guided-workflow-control="pause"]').click(); });
    expect(mounted.container.querySelector("[data-guided-workflow-paused]")).toBeTruthy();
    act(() => { mounted.container.querySelector('[data-guided-workflow-control="resume"]').click(); });
    expect(mounted.container.querySelector('[data-guided-workflow-step="vacancies"]')).toBeTruthy();
  });

  it("exits guidance", async () => {
    const fetch = stubFetch([{ rental: rentalBody({ units: [{ id: "u1" }, { id: "u2" }] }), report: reportBody() }]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalTodaysPrioritiesPanel />);
    await flush();
    act(() => { mounted.container.querySelector('[data-guided-workflow-control="exit"]').click(); });
    expect(mounted.container.textContent).toContain("Guidance exited.");
  });

  it("shows an error and never starts a session when identity is missing from the response", async () => {
    const fetch = stubFetch([{ rental: rentalBody({ actingUserId: null, canonicalOwnerId: null }), report: reportBody() }]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalTodaysPrioritiesPanel />);
    await flush();
    expect(mounted.container.querySelector('[role="alert"]')).toBeTruthy();
    expect(mounted.container.querySelector("[data-guided-workflow-panel]")).toBeFalsy();
  });

  it("calls onNavigate with the live item's destination when Open is clicked", async () => {
    const fetch = stubFetch([{ rental: rentalBody({ units: [{ id: "u1" }, { id: "u2" }] }), report: reportBody() }]);
    vi.stubGlobal("fetch", fetch);
    const onNavigate = vi.fn();
    mounted = mount(<RentalTodaysPrioritiesPanel onNavigate={onNavigate} />);
    await flush();
    act(() => { [...mounted.container.querySelectorAll("button")].find((b) => b.textContent.includes("Open")).click(); });
    expect(onNavigate).toHaveBeenCalledWith("setup");
  });
});
