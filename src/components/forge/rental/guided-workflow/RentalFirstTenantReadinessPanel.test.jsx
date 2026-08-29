// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalFirstTenantReadinessPanel from "./RentalFirstTenantReadinessPanel";

function rentalBody(overrides = {}) {
  return {
    actingUserId: "user_1",
    canonicalOwnerId: "owner_1",
    units: [{ id: "unit_1", label: "Unit 1", status: "available" }],
    leases: [],
    leaseMemberships: [],
    schedules: [],
    deposits: [],
    insuranceRequirements: [],
    insurancePolicies: [],
    inspections: [],
    ...overrides,
  };
}

// A fully-ready lease_1/unit_1 pairing, reused by tests that need to walk all the way to the end.
function readyOverrides() {
  return {
    units: [{ id: "unit_1", label: "Unit 1", status: "available" }],
    leases: [{ id: "lease_1", unit_id: "unit_1", status: "active", created_at: "2026-08-01T00:00:00.000Z" }],
    leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_1" }],
    schedules: [{ id: "schedule_1", lease_id: "lease_1", status: "active" }],
    deposits: [{ id: "deposit_1", lease_id: "lease_1", status: "held" }],
    insuranceRequirements: [],
    insurancePolicies: [{ id: "policy_1", lease_id: "lease_1", status: "verified", expiration_date: "2027-01-01" }],
    inspections: [{ id: "inspection_1", lease_id: "lease_1", inspection_type: "move_in", status: "finalized" }],
  };
}

