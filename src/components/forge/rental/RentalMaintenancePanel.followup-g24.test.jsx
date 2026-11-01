// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalMaintenancePanel from "./RentalMaintenancePanel";
import { clearSWRCache } from "@/hooks/swrCache";

// Controls-sweep follow-up G24 (O-18): template insert inside a
// work-order thread, rendered against the work order's merge fields.
const DATA = {
  maintenanceRequests: [{ id: "req_1", title: "Leaky faucet", description: "Drips", status: "open",
    priority: "routine", permission_to_enter: true, submitted_at: "2026-10-30T00:00:00Z", contact_phone: "", owner_notes: "" }],
  workOrders: [{ id: "wo_1", request_id: "req_1", scope_of_work: "Fix faucet", status: "scheduled",
    estimated_cost_cents: 5000, actual_cost_cents: null, messagesUnread: false }],
  workEvents: [],
  contractors: [],
  leases: [],
  units: [],
};

async function flush(times = 10) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
function click(el) { act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); }
function buttonWithText(root, text) {
  return [...root.querySelectorAll("button")].find((b) => b.textContent.includes(text));
}
function setValue(el, value) {
  const proto = el instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  act(() => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
}

describe("RentalMaintenancePanel work-order templates follow-up G24", () => {
  let container;
  let root;
  let posts;

  afterEach(() => { act(() => { root?.unmount(); }); container?.remove(); vi.unstubAllGlobals(); });

  it("O-18: template inserts into a work-order thread with the work order id", async () => {
    posts = [];
    clearSWRCache();
    vi.stubGlobal("fetch", async (url, options = {}) => {
      const str = String(url);
      if (options.method === "POST") {
        posts.push({ url: str, body: JSON.parse(options.body || "{}") });
        if (str.endsWith("/message-templates/render")) return { ok: true, json: async () => ({ body: "Your repair is scheduled.", missingFields: [] }) };
        return { ok: true, json: async () => ({ success: true }) };
      }
      if (str.startsWith("/api/rental/work-orders/")) return { ok: true, json: async () => ({ messages: [] }) };
      if (str.startsWith("/api/rental/message-templates")) return { ok: true, json: async () => ({ templates: [{ id: "tpl_wo", name: "Scheduled", isSystem: true }] }) };
      return { ok: true, json: async () => DATA };
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<RentalMaintenancePanel initialData={DATA} />); });
    await flush();
    click(buttonWithText(container, "Messages"));
    await flush();
    await flush();
    const templateSelect = container.querySelector('select[aria-label="Insert a message template"]');
    expect(templateSelect).toBeTruthy();
    setValue(templateSelect, "tpl_wo");
    await flush();
    const renderPost = posts.find((p) => p.url.endsWith("/message-templates/render"));
    expect(renderPost.body).toMatchObject({ templateId: "tpl_wo", workOrderId: "wo_1" });
    expect(container.querySelector("textarea").value).toContain("Your repair is scheduled.");
  });
});
