// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import GuestReservationAccess from "./GuestReservationAccess";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }
describe("GuestReservationAccess", () => {
  let root;
  afterEach(() => { if (root) act(() => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
  it("keeps instructions hidden before their release time", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access: { publicName: "Pine Cabin", checkIn: "2026-10-02", checkOut: "2026-10-04", available: false, availableAt: "2026-10-01T15:00:00Z", arrivalInstructions: null, financial: { bookingBalanceCents: 20000, securityDepositCents: 5000, bookingAmountDueCents: 20000, currencyCode: "USD", bookingPaymentStatus: "unpaid", securityDepositStatus: "required", settlementStatus: "not_applicable" } } }) }));
    const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); act(() => root.render(<GuestReservationAccess slug="stay" token="private" />)); await flush();
    expect(container.textContent).toContain("Access details will be available");
    expect(container.textContent).not.toContain("Gate code");
    expect(container.textContent).toContain("No payment has been collected");
    expect(container.textContent).toContain("$200.00");
    expect(container.textContent).toContain("$50.00");
  });
  it("shows released instructions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access: { publicName: "Pine Cabin", checkIn: "2026-10-02", checkOut: "2026-10-04", available: true, availableAt: "2026-10-01T15:00:00Z", arrivalInstructions: "Gate code 2468" } }) }));
    const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); act(() => root.render(<GuestReservationAccess slug="stay" token="private" />)); await flush();
    expect(container.textContent).toContain("Gate code 2468");
  });
});
