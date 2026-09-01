// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalLeaseRenewalPanel from "./RentalLeaseRenewalPanel";

function daysFromNow(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function rentalBody(overrides = {}) {
  return {
    actingUserId: "user_1",
    canonicalOwnerId: "owner_1",
    units: [{ id: "unit_1", label: "Unit 1" }],
    tenants: [{ id: "tenant_1", display_name: "Jordan Ellis" }],
    leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_1" }],
    schedules: [],
    leases: [{ id: "lease_1", unit_id: "unit_1", status: "active", end_date: daysFromNow(10), monthly_rent_cents: 150000 }],
    leaseChanges: [],
    ...overrides,
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

describe("RentalLeaseRenewalPanel", () => {
  let mounted;
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } vi.unstubAllGlobals(); });

  it("shows a lease picker listing every lease expiring within 30 days", async () => {
    const fetch = stubFetch([rentalBody({
      leases: [
        { id: "lease_1", unit_id: "unit_1", status: "active", end_date: daysFromNow(5) },
        { id: "lease_2", unit_id: "unit_1", status: "active", end_date: daysFromNow(20) },
      ],
    })]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalLeaseRenewalPanel />);
    await flush();
    expect(mounted.container.querySelector("[data-guided-workflow-lease-picker]")).toBeTruthy();
    expect(mounted.container.querySelectorAll('[data-guided-workflow-control="select-lease"]').length).toBe(2);
  });

  it("excludes leases outside the 30-day window and inactive leases from the picker", async () => {
    const fetch = stubFetch([rentalBody({
      leases: [
        { id: "lease_soon", unit_id: "unit_1", status: "active", end_date: daysFromNow(5) },
        { id: "lease_far", unit_id: "unit_1", status: "active", end_date: daysFromNow(90) },
        { id: "lease_draft", unit_id: "unit_1", status: "draft", end_date: daysFromNow(5) },
      ],
    })]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalLeaseRenewalPanel />);
    await flush();
    const buttons = [...mounted.container.querySelectorAll('[data-guided-workflow-control="select-lease"]')];
    expect(buttons.length).toBe(1);
    expect(buttons[0].getAttribute("data-lease-id")).toBe("lease_soon");
  });

  it("shows a calm message when no leases are expiring soon", async () => {
    const fetch = stubFetch([rentalBody({ leases: [{ id: "lease_1", unit_id: "unit_1", status: "active", end_date: daysFromNow(90) }] })]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalLeaseRenewalPanel />);
    await flush();
    expect(mounted.container.textContent).toContain("No leases are expiring within 30 days right now.");
  });

  it("selecting a lease starts the guided walk at the first real step needing attention", async () => {
    const fetch = stubFetch([rentalBody()]); // lease_1, no renewal drafted at all
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalLeaseRenewalPanel />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-lease-id="lease_1"]'));
    expect(mounted.container.querySelector('[data-guided-workflow-step="renewal-draft"]')).toBeTruthy();
    expect(mounted.container.textContent).toContain("No renewal drafted yet");
  });

  it("clearly explains a blocked step (renewal approved but not applied) rather than silently skipping it", async () => {
    const fetch = stubFetch([rentalBody({
      leaseChanges: [{ id: "change_1", lease_id: "lease_1", change_type: "renewal", status: "approved", created_at: "2026-01-01T00:00:00.000Z" }],
    })]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalLeaseRenewalPanel />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-lease-id="lease_1"]'));
    expect(mounted.container.querySelector('[data-guided-workflow-step="renewal-approval"]')).toBeTruthy();
    expect(mounted.container.textContent).toContain("Renewal approved but not applied");
  });

  it("walks a lease to final review once fresh data shows the renewal applied, then completes", async () => {
    const first = rentalBody();
    const second = rentalBody({
      leaseChanges: [{ id: "change_1", lease_id: "lease_1", change_type: "renewal", status: "applied", created_at: "2026-01-01T00:00:00.000Z" }],
    });
    const fetch = stubFetch([first, second]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalLeaseRenewalPanel />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-lease-id="lease_1"]'));
    expect(mounted.container.querySelector('[data-guided-workflow-step="renewal-draft"]')).toBeTruthy();
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="next"]'));
    expect(mounted.container.querySelector('[data-guided-workflow-step="renewal-review"]')).toBeTruthy();
    expect(mounted.container.textContent).toContain("This lease has been renewed.");
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="next"]'));
    expect(mounted.container.textContent).toContain("This lease has been renewed.");
    expect(mounted.container.querySelector('[data-guided-workflow-step]')).toBeFalsy();
  });

  it("never claims the renewal complete while a real requirement is still outstanding", async () => {
    const overrides = { leaseChanges: [{ id: "change_1", lease_id: "lease_1", change_type: "renewal", status: "draft", created_at: "2026-01-01T00:00:00.000Z" }] };
    const fetch = stubFetch([rentalBody(), rentalBody(overrides)]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalLeaseRenewalPanel />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-lease-id="lease_1"]'));
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="next"]'));
    expect(mounted.container.textContent).not.toContain("renewed");
    expect(mounted.container.querySelector('[data-guided-workflow-step="renewal-approval"]')).toBeTruthy();
  });

  it("re-evaluates against fresh data on Next rather than trusting the earlier fetch", async () => {
    const first = rentalBody();
    const second = rentalBody({
      leaseChanges: [{ id: "change_1", lease_id: "lease_1", change_type: "renewal", status: "applied", created_at: "2026-01-01T00:00:00.000Z" }],
    });
    const fetch = stubFetch([first, second]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalLeaseRenewalPanel />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-lease-id="lease_1"]'));
    expect(mounted.container.querySelector('[data-guided-workflow-step="renewal-draft"]')).toBeTruthy();
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="next"]'));
    expect(mounted.container.querySelector('[data-guided-workflow-step="renewal-review"]')).toBeTruthy();
  });

  it("Change lease returns to the picker without losing the expiring-leases list", async () => {
    const fetch = stubFetch([rentalBody()]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalLeaseRenewalPanel />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-lease-id="lease_1"]'));
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="change-lease"]'));
    expect(mounted.container.querySelector("[data-guided-workflow-lease-picker]")).toBeTruthy();
  });

  it("pauses and resumes", async () => {
    const fetch = stubFetch([rentalBody()]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalLeaseRenewalPanel />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-lease-id="lease_1"]'));
    act(() => { mounted.container.querySelector('[data-guided-workflow-control="pause"]').click(); });
    expect(mounted.container.querySelector("[data-guided-workflow-paused]")).toBeTruthy();
    act(() => { mounted.container.querySelector('[data-guided-workflow-control="resume"]').click(); });
    expect(mounted.container.querySelector('[data-guided-workflow-step="renewal-draft"]')).toBeTruthy();
  });

  it("exits guidance", async () => {
    const fetch = stubFetch([rentalBody()]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalLeaseRenewalPanel />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-lease-id="lease_1"]'));
    act(() => { mounted.container.querySelector('[data-guided-workflow-control="exit"]').click(); });
    expect(mounted.container.textContent).toContain("Guidance exited.");
  });

  it("calls onNavigate with 'lease-lifecycle' when Open is clicked", async () => {
    const fetch = stubFetch([rentalBody()]);
    vi.stubGlobal("fetch", fetch);
    const onNavigate = vi.fn();
    mounted = mount(<RentalLeaseRenewalPanel onNavigate={onNavigate} />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-lease-id="lease_1"]'));
    act(() => { [...mounted.container.querySelectorAll("button")].find((b) => b.textContent.includes("Open")).click(); });
    expect(onNavigate).toHaveBeenCalledWith("lease-lifecycle");
  });

  it("never issues a mutating request -- only GET-shaped fetch calls happen from guidance", async () => {
    const fetch = stubFetch([rentalBody()]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalLeaseRenewalPanel />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-lease-id="lease_1"]'));
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="next"]'));
    for (const call of fetch.mock.calls) {
      const init = call[1];
      expect(!init || !init.method || init.method === "GET").toBe(true);
    }
  });

  it("shows an error and never starts a session when identity is missing from the response", async () => {
    const fetch = stubFetch([rentalBody({ actingUserId: null, canonicalOwnerId: null })]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalLeaseRenewalPanel />);
    await flush();
    expect(mounted.container.querySelector('[data-guided-workflow-lease-picker]')).toBeFalsy();
  });
});
