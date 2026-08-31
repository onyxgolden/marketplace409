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
    expect(mounted.container.textContent).toContain("Drivable RVs are intentionally excluded");
  });
});
