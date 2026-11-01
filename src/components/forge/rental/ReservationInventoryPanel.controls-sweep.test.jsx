// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache } from "../../../hooks/swrCache";
import ReservationInventoryPanel from "./ReservationInventoryPanel";

function setSelect(select, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function item(overrides = {}) {
  return {
    unit_id: "unit-1", public_name: "Lake Site 1", inventory_type: "rv_site",
    maximum_guests: 6, minimum_nights: 2, maximum_nights: null, turnover_buffer_hours: 4,
    amenities: ["50 amp", "water"], booking_status: "draft",
    cleaning_fee_cents: 2500, security_deposit_cents: 10000, lodging_tax_basis_points: 1200,
    public_guest_agreement: "Be kind.", public_arrival_instructions: "Gate code 1234",
    public_access_release_hours: 24, public_booking_slug: null, ...overrides,
  };
}

async function mountWith(state) {
  const calls = [];
  const fetchMock = vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options?.method || "GET", body: options?.body });
    if (options?.method === "POST") {
      const sent = JSON.parse(options.body);
      if (sent.operation === "save-inventory") {
        const row = state.inventory.find((entry) => entry.unit_id === sent.inventory.unitId);
        if (row) row.booking_status = sent.inventory.bookingStatus;
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({ units: state.units, inventory: state.inventory, ratePlans: state.ratePlans }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ReservationInventoryPanel />); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  await act(async () => {});
  return { container, root, calls };
}

describe("ReservationInventoryPanel controls sweep — B6", () => {
  let mounted;

  afterEach(() => {
    if (mounted) act(() => mounted.root.unmount());
    mounted?.container.remove();
    mounted = null;
    vi.unstubAllGlobals();
    clearSWRCache();
  });

  it("edits a configured space: Edit prefills the form including rate and status", async () => {
    mounted = await mountWith({
      units: [{ id: "unit-1", label: "Site 1" }],
      inventory: [item()],
      ratePlans: [{ unit_id: "unit-1", label: "Base nightly rate", amount_cents: 8900 }],
    });
    const { container } = mounted;
    act(() => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Edit").click(); });
    const form = container.querySelector("form");
    expect(form.textContent).toContain("Edit space");
    expect([...form.querySelectorAll("input")].find((input) => input.value === "Lake Site 1")).toBeDefined();
    expect([...form.querySelectorAll("input")].find((input) => input.value === "89.00")).toBeDefined();
    const selects = form.querySelectorAll("select");
    expect(selects[0].disabled).toBe(true);
    expect([...selects].find((select) => select.value === "draft")).toBeDefined();
    expect(form.textContent).toContain("cannot change while editing");
  });

  it("draft → active save publishes the booking link, and active → draft hides it", async () => {
    const state = {
      units: [{ id: "unit-1", label: "Site 1" }],
      inventory: [item({ booking_status: "draft", public_booking_slug: "stay-lake" })],
      ratePlans: [{ unit_id: "unit-1", label: "Base nightly rate", amount_cents: 8900 }],
    };
    mounted = await mountWith(state);
    const { container, calls } = mounted;
    expect(container.querySelector("a")).toBeNull();
    act(() => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Edit").click(); });
    const form = container.querySelector("form");
    const bookingSelect = [...form.querySelectorAll("select")].find((select) => [...select.options].some((option) => option.value === "active"));
    setSelect(bookingSelect, "active");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await act(async () => {});
    const post = calls.find((call) => call.method === "POST");
    expect(JSON.parse(post.body).inventory.bookingStatus).toBe("active");
    expect(JSON.parse(post.body).inventory.unitId).toBe("unit-1");
    expect(container.querySelector('[role="status"]').textContent).toContain("Inventory saved: Lake Site 1 — booking active.");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/book/stay-lake");
  });

  it("cancel edit restores the blank configure form", async () => {
    mounted = await mountWith({
      units: [{ id: "unit-1", label: "Site 1" }],
      inventory: [item()],
      ratePlans: [],
    });
    const { container } = mounted;
    act(() => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Edit").click(); });
    expect(container.querySelector("form").textContent).toContain("Edit space");
    act(() => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Cancel edit").click(); });
    expect(container.querySelector("form").textContent).toContain("Configure a space");
    expect(container.querySelector("form").textContent).not.toContain("Edit space");
  });
});
