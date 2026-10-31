// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalLeasePanel from "./RentalLeasePanel";

const setup = {
  units: [{ id: "unit_1", label: "4225 Barnhill", property_id: "4225-barnhill" }],
  tenants: [{ id: "tenant_1", display_name: "Steven Crabtree", email: "steven@example.com" }],
  leases: [], schedules: [], leaseMemberships: [],
};

function stubFetch() {
  const posted = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (url === "/api/rental" && options?.method === "POST") {
      const body = JSON.parse(options.body);
      posted.push(body);
      if (body.operation === "save-lease") {
        return { ok: true, json: async () => ({ lease: { id: "lease_new", monthlyRentCents: 180000,
          rentDueDay: 1, startDate: "2026-11-01", endDate: null } }) };
      }
      if (body.operation === "save-schedule") {
        return { ok: true, json: async () => ({ schedule: { id: "schedule_new" } }) };
      }
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
  return posted;
}

function renderPanel() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<RentalLeasePanel initialSetup={setup} loadOnMount={false} />);
  });
  return { container, root };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("RentalLeasePanel save confirmation", () => {
  it("shows a prominent Lease saved banner naming the property and tenant with no IDs", async () => {
    const posted = stubFetch();
    const { container } = renderPanel();
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
