// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReservationInventoryPanel from "./ReservationInventoryPanel";

async function mount(payload) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => payload })));
  const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
  await act(async () => { root.render(<ReservationInventoryPanel />); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  return { container, root };
}

describe("ReservationInventoryPanel", () => {
  let mounted;
  afterEach(() => { if (mounted) { act(() => mounted.root.unmount()); mounted.container.remove(); } vi.unstubAllGlobals(); });
  it("lists configured RV sites and short-term stays", async () => {
    mounted = await mount({ units: [{ id: "unit-1", label: "Site 1" }], inventory: [{ unit_id: "unit-1", public_name: "Lake Site 1", inventory_type: "rv_site", maximum_guests: 6, minimum_nights: 2, booking_status: "draft" }] });
    expect(mounted.container.textContent).toContain("Lake Site 1");
    expect(mounted.container.textContent).toContain("RV site");
    expect(mounted.container.textContent).toContain("Configure reservable spaces and stays");
    expect(mounted.container.textContent).toContain("Bulk import RV spots and cabins");
    expect(mounted.container.textContent).toContain("Download CSV template");
  });
  it("keeps labels and dropdown values readable in dark mode", async () => {
    mounted = await mount({ units: [{ id: "unit-1", label: "Site 1" }], inventory: [] });
    const form = mounted.container.querySelector("form");
    const selects = Array.from(form.querySelectorAll("select"));
    expect(form.className).toContain("dark:text-slate-100");
    expect(selects).toHaveLength(2);
    selects.forEach((select) => expect(select.className).toContain("dark:text-slate-100"));
    expect(selects[0].textContent).toContain("Site 1");
    expect(selects[1].textContent).toContain("RV site");
  });
});
