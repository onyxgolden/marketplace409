// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache } from "../../../hooks/swrCache";
import RentalMailingPanel from "./RentalMailingPanel.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const response = (body) => ({ ok: true, json: async () => body });
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }
function click(button) { return act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }
function typeArea(area, value) {
  return act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("RentalMailingPanel follow-up G25 (O-24)", () => {
  let root;
  afterEach(() => { if (root) act(() => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); clearSWRCache(); });

  it("queued letters get address editing and two-step delete; mailed letters do not", async () => {
    const calls = [];
    const letter = { id: "letter_1", batchId: "batch_1", tenantName: "Tenant One", recipientAddress: "100 Old St", status: "queued", documentSubject: "Notice", trackingNumber: null };
    const mailed = { id: "letter_2", batchId: "batch_1", tenantName: "Tenant Two", recipientAddress: "200 Oak St", status: "mailed", documentSubject: "Notice", trackingNumber: "9400" };
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      calls.push({ url, options });
      if (options?.method === "PATCH") return response({ success: true, letter: { ...letter, recipientAddress: "300 New Ave" } });
      if (options?.method === "DELETE") return response({ success: true });
      if (url.includes("/api/rental/mailing/batches/")) return response({ batch: { id: "batch_1", name: "Batch One", letters: [letter, mailed] } });
      if (url.endsWith("/api/rental/mailing")) return response({ batches: [{ id: "batch_1", name: "Batch One", summary: { total: 2, queued: 1, mailed: 1, delivered: 0 } }] });
      if (url.endsWith("/api/rental/mailing/provider")) return response({ provider: null });
      if (url.includes("/message-templates")) return response({ templates: [] });
      return response({ tenants: [] });
    }));
    const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    act(() => root.render(<RentalMailingPanel />)); await flush();
    await click([...container.querySelectorAll("[role='tab']")].find((b) => b.textContent.includes("Queue")));
    await flush();
    await click([...container.querySelectorAll("button")].find((b) => b.textContent.includes("Batch One")));
    await flush();
    expect(container.textContent).toContain("Save address");
    expect(container.textContent).toContain("Delete letter");
    const letterItem = [...container.querySelectorAll("li")].find((li) => li.textContent.includes("Tenant One"));
    expect(letterItem.textContent).toContain("Save address");
    const mailedItem = [...container.querySelectorAll("li")].find((li) => li.textContent.includes("Tenant Two"));
    expect(mailedItem.textContent).not.toContain("Save address");
    expect(mailedItem.textContent).not.toContain("Delete letter");

    await typeArea(letterItem.querySelector("textarea"), "300 New Ave");
    await click([...letterItem.querySelectorAll("button")].find((b) => b.textContent === "Save address"));
    const patch = calls.find((c) => c.options?.method === "PATCH" && c.url.includes("/letters/letter_1"));
    expect(patch).toBeDefined();
    expect(JSON.parse(patch.options.body).recipientAddress).toBe("300 New Ave");

    await click([...letterItem.querySelectorAll("button")].find((b) => b.textContent === "Delete letter"));
    await click([...letterItem.querySelectorAll("button")].find((b) => b.textContent === "Delete this letter?"));
    const del = calls.find((c) => c.options?.method === "DELETE" && c.url.includes("/letters/letter_1"));
    expect(del).toBeDefined();
  });
});
