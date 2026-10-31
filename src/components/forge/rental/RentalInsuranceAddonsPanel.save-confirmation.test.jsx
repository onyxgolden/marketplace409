// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalInsuranceAddonsPanel from "./RentalInsuranceAddonsPanel";

const dashboard = {
  rows: [],
  pets: [{ animalId: "pet_1", name: "Biscuit", weightLbs: null, vaccinationStatus: "unknown", vaccinationExpiresOn: null }],
};

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (String(url).includes("/api/rental/insurance/dashboard")) {
      return { ok: true, json: async () => ({ dashboard }) };
    }
    if (String(url).includes("/api/rental/insurance/pet-records") && options?.method === "PATCH") {
      return { ok: true, json: async () => ({ success: true }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
}

async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

function setSelectValue(select, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  act(() => { setter.call(select, value); select.dispatchEvent(new Event("change", { bubbles: true })); });
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("RentalInsuranceAddonsPanel pet-details save confirmation", () => {
  it("saving pet details confirms with the pet's name", async () => {
    stubFetch();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(<RentalInsuranceAddonsPanel />); });
    await flush();
    const select = [...container.querySelectorAll("select")].find((item) =>
      [...item.options].some((option) => option.textContent === "Biscuit"));
    expect(select).toBeTruthy();
    setSelectValue(select, "pet_1");
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Save pet details");
    expect(button).toBeTruthy();
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    const banner = container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Pet details saved for Biscuit.");
  });
});
