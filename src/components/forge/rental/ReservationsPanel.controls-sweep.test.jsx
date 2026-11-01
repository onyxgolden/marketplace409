// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache } from "../../../hooks/swrCache";
import ReservationsPanel from "./ReservationsPanel.jsx";

const response = (body) => ({ ok: true, json: async () => body });
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }

const held = {
  id: "res-held", unit_id: "unit-1", status: "held", check_in_date: "2026-11-10", check_out_date: "2026-11-12",
  guest_count: 2, total_due_cents: 18000, owner_notes: null,
  reservation_guests: { display_name: "Hold Guest", email: "hold@example.test" },
  reservation_inventory_settings: { public_name: "Cabin One" },
};

describe("ReservationsPanel controls sweep — B7", () => {
  let root;

  afterEach(() => {
    if (root) act(() => root.unmount());
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    clearSWRCache();
  });

  async function mountHeld(fetchMock) {
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<ReservationsPanel />));
    await flush();
    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent.includes("Cabin One")).click());
    return container;
  }

  it("explains a held reservation and offers confirm and cancel", async () => {
    const container = await mountHeld(vi.fn((url) => Promise.resolve(response(url.endsWith("/inventory")
      ? { inventory: [{ unit_id: "unit-1", public_name: "Cabin One", booking_status: "active" }] }
      : { reservations: [held], events: [] }))));
    const detail = container.querySelector("[aria-label='Reservation detail']");
    expect(detail.textContent).toContain("on hold");
    expect(detail.textContent).toContain("Confirm hold");
    expect(detail.textContent).toContain("Cancel hold");
    expect([...container.querySelectorAll("button")].map((button) => button.textContent)).not.toContain("Check in");
  });

  it("cancel hold calls the real cancel transition and confirms", async () => {
    vi.stubGlobal("confirm", () => true);
    const fetchMock = vi.fn(async (url, options) => {
      if (options?.method === "PATCH") return response({ success: true, reservation: { ...held, status: "cancelled" } });
      return response(url.endsWith("/inventory")
        ? { inventory: [{ unit_id: "unit-1", public_name: "Cabin One", booking_status: "active" }] }
        : { reservations: [held], events: [] });
    });
    const container = await mountHeld(fetchMock);
    await act(async () => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Cancel hold").click();
      await Promise.resolve();
    });
    await flush();
    const cancelCall = fetchMock.mock.calls.find(([, options]) => options?.method === "PATCH");
    expect(cancelCall).toBeDefined();
    expect(JSON.parse(cancelCall[1].body).operation).toBe("cancel");
    expect(JSON.parse(cancelCall[1].body).reservationId).toBe("res-held");
    expect(container.querySelector('[role="status"]').textContent).toContain("Reservation cancel complete.");
  });

  it("confirm hold calls the real confirm transition and the row gains confirmed actions", async () => {
    vi.stubGlobal("confirm", () => true);
    let confirmed = false;
    const fetchMock = vi.fn(async (url, options) => {
      if (options?.method === "PATCH") {
        confirmed = true;
        return response({ success: true, reservation: { ...held, status: "confirmed" } });
      }
      return response(url.endsWith("/inventory")
        ? { inventory: [{ unit_id: "unit-1", public_name: "Cabin One", booking_status: "active" }] }
        : { reservations: [confirmed ? { ...held, status: "confirmed" } : held], events: [] });
    });
    const container = await mountHeld(fetchMock);
    await act(async () => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Confirm hold").click();
      await Promise.resolve();
    });
    await flush();
    const confirmCall = fetchMock.mock.calls.find(([, options]) => options?.method === "PATCH");
    expect(confirmCall).toBeDefined();
    expect(JSON.parse(confirmCall[1].body).operation).toBe("confirm");
    expect(JSON.parse(confirmCall[1].body).reservationId).toBe("res-held");
    expect(container.querySelector('[role="status"]').textContent).toContain("Reservation confirm complete.");
    const buttons = [...container.querySelectorAll("button")].map((button) => button.textContent);
    expect(buttons).toContain("Modify");
    expect(buttons).toContain("Check in");
    expect(buttons).toContain("Cancel");
    expect(buttons).not.toContain("Confirm hold");
  });
});
