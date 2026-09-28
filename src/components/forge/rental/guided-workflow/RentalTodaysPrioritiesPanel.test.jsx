// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalTodaysPrioritiesPanel from "./RentalTodaysPrioritiesPanel";
import { resetRentalSummaryClient } from "../rentalSummaryClient";
import { RENTAL_DASHBOARD_PAYLOAD_SWR_KEY } from "../useRentalDashboardPayload";
import { clearSWRCache, fetchWithDedupe, setCacheIdentity } from "../../../../hooks/swrCache";

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

// /api/rental always succeeds (from `rental`); /api/rental/reports resolves per-call from
// `reportsOkSequence` (true = 200 with reportBody(), false = a failing response) so tests can drive
// reports from failing to succeeding across a retry without touching /api/rental at all.
function stubFetchWithReportsSequence(rental, reportsOkSequence) {
  let reportsCall = 0;
  const fetch = vi.fn(async (url) => {
    if (String(url).includes("/api/rental/reports")) {
      const ok = reportsOkSequence[Math.min(reportsCall, reportsOkSequence.length - 1)];
      reportsCall += 1;
      if (!ok) return { ok: false, json: async () => ({ error: "Reports service unavailable." }) };
      return { ok: true, json: async () => reportBody() };
    }
    return { ok: true, json: async () => rental };
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
  // The session now initializes through the shared SWR cache (same key the
  // Overview panel uses), which persists to localStorage -- clear it between
  // tests so each test's fetch stub stays authoritative.
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } vi.unstubAllGlobals(); resetRentalSummaryClient(); clearSWRCache(); });

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

  it("keeps rendering non-report priorities and shows a partial-data notice when reports fails", async () => {
    const fetch = stubFetchWithReportsSequence(rentalBody({ units: [{ id: "u1" }, { id: "u2" }] }), [false]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalTodaysPrioritiesPanel />);
    await flush();
    expect(mounted.container.querySelector('[data-guided-workflow-step="vacancies"]')).toBeTruthy();
    expect(mounted.container.querySelector("[data-guided-workflow-partial-data]")).toBeTruthy();
    expect(mounted.container.textContent).toContain("Reports service unavailable.");
  });

  it("never shows 'Nothing urgent' when reports is unavailable, even with no other priorities", async () => {
    const fetch = stubFetchWithReportsSequence(rentalBody(), [false]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalTodaysPrioritiesPanel />);
    await flush();
    expect(mounted.container.textContent).not.toContain("Nothing urgent right now.");
    expect(mounted.container.querySelector("[data-guided-workflow-partial-data]")).toBeTruthy();
  });

  it("Retry clears the partial-data notice once reports succeeds", async () => {
    const fetch = stubFetchWithReportsSequence(rentalBody(), [false, true]);
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalTodaysPrioritiesPanel />);
    await flush();
    expect(mounted.container.querySelector("[data-guided-workflow-partial-data]")).toBeTruthy();
    await act(async () => {
      mounted.container.querySelector('[data-guided-workflow-control="retry-reports"]').click();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(mounted.container.querySelector("[data-guided-workflow-partial-data]")).toBeFalsy();
    expect(mounted.container.textContent).toContain("Nothing urgent right now.");
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

  it("ignores a late stale cache update while restart's authoritative fetch is in flight", async () => {
    // Initial mount fails so the panel lands on the "Try again" (restart) path.
    let rentalMode = "fail"; // "fail" -> "defer" once restart is clicked
    let resolveRestartFetch;
    const fetch = vi.fn(async (url) => {
      if (String(url).includes("/api/rental/reports")) {
        return { ok: true, json: async () => reportBody() };
      }
      if (rentalMode === "fail") {
        return { ok: false, json: async () => ({ error: "Rental summary could not be loaded." }) };
      }
      return new Promise((resolve) => {
        // B: the authoritative restart payload -- no vacancies.
        resolveRestartFetch = () => resolve({ ok: true, json: async () => rentalBody() });
      });
    });
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalTodaysPrioritiesPanel />);
    await flush();
    expect(mounted.container.textContent).toContain("Try again");

    rentalMode = "defer";
    act(() => {
      [...mounted.container.querySelectorAll("button")].find((b) => b.textContent === "Try again").click();
    });
    // Restart's authoritative fetch is now in flight; a stale cache update
    // (2 vacancies) lands first through the shared SWR key.
    const staleRaw = {
      rentalBody: rentalBody({ units: [{ id: "u1" }, { id: "u2" }, { id: "u3" }] }),
      reports: { available: true, report: reportBody().report, error: "" },
    };
    await act(async () => {
      await fetchWithDedupe(RENTAL_DASHBOARD_PAYLOAD_SWR_KEY, async () => staleRaw);
    });
    await flush();
    // The stale write must not initialize a session over the restart: still
    // loading, never the stale "Priority 1 of 2" session.
    expect(mounted.container.textContent).toContain("Loading today");
    expect(mounted.container.textContent).not.toContain("Priority 1 of 2");

    await act(async () => { resolveRestartFetch(); });
    await flush();
    expect(mounted.container.textContent).toContain("Nothing urgent right now.");
  });

  it("reinitializes the session for the new identity when the account switches", async () => {
    let identity = "user_1";
    const fetch = vi.fn(async (url) => {
      if (String(url).includes("/api/rental/reports")) {
        return { ok: true, json: async () => reportBody() };
      }
      // user_1 has a vacancy; user_2's unit is leased -- the visible session must change.
      const vacant = identity === "user_1";
      return {
        ok: true,
        json: async () => rentalBody({
          actingUserId: identity,
          units: vacant ? [{ id: "u1" }, { id: "u2" }] : [{ id: "u1" }],
          leases: vacant ? [] : [{ id: "lease_1", unit_id: "u1", status: "active" }],
        }),
      };
    });
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<RentalTodaysPrioritiesPanel />);
    await flush();
    expect(mounted.container.textContent).toContain("Priority 1 of 1");

    identity = "user_2";
    await act(async () => { setCacheIdentity("user_2"); });
    await flush();
    // The old identity's session must not survive the switch.
    expect(mounted.container.textContent).toContain("Nothing urgent right now.");
    expect(mounted.container.textContent).not.toContain("Priority 1 of 1");

    // Restore the null identity for the rest of the file (the epoch bump from
    // restoring also reinitializes, which is harmless post-assertion).
    await act(async () => { setCacheIdentity(null); });
    await flush();
  });
});
