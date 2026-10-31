// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import TenantPortal from "./TenantPortal";

const initialPortal = {
  tenant: { displayName: "Eric Carrillo" },
  conversation: { messages: [] },
  billingEnabled: true,
  paymentPolicy: null,
  convenienceFeeBps: 0,
  rentals: [{
    lease: { id: "lease_1", startDate: "2026-11-01", endDate: "2027-10-31" },
    unit: { label: "308 Paula" },
    charges: [],
    payments: [],
    schedules: [],
    credits: [],
    creditApplications: [],
    billingCadence: null,
    leaseSigning: {
      preparationId: "prep_1", versionNumber: 1, signedByMe: false,
      signatures: [], totalTenants: 1, terms: {},
    },
  }],
};

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (String(url).includes("/api/rental/portal") && options?.method === "POST") {
      return { ok: true, json: async () => ({ success: true }) };
    }
    if (String(url).includes("/api/rental/portal")) {
      return { ok: true, json: async () => ({ portal: initialPortal }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
}

async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("TenantPortal lease-signing confirmation", () => {
  it("signing a lease confirms the signature at the top of the portal", async () => {
    stubFetch();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(<TenantPortal initialPortal={initialPortal} />); });
    await flush();
    const form = container.querySelector("form");
    expect(form).toBeTruthy();
    const nameInput = form.querySelector('input[name="signerName"]');
    expect(nameInput).toBeTruthy();
    setInputValue(nameInput, "Eric Carrillo");
    const checkbox = form.querySelector('input[name="acknowledged"]');
    const checkedSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked").set;
    act(() => {
      checkedSetter.call(checkbox, true);
      checkbox.dispatchEvent(new Event("click", { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    const banner = container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Lease signed. Thank you — your landlord has been notified.");
  });
});
