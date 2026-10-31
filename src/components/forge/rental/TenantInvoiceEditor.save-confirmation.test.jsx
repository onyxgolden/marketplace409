// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import TenantInvoiceEditor from "./TenantInvoiceEditor";

const charge = {
  id: "charge_1", chargeType: "rent", amountCents: 160000, paidCents: 0,
  dueDate: "2026-11-01", notes: "November rent",
};

function stubFetch(postHandler) {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (String(url).includes("/api/rental/tenant-charges") && !options?.method) {
      return { ok: true, json: async () => ({ charge }) };
    }
    if (url === "/api/rental" && options?.method === "POST") {
      if (postHandler) return postHandler(JSON.parse(options.body));
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

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("TenantInvoiceEditor delete confirmation", () => {
  it("deleting an invoice calls onDeleted (not onSaved) so the ledger banner reads 'deleted'", async () => {
    const posted = [];
    stubFetch((body) => {
      posted.push(body);
      return { ok: true, json: async () => ({ success: true }) };
    });
    const onDeleted = vi.fn();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <TenantInvoiceEditor
          chargeId="charge_1" tenantId="tenant_1" tenantName="Eric Carrillo" tenantEmail="eric@example.com"
          onClose={onClose} onSaved={onSaved} onDeleted={onDeleted}
        />,
      );
    });
    await flush();
    const deleteButton = [...container.querySelectorAll("button")].find((item) => item.textContent === "Delete Invoice");
    expect(deleteButton).toBeTruthy();
    act(() => { deleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const confirmButton = [...container.querySelectorAll("button")].find((item) => item.textContent === "Confirm delete invoice");
    expect(confirmButton).toBeTruthy();
    await act(async () => {
      confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(posted).toHaveLength(1);
    expect(posted[0].operation).toBe("void-charge");
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
