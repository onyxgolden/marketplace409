// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache } from "../../../hooks/swrCache";
import RentalSetupPanel from "./RentalSetupPanel";

const units = [{ id: "unit_1", property_id: "1214-wagner", label: "1214 Wagner", status: "available" }];

describe("RentalSetupPanel tenant action", () => {
  let container; let root;
  afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); vi.unstubAllGlobals(); clearSWRCache(); });

  it("opens tenant creation for the selected property", async () => {
    const unit = { id: "unit_1", label: "930 Highland Drive", property_id: "930-highland-drive", status: "available" };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ units: [unit], leases: [], leaseMemberships: [], tenants: [], openCharges: [] }) })));
    const onNavigate = vi.fn(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root.render(<RentalSetupPanel initialUnits={[unit]} onNavigate={onNavigate} />));
    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent === "Add tenant").click());
    expect(onNavigate).toHaveBeenCalledWith("tenants", expect.objectContaining({ recordId: "unit_1", openCreateTenant: true, recordLabel: "930 Highland Drive" }));
  });

  it("makes create mode visible, hides the property browser, and requires confirmation", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ units, leases: [], leaseMemberships: [], tenants: [], openCharges: [] }) }));
    vi.stubGlobal("fetch", fetch); vi.stubGlobal("confirm", vi.fn(() => false));
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root.render(<RentalSetupPanel initialUnits={units} />); await Promise.resolve(); await Promise.resolve(); });
    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent.includes("Add a new property")).click());
    expect(container.textContent).toContain("You are creating a separate record");
    expect(container.querySelector("[data-rental-record-browser]")).toBeNull();
    // The create form ships blank now (no sample property data) -- fill it before submitting.
    await act(async () => {
      const form = container.querySelector("form");
      form.querySelector('input[name="propertyId"]').value = "1214-wagner-2";
      form.querySelector('input[name="label"]').value = "1214 Wagner Unit B";
      form.querySelector('input[name="addressStreet"]').value = "1214 Wagner St";
      form.querySelector('input[name="addressCity"]').value = "Orange";
      form.querySelector('select[name="addressState"]').value = "TX";
      form.querySelector('input[name="addressZip"]').value = "77630";
      form.requestSubmit();
    });
    expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining("1214 Wagner Unit B"));
    // The property card also fetches its own expense history — count only the panel's data load.
    expect(fetch.mock.calls.filter(([url]) => url === "/api/rental")).toHaveLength(1);
  });

  it("requires the exact archived unit name before requesting permanent deletion", async () => {
    const archived = [...units, { id: "unit_archived", property_id: "1214-wagner", label: "1214 Wagner duplicate", status: "inactive" }];
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ units: archived, leases: [], leaseMemberships: [], tenants: [], openCharges: [] }) }));
    vi.stubGlobal("fetch", fetch); vi.stubGlobal("prompt", vi.fn(() => "wrong name"));
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root.render(<RentalSetupPanel initialUnits={archived} />); await Promise.resolve(); await Promise.resolve(); });
    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent.includes("Permanently delete")).click());
    expect(globalThis.prompt).toHaveBeenCalledWith(expect.stringContaining("cannot be undone"));
    // The property card also fetches its own expense history — count only the panel's data load.
    expect(fetch.mock.calls.filter(([url]) => url === "/api/rental")).toHaveLength(1);
    expect(container.textContent).toContain("name did not match");
  });

  it("blocks property creation when the address fails validation", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ units, leases: [], leaseMemberships: [], tenants: [], openCharges: [] }) }));
    vi.stubGlobal("fetch", fetch); vi.stubGlobal("confirm", vi.fn(() => true));
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root.render(<RentalSetupPanel initialUnits={units} />); await Promise.resolve(); await Promise.resolve(); });
    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent.includes("Add a new property")).click());
    await act(async () => {
      const form = container.querySelector("form");
      form.querySelector('input[name="propertyId"]').value = "1214-wagner-3";
      form.querySelector('input[name="label"]').value = "1214 Wagner Unit C";
      form.querySelector('input[name="addressStreet"]').value = "1214 Wagner St";
      form.querySelector('input[name="addressCity"]').value = "Orange";
      form.querySelector('select[name="addressState"]').value = "TX";
      form.querySelector('input[name="addressZip"]').value = "bad-zip";
      form.requestSubmit();
    });
    expect(container.textContent).toContain("Fix the property address");
    expect(container.textContent).toMatch(/valid ZIP/i);
    expect(globalThis.confirm).not.toHaveBeenCalled();
    expect(fetch.mock.calls.filter(([url, options]) => url === "/api/rental" && options?.method === "POST")).toHaveLength(0);
  });

  it("submits the structured address with a new property", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ units, leases: [], leaseMemberships: [], tenants: [], openCharges: [] }) }));
    vi.stubGlobal("fetch", fetch); vi.stubGlobal("confirm", vi.fn(() => true));
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root.render(<RentalSetupPanel initialUnits={units} />); await Promise.resolve(); await Promise.resolve(); });
    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent.includes("Add a new property")).click());
    await act(async () => {
      const form = container.querySelector("form");
      form.querySelector('input[name="propertyId"]').value = "1214-wagner-3";
      form.querySelector('input[name="label"]').value = "1214 Wagner Unit C";
      form.querySelector('input[name="addressStreet"]').value = "1214 Wagner St";
      form.querySelector('input[name="addressUnit"]').value = "Apt 2";
      form.querySelector('input[name="addressCity"]').value = "Orange";
      form.querySelector('select[name="addressState"]').value = "TX";
      form.querySelector('input[name="addressZip"]').value = "77630";
      form.requestSubmit();
    });
    expect(globalThis.confirm).toHaveBeenCalled();
    const post = fetch.mock.calls.find(([url, options]) => url === "/api/rental" && options?.method === "POST");
    expect(post).toBeDefined();
    const payload = JSON.parse(post[1].body).unit;
    expect(payload.addressStreet).toBe("1214 Wagner St");
    expect(payload.addressUnit).toBe("Apt 2");
    expect(payload.addressCity).toBe("Orange");
    expect(payload.addressState).toBe("TX");
    expect(payload.addressZip).toBe("77630");
  });
});
