// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import TenantMessagesPanel from "./TenantMessagesPanel.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}
function unmount(mounted) { act(() => mounted.root.unmount()); mounted.container.remove(); }
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }

describe("TenantMessagesPanel", () => {
  let mounted;
  afterEach(() => { if (mounted) unmount(mounted); mounted = null; vi.unstubAllGlobals(); });

  it("renders the existing conversation", () => {
    const conversation = { hasUnread: false, messages: [
      { id: "m1", senderType: "tenant", body: "The heater is not working.", category: "issue", createdAt: "2026-09-18T11:00:00Z" },
    ] };
    mounted = mount(<TenantMessagesPanel conversation={conversation} onChanged={vi.fn()} />);
    expect(mounted.container.textContent).toContain("The heater is not working.");
  });

  it("marks an unread conversation read on mount, then refreshes the portal", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    vi.stubGlobal("fetch", fetch);
    const onChanged = vi.fn();
    const conversation = { hasUnread: true, messages: [] };
    mounted = mount(<TenantMessagesPanel conversation={conversation} onChanged={onChanged} />);
    await flush();
    expect(fetch).toHaveBeenCalledWith("/api/rental/portal", expect.objectContaining({
      body: JSON.stringify({ operation: "mark-conversation-read" }),
    }));
    expect(onChanged).toHaveBeenCalled();
  });

  it("does not mark read when the conversation has nothing unread", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const conversation = { hasUnread: false, messages: [] };
    mounted = mount(<TenantMessagesPanel conversation={conversation} onChanged={vi.fn()} />);
    await flush();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends a message with a category and refreshes the portal", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, message: { conversationId: "c1", messageId: "m2" } }) }));
    vi.stubGlobal("fetch", fetch);
    const onChanged = vi.fn();
    const conversation = { hasUnread: false, messages: [] };
    mounted = mount(<TenantMessagesPanel conversation={conversation} onChanged={onChanged} />);
    mounted.container.querySelector('textarea[name="body"]').value = "You should add a dog park.";
    const suggestionButton = [...mounted.container.querySelectorAll("button")].find((b) => b.textContent === "Suggestion");
    act(() => suggestionButton.click());
    await act(async () => mounted.container.querySelector("form").requestSubmit());
    expect(fetch).toHaveBeenCalledWith("/api/rental/portal", expect.objectContaining({
      body: JSON.stringify({ operation: "send-message", body: "You should add a dog park.", category: "suggestion" }),
    }));
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows the server's error and does not call onChanged when sending fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "A message body is required." }) })));
    const onChanged = vi.fn();
    const conversation = { hasUnread: false, messages: [] };
    mounted = mount(<TenantMessagesPanel conversation={conversation} onChanged={onChanged} />);
    mounted.container.querySelector('textarea[name="body"]').value = "Hello";
    await act(async () => mounted.container.querySelector("form").requestSubmit());
    expect(mounted.container.textContent).toContain("A message body is required.");
    expect(onChanged).not.toHaveBeenCalled();
  });
});
