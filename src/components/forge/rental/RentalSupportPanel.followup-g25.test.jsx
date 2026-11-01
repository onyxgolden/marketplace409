// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache } from "../../../hooks/swrCache";
import RentalSupportPanel from "./RentalSupportPanel.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const response = (body) => ({ ok: true, json: async () => body });
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }
function click(button) { return act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }
function type(input, value) {
  return act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}
function setSelect(select, value) {
  return act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("RentalSupportPanel follow-up G25 (O-20)", () => {
  let root;
  afterEach(() => { if (root) act(() => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); clearSWRCache(); });

  async function renderPanel(fetchMock) {
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    act(() => root.render(<RentalSupportPanel />)); await flush();
    return container;
  }

  it("reopens a resolved case and offers an open-case create form", async () => {
    const calls = [];
    const fetchMock = vi.fn(async (url, options) => {
      calls.push({ url, options });
      if (options?.method === "POST") return response({ success: true, supportCase: { id: "case_1", status: "open" } });
      return response({
        supportCases: [{ id: "case_1", tenant_id: "tenant_1", title: "Heater is out", status: "resolved", case_type: "other", priority: "normal", tenant_name: "Tenant One" }],
        tenants: [{ id: "tenant_1", display_name: "Tenant One" }],
      });
    });
    const container = await renderPanel(fetchMock);
    expect(container.textContent).toContain("Heater is out");
    const caseCard = [...container.querySelectorAll("article")].find((a) => a.textContent.includes("Heater is out"));
    expect(caseCard.textContent).toContain("Reopen case");
    await click([...caseCard.querySelectorAll("button")].find((b) => b.textContent === "Reopen case"));
    const reopen = calls.find((c) => c.options?.method === "POST" && JSON.parse(c.options.body).operation === "update-support-case");
    expect(JSON.parse(reopen.options.body).status).toBe("open");

    await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Open a case"));
    const createForm = [...container.querySelectorAll("form")].find((f) => f.textContent.includes("Open case"));
    expect(createForm).not.toBeUndefined();
    await setSelect(createForm.querySelector("select"), "tenant_1");
    await type(createForm.querySelector("input"), "Leaky faucet");
    await click([...createForm.querySelectorAll("button")].find((b) => b.textContent === "Open case"));
    const create = calls.find((c) => c.options?.method === "POST" && JSON.parse(c.options.body).operation === "create-support-case");
    expect(create).toBeDefined();
    const createBody = JSON.parse(create.options.body);
    expect(createBody.operation).toBe("create-support-case");
    expect(createBody.supportCase.title).toBe("Leaky faucet");
    expect(createBody.supportCase.tenantId).toBe("tenant_1");
  });
});
