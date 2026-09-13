// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReservationsPanel from "./ReservationsPanel.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const response = body => ({ ok: true, json: async () => body });
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }

describe("ReservationsPanel", () => {
  let root;
  afterEach(() => { if (root) act(() => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

  it("shows a reservation detail, valid actions, and immutable history", async () => {
    vi.stubGlobal("fetch", vi.fn(url => Promise.resolve(response(url.endsWith("/inventory") ? { inventory: [{ unit_id: "unit-1", public_name: "Cabin One", booking_status: "active" }] } : {
      reservations: [{ id: "res-1", unit_id: "unit-1", status: "confirmed", check_in_date: "2026-10-01", check_out_date: "2026-10-03", guest_count: 2, total_due_cents: 25000, owner_notes: "Late arrival", reservation_guests: { display_name: "Guest One", email: "guest@example.test" }, reservation_inventory_settings: { public_name: "Cabin One" } }],
      events: [{ id: "event-1", reservation_id: "res-1", event_type: "confirmed", occurred_at: "2026-09-13T00:00:00Z" }],
    }))));
    const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    act(() => root.render(<ReservationsPanel />)); await flush();
    const reservation = [...container.querySelectorAll("button")].find(button => button.textContent.includes("Cabin One"));
    act(() => reservation.click());
    expect(container.querySelector("[aria-label='Reservation detail']").textContent).toContain("Guest One");
    expect(container.textContent).toContain("Immutable history");
    expect([...container.querySelectorAll("button")].map(button => button.textContent)).toEqual(expect.arrayContaining(["Modify", "Check in", "Cancel"]));
    act(() => [...container.querySelectorAll("button")].find(button => button.textContent === "Modify").click());
    expect(container.textContent).toContain("Modify reservation");
    expect(container.textContent).toContain("Preview changes");
  });
});
