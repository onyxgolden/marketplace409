// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import MessagesPanel from "./MessagesPanel";
import { clearSWRCache } from "@/hooks/swrCache";

// Controls-sweep follow-up G24 (O-17, O-18): new message to a
// never-messaged tenant, template insert inside the thread.
const RENTAL_PAYLOAD = {
  tenants: [
    { id: "tenant_new", display_name: "Nina New" },
    { id: "tenant_old", display_name: "Omar Old" },
  ],
  conversations: [
    { id: "conv_1", tenantId: "tenant_old", lastMessageAt: "2026-10-31T10:00:00Z",
      lastMessageBody: "Hi", lastMessageSenderType: "tenant", unread: false },
  ],
};

async function flush(times = 10) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
function click(el) { act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); }
function setValue(el, value) {
  const proto = el instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  act(() => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
}

describe("MessagesPanel follow-up G24", () => {
  let container;
  let root;
  let posts;

  async function renderPanel() {
    posts = [];
    clearSWRCache();
    vi.stubGlobal("fetch", async (url, options = {}) => {
      const str = String(url);
      if (options.method === "POST") {
        posts.push({ url: str, body: JSON.parse(options.body || "{}") });
        if (str.endsWith("/message-templates/render")) return { ok: true, json: async () => ({ body: "Hello Nina!", missingFields: [] }) };
        return { ok: true, json: async () => ({ success: true }) };
      }
      if (str === "/api/rental") return { ok: true, json: async () => RENTAL_PAYLOAD };
      if (str === "/api/private-financing/conversations") return { ok: true, json: async () => ({ conversations: [] }) };
      if (str.startsWith("/api/rental/message-templates")) return { ok: true, json: async () => ({ templates: [{ id: "tpl_1", name: "Welcome", isSystem: true }] }) };
      if (str.startsWith("/api/rental/conversations/")) return { ok: true, json: async () => ({ messages: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<MessagesPanel />); });
    await flush();
  }

  afterEach(() => { act(() => { root?.unmount(); }); container?.remove(); vi.unstubAllGlobals(); });

  it("O-17: new-message picker lists only tenants without a conversation", async () => {
    await renderPanel();
    const picker = container.querySelector('select[aria-label="Start a new message with a tenant"]');
    expect(picker).toBeTruthy();
    const options = [...picker.querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toContain("Nina New");
    expect(options).not.toContain("Omar Old");
    setValue(picker, "tenant_new");
    await flush();
    expect(container.textContent).toContain("No messages yet");
    expect(container.querySelector("textarea")).toBeTruthy();
  });

  it("O-18: template inserts into the thread draft", async () => {
    await renderPanel();
    const picker = container.querySelector('select[aria-label="Start a new message with a tenant"]');
    setValue(picker, "tenant_new");
    await flush();
    await flush();
    const templateSelect = container.querySelector('select[aria-label="Insert a message template"]');
    expect(templateSelect).toBeTruthy();
    setValue(templateSelect, "tpl_1");
    await flush();
    expect(posts.some((p) => p.url.endsWith("/message-templates/render") && p.body.templateId === "tpl_1")).toBe(true);
    expect(container.querySelector("textarea").value).toContain("Hello Nina!");
  });
});