function stubFetch(sequence) {
  let call = 0;
  const fetch = vi.fn(async () => {
    const step = sequence[Math.min(call, sequence.length - 1)];
    call += 1;
    return { ok: true, json: async () => step };
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
async function clickAndFlush(button) {
  await act(async () => {
    button.click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
}

describe("RentalFirstTenantReadinessPanel", () => {
  let mounted;
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } vi.unstubAllGlobals(); });

  it("shows a unit picker listing every vacant unit", async () => {
    const fetch = stubFetch([rentalBody({ units: [{ id: "unit_1", label: "Unit 1", status: "available" }, { id: "unit_2", label: "Unit 2", status: "preparing" }] })]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalFirstTenantReadinessPanel />);
    await flush();
    expect(mounted.container.querySelector("[data-guided-workflow-unit-picker]")).toBeTruthy();
    expect(mounted.container.textContent).toContain("Unit 1");
    expect(mounted.container.textContent).toContain("Unit 2");
  });

  it("excludes units with an active lease from the picker", async () => {
    const fetch = stubFetch([rentalBody({
      units: [{ id: "unit_1", label: "Occupied unit", status: "occupied" }, { id: "unit_2", label: "Vacant unit", status: "available" }],
      leases: [{ id: "lease_1", unit_id: "unit_1", status: "active" }],
    })]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalFirstTenantReadinessPanel />);
    await flush();
    expect(mounted.container.textContent).not.toContain("Occupied unit");
    expect(mounted.container.textContent).toContain("Vacant unit");
  });

  it("shows a calm message when there are no vacant units", async () => {
    const fetch = stubFetch([rentalBody({ units: [] })]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalFirstTenantReadinessPanel />);
    await flush();
    expect(mounted.container.textContent).toContain("No vacant units right now");
  });

  it("selecting a unit starts the guided walk at the first real blocker, never inventing one", async () => {
    const fetch = stubFetch([rentalBody()]); // unit_1, available, no lease at all
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalFirstTenantReadinessPanel />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-unit-id="unit_1"]'));
    expect(mounted.container.querySelector('[data-guided-workflow-step="tenant-assignment"]')).toBeTruthy();
    expect(mounted.container.textContent).toContain("No tenant assigned yet");
  });

  it("clearly explains a blocked step (unit marked inactive) rather than silently skipping it", async () => {
    const fetch = stubFetch([rentalBody({ units: [{ id: "unit_1", label: "Unit 1", status: "inactive" }] })]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalFirstTenantReadinessPanel />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-unit-id="unit_1"]'));
    expect(mounted.container.querySelector('[data-guided-workflow-step="unit-readiness"]')).toBeTruthy();
    expect(mounted.container.textContent).toContain("Unit marked inactive");
  });

  // A unit with an already-active lease is, by the shared vacancy predicate, no longer "vacant" -- so a
  // fully-ready unit can never be the one initially offered by the picker. These tests start from a
  // genuinely vacant unit (no lease at all), select it, then let a Next-triggered refetch reveal that
  // the unit has since become fully ready -- exactly how a real walkthrough would unfold as the
  // landlord does the underlying work (activating a lease, etc.) between guidance steps.
  it("walks a unit to the final review once fresh data shows every requirement met, then completes", async () => {
    const fetch = stubFetch([rentalBody(), rentalBody(readyOverrides())]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalFirstTenantReadinessPanel />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-unit-id="unit_1"]'));
    expect(mounted.container.querySelector('[data-guided-workflow-step="tenant-assignment"]')).toBeTruthy();
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="next"]'));
    expect(mounted.container.querySelector('[data-guided-workflow-step="ready-for-move-in"]')).toBeTruthy();
    expect(mounted.container.textContent).toContain("This unit is ready for move-in.");
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="next"]'));
    expect(mounted.container.textContent).toContain("This unit is ready for move-in.");
    expect(mounted.container.querySelector('[data-guided-workflow-step]')).toBeFalsy();
  });

  it("never claims ready-for-move-in while a real requirement is still outstanding", async () => {
    const overrides = readyOverrides();
    overrides.deposits = []; // one real gap among an otherwise-ready unit
    const fetch = stubFetch([rentalBody(), rentalBody(overrides)]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalFirstTenantReadinessPanel />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-unit-id="unit_1"]'));
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="next"]'));
    expect(mounted.container.textContent).not.toContain("ready for move-in");
    expect(mounted.container.querySelector('[data-guided-workflow-step="security-deposit"]')).toBeTruthy();
  });

  it("re-evaluates against fresh data on Next rather than trusting the earlier fetch", async () => {
    const first = rentalBody({ units: [{ id: "unit_1", label: "Unit 1", status: "preparing" }] });
    const second = rentalBody(readyOverrides());
    const fetch = stubFetch([first, second]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalFirstTenantReadinessPanel />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-unit-id="unit_1"]'));
    expect(mounted.container.querySelector('[data-guided-workflow-step="unit-readiness"]')).toBeTruthy();
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="next"]'));
    expect(mounted.container.querySelector('[data-guided-workflow-step="ready-for-move-in"]')).toBeTruthy();
  });

  it("Change unit returns to the picker without losing the vacant-units list", async () => {
    const fetch = stubFetch([rentalBody()]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalFirstTenantReadinessPanel />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-unit-id="unit_1"]'));
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="change-unit"]'));
    expect(mounted.container.querySelector("[data-guided-workflow-unit-picker]")).toBeTruthy();
  });

  it("pauses and resumes", async () => {
    const fetch = stubFetch([rentalBody()]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalFirstTenantReadinessPanel />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-unit-id="unit_1"]'));
    act(() => { mounted.container.querySelector('[data-guided-workflow-control="pause"]').click(); });
    expect(mounted.container.querySelector("[data-guided-workflow-paused]")).toBeTruthy();
    act(() => { mounted.container.querySelector('[data-guided-workflow-control="resume"]').click(); });
    expect(mounted.container.querySelector('[data-guided-workflow-step="tenant-assignment"]')).toBeTruthy();
  });

  it("exits guidance", async () => {
    const fetch = stubFetch([rentalBody()]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalFirstTenantReadinessPanel />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-unit-id="unit_1"]'));
    act(() => { mounted.container.querySelector('[data-guided-workflow-control="exit"]').click(); });
    expect(mounted.container.textContent).toContain("Guidance exited.");
  });

  it("calls onNavigate with the destination surface id when Open is clicked", async () => {
    const fetch = stubFetch([rentalBody()]);
    vi.stubGlobal("fetch", fetch);
    const onNavigate = vi.fn();
    mounted = mount(<RentalFirstTenantReadinessPanel onNavigate={onNavigate} />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-unit-id="unit_1"]'));
    act(() => { [...mounted.container.querySelectorAll("button")].find((b) => b.textContent.includes("Open")).click(); });
    expect(onNavigate).toHaveBeenCalledWith("leases");
  });

  it("never issues a mutating request -- only GET-shaped fetch calls happen from guidance", async () => {
    const fetch = stubFetch([rentalBody({ units: [{ id: "unit_1", label: "Unit 1", status: "preparing" }] })]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalFirstTenantReadinessPanel />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-unit-id="unit_1"]'));
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="next"]'));
    for (const call of fetch.mock.calls) {
      const init = call[1];
      expect(!init || !init.method || init.method === "GET").toBe(true);
    }
  });

  it("shows an error and never starts a session when identity is missing from the response", async () => {
    const fetch = stubFetch([rentalBody({ actingUserId: null, canonicalOwnerId: null })]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalFirstTenantReadinessPanel />);
    await flush();
    expect(mounted.container.querySelector('[data-guided-workflow-unit-picker]')).toBeFalsy();
  });
});
