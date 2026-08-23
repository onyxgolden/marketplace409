// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import ForgeNeedsAttentionQueue from "./ForgeNeedsAttentionQueue.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}
function unmount({ container, root }) {
  act(() => { root.unmount(); });
  container.remove();
}

describe("ForgeNeedsAttentionQueue", () => {
  let mounted;
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } });

  it("shows a positive empty state and renders no items when the queue is empty", () => {
    mounted = mount(<ForgeNeedsAttentionQueue items={[]} onNavigate={() => {}} />);
    expect(mounted.container.querySelector("[data-needs-attention-queue]")).toBeNull();
    expect(mounted.container.textContent).toContain("Nothing needs your attention right now.");
  });

  it("renders items in the order given and navigates to an item's own destination on click", () => {
    let navigated = null;
    const items = [
      { id: "a", severity: "critical", label: "First", destination: "charges" },
      { id: "b", severity: "warning", label: "Second", destination: "maintenance" },
    ];
    mounted = mount(<ForgeNeedsAttentionQueue items={items} onNavigate={(id) => { navigated = id; }} />);
    const buttons = mounted.container.querySelectorAll("[data-attention-item]");
    expect(buttons.length).toBe(2);
    expect(buttons[0].getAttribute("data-attention-item")).toBe("a");
    act(() => { buttons[1].click(); });
    expect(navigated).toBe("maintenance");
  });
});
