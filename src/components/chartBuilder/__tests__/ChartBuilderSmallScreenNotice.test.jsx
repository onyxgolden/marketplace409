// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import ChartBuilderSmallScreenNotice from "../ChartBuilderSmallScreenNotice.jsx";

let container;
let root;

function renderNotice(props = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<ChartBuilderSmallScreenNotice onDismiss={props.onDismiss ?? (() => {})} />);
  });
  return container;
}

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("ChartBuilderSmallScreenNotice", () => {
  it("explains the desktop-only trade-off honestly and stays hidden on desktop widths", () => {
    const container = renderNotice();
    const notice = container.querySelector('[data-testid="chart-builder-small-screen-notice"]');
    expect(notice).not.toBeNull();
    // md:hidden: only narrow viewports see it; desktop keeps the full editor chrome.
    expect(notice.className).toContain("md:hidden");
    expect(notice.getAttribute("role")).toBe("note");
    expect(notice.textContent).toContain("works best on a larger screen");
    expect(notice.textContent).toContain("precise pointer");
    // Reassurance + the way forward: saved work is safe, continue on desktop.
    expect(notice.textContent).toContain("Your saved charts are safe");
    expect(notice.textContent).toContain("continue on a desktop");
  });

  it("the dismiss action hands control back to the parent — no dead end, no nag", () => {
    const onDismiss = vi.fn();
    const container = renderNotice({ onDismiss });
    const button = [...container.querySelectorAll("button")].find((b) =>
      b.textContent.includes("Keep exploring on this device"),
    );
    expect(button).not.toBeUndefined();
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
