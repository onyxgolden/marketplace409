// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import PublicReservationBooking from "./PublicReservationBooking";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const listing = { publicName: "Pine Cabin", publicDescription: "Quiet cabin", inventoryType: "cabin", maximumGuests: 4, minimumNights: 2, cancellationPolicy: "Contact the property before arrival." };
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }

describe("PublicReservationBooking", () => {
  let root;
  afterEach(() => { if (root) act(() => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
  it("loads only public listing fields and requires a reviewed exact-price preview", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ listing }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ preview: { listing, quote: { nights: 2, lodgingAmountCents: 20000, cleaningFeeCents: 3000, lodgingTaxCents: 1200, securityDepositCents: 5000, totalDueCents: 29200, currencyCode: "USD" } }, previewToken: "signed" }) }));
    const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); act(() => root.render(<PublicReservationBooking slug="stay-safe" />)); await flush();
    expect(container.textContent).toContain("Pine Cabin");
    for (const [name, value] of [["Check-in", "2026-10-01"], ["Check-out", "2026-10-03"], ["Name", "Guest One"], ["Email", "guest@example.test"]]) { const input = [...container.querySelectorAll("label")].find(node => node.textContent.startsWith(name)).querySelector("input"); await act(async () => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); }); }
    await act(async () => { container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); await flush();
    expect(container.textContent).toContain("$292.00");
    expect(container.textContent).toContain("No payment will be collected now");
    const confirm = [...container.querySelectorAll("button")].find(button => button.textContent === "Confirm reservation");
    expect(confirm.disabled).toBe(true);
  });
});
