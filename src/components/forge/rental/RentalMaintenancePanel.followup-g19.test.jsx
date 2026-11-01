// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalMaintenancePanel from "./RentalMaintenancePanel";

// Controls-sweep follow-up G19 (O-05–O-07): landlord create-request form,
// contractor edit/deactivate, and the explicit cancel-is-terminal text.
const DATA = {
  maintenanceRequests: [{ id: "req_1", title: "Leaking sink", description: "Water below cabinet",
    status: "submitted", priority: "routine", permission_to_enter: true, contact_phone: null,
    submitted_at: "2026-10-20T00:00:00Z", owner_notes: null }],
  contractors: [{ id: "con_1", business_name: "Acme HVAC", trade: "HVAC", phone: "555-111",
    contact_name: "", email: "", license_reference: "", insurance_expiration: "",
    w9_status: "not_requested", tax_classification: "", tax_id_last4: "", status: "active" }],
  workOrders: [{ id: "wo_1", request_id: "req_1", scope_of_work: "Fix trap", status: "assigned",
    estimated_cost_cents: 10000, actual_cost_cents: null, messagesUnread: false }],
  workEvents: [],
  leases: [{ id: "lease_1", unit_id: "unit_1", status: "active" }],
  units: [{ id: "unit_1", label: "4225 Barnhill" }],
};

function setValue(el, value) {
  const proto = el instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype
    : el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  act(() => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function flush(times = 8) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
function click(el) { act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); }
function buttonWithText(root, text) {
  return [...root.querySelectorAll("button")].find((b) => b.textContent === text);
}

describe("RentalMaintenancePanel follow-up G19", () => {
  let container;
  let root;
  let posts;

  async function renderPanel() {
    posts = [];
    vi.stubGlobal("fetch", async (url, options = {}) => {
      if (options.method === "POST") {
        posts.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => DATA };
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<RentalMaintenancePanel initialData={DATA} />); });
    await flush();
  }

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.unstubAllGlobals();
  });

  it("O-05: landlord files a request against an active lease", async () => {
    await renderPanel();
    click(buttonWithText(container, "Report an issue"));
    await flush();
    const form = container.querySelector('form[aria-label="Report an issue"]');
    expect(form).toBeTruthy();
    expect(form.textContent).toContain("4225 Barnhill");
    setValue(form.querySelector('select[name="leaseId"]'), "lease_1");
    setValue(form.querySelector('input[name="title"]'), "Tenant called: no heat");
    setValue(form.querySelector('textarea[name="description"]'), "Furnace out since morning");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    const filed = posts.find((p) => p.operation === "create-maintenance-request");
    expect(filed).toBeTruthy();
    expect(filed.request.leaseId).toBe("lease_1");
    expect(filed.request.title).toBe("Tenant called: no heat");
    expect(container.textContent).toContain("Maintenance request filed.");
  });

  it("O-06: contractor edit prefills and posts an update; deactivate posts the status op", async () => {
    await renderPanel();
    click(buttonWithText(container, "Contractor directory"));
    await flush();
    expect(container.textContent).toContain("Acme HVAC");
    click(buttonWithText(container, "Edit"));
    await flush();
    const form = container.querySelector('form[aria-label="Edit contractor"]');
    expect(form).toBeTruthy();
    expect(form.querySelector('input[name="businessName"]').value).toBe("Acme HVAC");
    setValue(form.querySelector('input[name="phone"]'), "555-999");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    const updated = posts.find((p) => p.operation === "update-contractor");
    expect(updated).toBeTruthy();
    expect(updated.contractor.id).toBe("con_1");
    expect(updated.contractor.phone).toBe("555-999");
    // Saving closes the directory section; reopen it for the status button.
    click(buttonWithText(container, "Contractor directory"));
    await flush();
    click(buttonWithText(container, "Deactivate"));
    await flush();
    expect(posts.find((p) => p.operation === "deactivate-contractor")).toBeTruthy();
  });

  it("O-07: both detail views state cancel-is-terminal instead of a silent absence", async () => {
    await renderPanel();
    expect(container.textContent).toContain("There is no delete for requests: Cancelled is the terminal state.");
    expect(container.textContent).toContain("There is no delete for work orders: Cancelled is the terminal state.");
  });
});
