// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import MessagesPanel from "./MessagesPanel.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}
function unmount(mounted) { act(() => mounted.root.unmount()); mounted.container.remove(); }
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }

const rentalPayload = {
  tenants: [{ id: "tenant_1", display_name: "Jane Tenant" }],
  conversations: [{ id: "conversation_1", tenantId: "tenant_1", lastMessageAt: "2026-09-18T12:00:00Z", lastMessageBody: "The heater is not working.", lastMessageSenderType: "tenant", unread: true }],
};
const pfPayload = {
  conversations: [{ id: "pf_conversation_1", borrowerId: "brw_1", borrowerName: "Jordan Ellis", lastMessageAt: "2026-09-18T09:00:00Z", lastMessageBody: "Thanks!", lastMessageSenderType: "borrower", unread: false }],
};

function stubFetch({ rental = rentalPayload, pf = pfPayload, thread = { messages: [] }, sendResult } = {}) {
  const fetch = vi.fn(async (url, init) => {
    if (url === "/api/rental") return { ok: true, json: async () => rental };
    if (url === "/api/private-financing/conversations") return { ok: true, json: async () => pf };
    if (url.startsWith("/api/rental/conversations/") || url.startsWith("/api/private-financing/conversations/")) {
      if (init?.method === "POST") return { ok: true, json: async () => (sendResult || { success: true, message: { messageId: "m2" } }) };
      return { ok: true, json: async () => thread };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("MessagesPanel", () => {
  let mounted;
  afterEach(() => { if (mounted) unmount(mounted); mounted = null; vi.unstubAllGlobals(); });

  it("shows a loading state, then merges rental and private-financing conversations sorted by most recent activity", async () => {
    stubFetch();
    mounted = mount(<MessagesPanel />);
    expect(mounted.container.textContent).toContain("Loading messages…");
    await flush();
    const names = [...mounted.container.querySelectorAll("li button span.font-bold")].map((el) => el.textContent);
    expect(names).toEqual(["Jane Tenant", "Jordan Ellis"]);
  });

  it("shows an unread indicator only for the conversation flagged unread", async () => {
    stubFetch();
    mounted = mount(<MessagesPanel />);
    await flush();
    const items = [...mounted.container.querySelectorAll("li")];
    expect(items[0].querySelector('[aria-label="Unread"]')).not.toBeNull();
    expect(items[1].querySelector('[aria-label="Unread"]')).toBeNull();
  });

  it("labels each entry by its domain", async () => {
    stubFetch();
    mounted = mount(<MessagesPanel />);
    await flush();
    expect(mounted.container.textContent).toContain("Rental");
    expect(mounted.container.textContent).toContain("Financing");
  });

  it("opens the rental thread through the rental-scoped route when a rental entry is selected", async () => {
    const fetch = stubFetch({ thread: { messages: [{ id: "m1", senderType: "tenant", body: "The heater is not working.", category: "issue", createdAt: "2026-09-18T12:00:00Z" }] } });
    mounted = mount(<MessagesPanel />);
    await flush();
    const button = [...mounted.container.querySelectorAll("li button")].find((b) => b.textContent.includes("Jane Tenant"));
    await act(async () => button.click());
    await flush();
    expect(fetch).toHaveBeenCalledWith("/api/rental/conversations/tenant_1/messages");
    expect(mounted.container.textContent).toContain("The heater is not working.");
  });

  it("opens the private-financing thread through the private-financing-scoped route when that entry is selected", async () => {
    const fetch = stubFetch({ thread: { messages: [{ id: "m1", senderType: "borrower", body: "Thanks!", category: null, createdAt: "2026-09-18T09:00:00Z" }] } });
    mounted = mount(<MessagesPanel />);
    await flush();
    const button = [...mounted.container.querySelectorAll("li button")].find((b) => b.textContent.includes("Jordan Ellis"));
    await act(async () => button.click());
    await flush();
    expect(fetch).toHaveBeenCalledWith("/api/private-financing/conversations/brw_1/messages");
  });

  it("sends a reply to the currently open thread and does not offer a category (owner messages are never categorized)", async () => {
    const fetch = stubFetch({ thread: { messages: [] } });
    mounted = mount(<MessagesPanel />);
    await flush();
    const button = [...mounted.container.querySelectorAll("li button")].find((b) => b.textContent.includes("Jane Tenant"));
    await act(async () => button.click());
    await flush();
    expect(mounted.container.textContent).not.toContain("Suggestion");
    mounted.container.querySelector('textarea[name="body"]').value = "Sending someone tomorrow.";
    await act(async () => mounted.container.querySelector("form").requestSubmit());
    expect(fetch).toHaveBeenCalledWith("/api/rental/conversations/tenant_1/messages", expect.objectContaining({
      method: "POST", body: JSON.stringify({ body: "Sending someone tomorrow." }),
    }));
  });

  it("shows an error instead of the inbox when the rental fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => url === "/api/rental"
      ? { ok: false, json: async () => ({ error: "Unable to load open rent charges." }) }
      : { ok: true, json: async () => pfPayload }));
    mounted = mount(<MessagesPanel />);
    await flush();
    expect(mounted.container.textContent).toContain("Unable to load open rent charges.");
  });
});
