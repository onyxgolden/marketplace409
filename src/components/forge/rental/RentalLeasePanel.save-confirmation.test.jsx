// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalLeasePanel from "./RentalLeasePanel";

// Fixture for the lease-create save confirmation (PR #701): no existing leases,
// so the create form renders.
const setup = {
  units: [{ id: "unit_1", label: "4225 Barnhill", property_id: "4225-barnhill" }],
  tenants: [{ id: "tenant_1", display_name: "Steven Crabtree", email: "steven@example.com" }],
  leases: [], schedules: [], leaseMemberships: [],
};

// Fixtures for the lease-detail save confirmations (sweep): an existing lease.
const baseSetup = {
  units: [{ id: "unit_1", label: "1218 Wagner", property_id: "1218-wagner" }],
  tenants: [{ id: "tenant_1", display_name: "Anthony Babino", email: "a@example.com" }],
  leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "1218-wagner", status: "active",
    monthly_rent_cents: 160000, rent_due_day: 5, start_date: "2026-09-01", end_date: "2027-08-31",
    begin_charges_date: "2026-09-15", currency_code: "USD" }],
  schedules: [{ id: "schedule_1", lease_id: "lease_1", status: "active", amount_cents: 160000, currency_code: "USD",
    due_day: 5, effective_start_date: "2026-09-01", effective_end_date: "2027-08-31", early_pay_days: 10 }],
  leaseMemberships: [],
};

// Draft leases render the activate/cancel controls and the schedule form;
// the base fixture's active lease does not.
const draftSetup = {
  ...baseSetup,
  leases: [{ ...baseSetup.leases[0], status: "draft" }],
  schedules: [{ ...baseSetup.schedules[0], status: "draft" }],
};

function stubFetch(postHandler) {
  const posted = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (url === "/api/rental" && options?.method === "POST") {
      const body = JSON.parse(options.body);
      posted.push(body);
      if (postHandler) return postHandler(body);
      if (body.operation === "save-lease") {
        return { ok: true, json: async () => ({ lease: { id: "lease_new", monthlyRentCents: 180000,
          rentDueDay: 1, startDate: "2026-11-01", endDate: null } }) };
      }
      if (body.operation === "save-schedule") {
        return { ok: true, json: async () => ({ schedule: { id: "schedule_new" } }) };
      }
      return { ok: true, json: async () => ({ success: true, lease: { id: "lease_1" }, schedule: { id: "schedule_1", amount_cents: 160000, due_day: 5, earlyPayDays: 10 } }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
  return posted;
}

function renderPanel(setupOverride = baseSetup) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<RentalLeasePanel initialSetup={setupOverride} loadOnMount={false} />);
  });
  return { container, root };
}

function findButton(container, text) {
  return [...container.querySelectorAll("button")].find((button) => button.textContent === text) || null;
}

function detailBanner(container) {
  return container.querySelector('[data-rental-lease-detail] p[role="status"]');
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("RentalLeasePanel save confirmation", () => {
  it("shows a prominent Lease saved banner naming the property and tenant with no IDs", async () => {
    const posted = stubFetch();
    const { container } = renderPanel(setup);
    const form = [...container.querySelectorAll("form")].find((item) => item.querySelector('select[name="unitId"]'));
    expect(form).toBeTruthy();
    form.querySelector('input[name="startDate"]').value = "2026-11-01";
    form.querySelector('input[name="monthlyRent"]').value = "1800";
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(posted).toHaveLength(2);
    expect(posted[0].operation).toBe("save-lease");
    expect(posted[1].operation).toBe("save-schedule");
    expect(container.textContent).toContain("Lease saved: 4225 Barnhill — Steven Crabtree — $1,800.00/mo, draft schedule ready");
    expect(container.textContent).not.toContain("lease_new");
    expect(container.textContent).not.toContain("schedule_new");
    expect(container.textContent).not.toContain("rental_lease_");
    const banner = [...container.querySelectorAll('p[role="status"]')]
      .find((item) => item.textContent.includes("Lease saved:"));
    expect(banner).toBeTruthy();
    expect(banner.className).toContain("border-emerald-300");
  });
});

describe("RentalLeasePanel detail save confirmations", () => {
  it("activating a lease confirms with the unit label, never the lease id", async () => {
    stubFetch();
    const { container } = renderPanel(draftSetup);
    const button = findButton(container, "Activate lease");
    expect(button).toBeTruthy();
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const banner = detailBanner(container);
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Lease activated for 1218 Wagner.");
    expect(banner.textContent).not.toContain("lease_1");
  });

  it("cancelling a lease confirms with the unit label, never the lease id", async () => {
    stubFetch();
    const { container } = renderPanel(draftSetup);
    const button = findButton(container, "Cancel this lease");
    expect(button).toBeTruthy();
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const banner = detailBanner(container);
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Lease cancelled for 1218 Wagner.");
    expect(banner.textContent).not.toContain("lease_1");
  });

  it("saving the early-pay window confirms the day count on the detail view", async () => {
    stubFetch((body) => ({ ok: true, json: async () => ({ schedule: { earlyPayDays: 14 } }) }));
    const { container } = renderPanel();
    const form = [...container.querySelectorAll("form")]
      .find((item) => item.textContent.includes("How many days before the due date"));
    expect(form).toBeTruthy();
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const banner = detailBanner(container);
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("Early pay window saved: 14 days.");
  });

  it("saving a rent schedule confirms unit, amount, and due day, never the schedule id", async () => {
    stubFetch((body) => ({ ok: true, json: async () => ({ schedule: { id: "schedule_9", amount_cents: 180000, due_day: 1 } }) }));
    const { container } = renderPanel({ ...draftSetup, schedules: [] });
    const form = [...container.querySelectorAll("form")]
      .find((item) => item.textContent.includes("Save rent schedule"));
    expect(form).toBeTruthy();
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const banner = detailBanner(container);
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("Rent schedule saved for 1218 Wagner");
    expect(banner.textContent).toContain("$1,800.00/mo");
    expect(banner.textContent).toContain("due day 1");
    expect(banner.textContent).toContain("You can now activate this lease.");
    expect(banner.textContent).not.toContain("schedule_9");
  });

  it("a detail error still reports as an error, never as a success banner", async () => {
    stubFetch(() => ({ ok: false, json: async () => ({ error: "Lease is already active." }) }));
    const { container } = renderPanel(draftSetup);
    const button = findButton(container, "Activate lease");
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(detailBanner(container)).toBeNull();
    const alert = container.querySelector('[data-rental-lease-detail] p[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain("Lease is already active.");
  });
});
