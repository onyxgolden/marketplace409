// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalSetupPanel from "./RentalSetupPanel";

const units = [{ id: "unit_1", property_id: "1214-wagner", label: "1214 Wagner", status: "available" }];

describe("RentalSetupPanel create safety", () => {
  let root; let container;
  afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); vi.unstubAllGlobals(); });

  it("makes create mode visible, hides the property browser, and requires confirmation", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ units, leases: [], leaseMemberships: [], tenants: [], openCharges: [] }) }));
    vi.stubGlobal("fetch", fetch); vi.stubGlobal("confirm", vi.fn(() => false));
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root.render(<RentalSetupPanel initialUnits={units} />); await Promise.resolve(); await Promise.resolve(); });
    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent.includes("Add a new property")).click());
    expect(container.textContent).toContain("You are creating a separate record");
    expect(container.querySelector("[data-rental-record-browser]")).toBeNull();
    await act(async () => container.querySelector("form").requestSubmit());
    expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining("This creates a separate record"));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("requires the exact archived unit name before requesting permanent deletion", async () => {
    const archived = [...units, { id: "unit_archived", property_id: "1214-wagner", label: "1214 Wagner duplicate", status: "inactive" }];
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ units: archived, leases: [], leaseMemberships: [], tenants: [], openCharges: [] }) }));
    vi.stubGlobal("fetch", fetch); vi.stubGlobal("prompt", vi.fn(() => "wrong name"));
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root.render(<RentalSetupPanel initialUnits={archived} />); await Promise.resolve(); await Promise.resolve(); });
    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent.includes("Permanently delete")).click());
    expect(globalThis.prompt).toHaveBeenCalledWith(expect.stringContaining("cannot be undone"));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("name did not match");
  });
});
