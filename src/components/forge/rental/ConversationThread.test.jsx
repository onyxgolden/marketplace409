// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConversationThread from "./ConversationThread.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}
function unmount(mounted) { act(() => mounted.root.unmount()); mounted.container.remove(); }
async function flush() { await act(async () => { await Promise.resolve(); }); }

describe("ConversationThread", () => {
  let mounted;
  afterEach(() => { if (mounted) unmount(mounted); mounted = null; });

  it("shows an empty state with no messages", () => {
    mounted = mount(<ConversationThread messages={[]} selfSenderType="tenant" onSend={vi.fn()} />);
    expect(mounted.container.textContent).toContain("No messages yet.");
  });

  it("aligns the viewer's own messages differently from the other side's", () => {
    mounted = mount(<ConversationThread messages={[
      { id: "m1", senderType: "tenant", body: "The heater is not working.", category: "issue", createdAt: "2026-09-18T11:00:00Z" },
      { id: "m2", senderType: "owner", body: "Sending someone tomorrow.", category: null, createdAt: "2026-09-18T12:00:00Z" },
    ]} selfSenderType="tenant" onSend={vi.fn()} />);
    const bubbles = [...mounted.container.querySelectorAll(".max-w-\\[80\\%\\]")];
    expect(bubbles[0].parentElement.className).toContain("justify-end");
    expect(bubbles[1].parentElement.className).toContain("justify-start");
    expect(mounted.container.textContent).toContain("Issue");
  });

  it("submits the typed draft and clears the box, without sending a category when none is offered", async () => {
    const onSend = vi.fn().mockResolvedValue();
    mounted = mount(<ConversationThread messages={[]} selfSenderType="tenant" onSend={onSend} />);
    mounted.container.querySelector('textarea[name="body"]').value = "Thanks for the fix!";
    await act(async () => mounted.container.querySelector("form").requestSubmit());
    expect(onSend).toHaveBeenCalledWith("Thanks for the fix!", null);
    expect(mounted.container.querySelector('textarea[name="body"]').value).toBe("");
  });

  it("lets the sender pick issue/suggestion when allowCategory is set, and toggling off clears it", async () => {
    const onSend = vi.fn().mockResolvedValue();
    mounted = mount(<ConversationThread messages={[]} selfSenderType="tenant" onSend={onSend} allowCategory />);
    mounted.container.querySelector('textarea[name="body"]').value = "You should add a dog park.";
    const issueButton = [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Suggestion");
    act(() => issueButton.click());
    await act(async () => mounted.container.querySelector("form").requestSubmit());
    expect(onSend).toHaveBeenCalledWith("You should add a dog park.", "suggestion");
  });

  it("does not offer category selection when allowCategory is false", () => {
    mounted = mount(<ConversationThread messages={[]} selfSenderType="owner" onSend={vi.fn()} />);
    expect(mounted.container.textContent).not.toContain("Suggestion");
  });

  it("disables the send button while busy", async () => {
    mounted = mount(<ConversationThread messages={[]} selfSenderType="tenant" onSend={vi.fn()} busy />);
    const button = [...mounted.container.querySelectorAll("button")].find((b) => b.textContent === "Sending…");
    expect(button.disabled).toBe(true);
  });

  it("shows an error message when given one", () => {
    mounted = mount(<ConversationThread messages={[]} selfSenderType="tenant" onSend={vi.fn()} error="Unable to send this message." />);
    expect(mounted.container.textContent).toContain("Unable to send this message.");
  });
});
