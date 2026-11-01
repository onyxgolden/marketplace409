// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache } from "../../../hooks/swrCache";
import ReservationsPanel from "./ReservationsPanel.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const response = (body) => ({ ok: true, json: async () => body });
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }

describe("ReservationsPanel follow-up G25 (O-03)", () => {
  let root;
  afterEach(() => { if (root) act(() => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); clearSWRCache(); });

  it("a checked-in stay shows the locked-dates explanation and no Modify or Cancel", async () => {
    vi.stubGlobal("fetch", vi.fn((url) => Promise.resolve(response(url.endsWith("/inventory") ? { inventory: [{ unit_id: "unit-1", public_name: "Cabin One", booking_status: "active" }] } : {
      reservations: [{ id: "res-1", unit_id: "unit-1", status: "checked_in", check_in_date: "2026-10-01", check_out_date: "2026-10-03", guest_count: 2, total_due_cents: 25000, reservation_guests: { display_name: "Guest One", email: "guest@example.test" }, reservation_inventory_settings: { public_name: "Cabin One" }, reservation_financial_contracts: { booking_balance_cents: 20000, security_deposit_cents: 5000 } }],
      events: [{ id: "event-1", reservation_id: "res-1", event_type: "checked_in", occurred_at: "2026-10-01T00:00:00Z" }],
    }))));
    const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    act(() => root.render(<ReservationsPanel />)); await flush();
    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent.includes("Cabin One")).click());
    const detail = container.querySelector("[aria-label='Reservation detail']");
    expect(detail.textContent).toContain("Dates and space are locked once a reservation is confirmed");
    expect(detail.textContent).toContain("can no longer be changed here");
    expect(detail.textContent).toContain("cannot be cancelled");
    const actions = [...detail.querySelectorAll("button")].map((button) => button.textContent);
    expect(actions).toContain("Check out");
    expect(actions).not.toContain("Modify");
    expect(actions).not.toContain("Cancel");
  });
});
