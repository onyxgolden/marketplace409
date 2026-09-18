// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrivateFinancingBorrowerMessages from "./PrivateFinancingBorrowerMessages.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}
function unmount(mounted) { act(() => mounted.root.unmount()); mounted.container.remove(); }
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }

describe("PrivateFinancingBorrowerMessages", () => {
  let mounted;
  afterEach(() => { if (mounted) unmount(mounted); mounted = null; vi.unstubAllGlobals(); });

  it("renders nothing when there are no conversations", () => {
    mounted = mount(<PrivateFinancingBorrowerMessages conversations={[]} onChanged={vi.fn()} />);
    expect(mounted.container.innerHTML).toBe("");
  });

  it("renders the existing conversation", () => {
    const conversations = [{ ownerId: "owner-1", borrowerId: "brw-1", hasUnread: false, messages: [
      { id: "m1", senderType: "borrower", body: "You should offer autopay for extra principal.", category: "suggestion", createdAt: "2026-09-18T11:00:00Z" },
    ] }];
    mounted = mount(<PrivateFinancingBorrowerMessages conversations={conversations} onChanged={vi.fn()} />);
    expect(mounted.container.textContent).toContain("You should offer autopay for extra principal.");
  });

  it("marks an unread conversation read on mount, scoped to that conversation's owner, then refreshes", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    vi.stubGlobal("fetch", fetch);
    const onChanged = vi.fn();
    const conversations = [{ ownerId: "owner-1", borrowerId: "brw-1", hasUnread: true, messages: [] }];
    mounted = mount(<PrivateFinancingBorrowerMessages conversations={conversations} onChanged={onChanged} />);
    await flush();
    expect(fetch).toHaveBeenCalledWith("/api/private-financing/portal", expect.objectContaining({
      body: JSON.stringify({ operation: "mark-conversation-read", ownerId: "owner-1" }),
    }));
    expect(onChanged).toHaveBeenCalled();
  });

  it("does not mark read when nothing is unread", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const conversations = [{ ownerId: "owner-1", borrowerId: "brw-1", hasUnread: false, messages: [] }];
    mounted = mount(<PrivateFinancingBorrowerMessages conversations={conversations} onChanged={vi.fn()} />);
    await flush();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends a message scoped to the conversation's owner and refreshes", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, message: { conversationId: "c1", messageId: "m2" } }) }));
    vi.stubGlobal("fetch", fetch);
    const onChanged = vi.fn();
    const conversations = [{ ownerId: "owner-1", borrowerId: "brw-1", hasUnread: false, messages: [] }];
    mounted = mount(<PrivateFinancingBorrowerMessages conversations={conversations} onChanged={onChanged} />);
    mounted.container.querySelector('textarea[name="body"]').value = "You should offer autopay.";
    const suggestionButton = [...mounted.container.querySelectorAll("button")].find((b) => b.textContent === "Suggestion");
    act(() => suggestionButton.click());
    await act(async () => mounted.container.querySelector("form").requestSubmit());
    expect(fetch).toHaveBeenCalledWith("/api/private-financing/portal", expect.objectContaining({
      body: JSON.stringify({ operation: "send-message", body: "You should offer autopay.", category: "suggestion", ownerId: "owner-1" }),
    }));
    expect(onChanged).toHaveBeenCalled();
  });

  it("renders one thread per conversation when the borrower has more than one owner relationship", () => {
    const conversations = [
      { ownerId: "owner-1", borrowerId: "brw-a", hasUnread: false, messages: [{ id: "m1", senderType: "borrower", body: "Hello owner A", category: null, createdAt: "2026-09-18T11:00:00Z" }] },
      { ownerId: "owner-2", borrowerId: "brw-b", hasUnread: false, messages: [{ id: "m2", senderType: "borrower", body: "Hello owner B", category: null, createdAt: "2026-09-18T11:00:00Z" }] },
    ];
    mounted = mount(<PrivateFinancingBorrowerMessages conversations={conversations} onChanged={vi.fn()} />);
    expect(mounted.container.textContent).toContain("Hello owner A");
    expect(mounted.container.textContent).toContain("Hello owner B");
    expect(mounted.container.querySelectorAll("form")).toHaveLength(2);
  });
});
