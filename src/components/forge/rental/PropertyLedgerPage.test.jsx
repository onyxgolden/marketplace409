// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import PropertyLedgerPage from "./PropertyLedgerPage";

const ledgerPayload = {
  success: true,
  ledger: {
    propertyName: "308 Paula",
    entries: [],
    incomeCents: 0,
    expenseCents: 0,
    balanceCents: 0,
    entryCount: 0,
  },
};

function stubFetch(handler) {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => handler(url, options)));
}

function renderPage(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <PropertyLedgerPage
        propertyId="prop-1"
        propertyLabel="308 Paula"
        properties={[{ id: "prop-1", label: "308 Paula" }]}
        tenants={[{ id: "tenant-1", display_name: "Eric Carrillo" }]}
        onClose={() => {}}
        {...props}
      />,
    );
  });
  return { container, root };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("PropertyLedgerPage post buttons", () => {
  it("opens the transaction form modal on Post Income and closes it on cancel", async () => {
    stubFetch(async (url) => {
      if (url === "/api/rental/property-ledger?propertyId=prop-1") {
        return { ok: true, json: async () => ledgerPayload };
      }
      if (url === "/api/rental/bank-accounts") {
        return { ok: true, json: async () => ({ accounts: [] }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const { container } = renderPage();
    await act(async () => {});

    const postIncome = Array.from(container.querySelectorAll("button")).find((el) => el.textContent === "Post Income");
    act(() => { postIncome.click(); });
    // Modal title uses sentence case; the page button uses title case.
    expect(container.querySelector('[role="dialog"] h3')?.textContent).toBe("Post income");
    expect(container.textContent).toMatch(/Charge tenant/);

    const closeButton = container.querySelector('[aria-label="Close transaction form"]');
    act(() => { closeButton.click(); });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("defers to host overrides when onPostIncome is provided", async () => {
    stubFetch(async (url) => {
      if (url === "/api/rental/property-ledger?propertyId=prop-1") {
        return { ok: true, json: async () => ledgerPayload };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const onPostIncome = vi.fn();
    const { container } = renderPage({ onPostIncome });
    await act(async () => {});
    const postIncome = Array.from(container.querySelectorAll("button")).find((el) => el.textContent === "Post Income");
    act(() => { postIncome.click(); });
    expect(onPostIncome).toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
