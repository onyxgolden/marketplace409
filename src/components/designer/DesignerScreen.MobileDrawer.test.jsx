// @vitest-environment jsdom

// MobileDrawer: the phone-layout slide-over that hosts a docked panel below md.
// Contract:
// - renders nothing when closed
// - open: dialog role + aria-modal + label, children present, md:hidden wrapper
// - backdrop click, close button, and Escape all call onClose

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach } from "vitest";
import { MobileDrawer } from "./DesignerScreen";

function renderDrawer(props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onClose = vi.fn();
  act(() => {
    root.render(
      <MobileDrawer open={false} onClose={onClose} label="Design panels" {...props}>
        <p>panel body</p>
      </MobileDrawer>
    );
  });
  const rerender = (nextProps) => {
    act(() => {
      root.render(
        <MobileDrawer open={false} onClose={onClose} label="Design panels" {...nextProps}>
          <p>panel body</p>
        </MobileDrawer>
      );
    });
  };
  return { container, root, onClose, rerender };
}

describe("MobileDrawer", () => {
  let rendered;
  afterEach(() => {
    act(() => rendered.root.unmount());
    rendered.container.remove();
  });

  it("renders nothing when closed", () => {
    rendered = renderDrawer({ open: false });
    expect(rendered.container.querySelector('[role="dialog"]')).toBeNull();
    expect(rendered.container.textContent).not.toContain("panel body");
  });

  it("opens as a modal dialog below md with its children", () => {
    rendered = renderDrawer({ open: true });
    const dialog = rendered.container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Design panels");
    expect(dialog.textContent).toContain("panel body");
    // The drawer only exists below md; md+ uses the docked panel instead.
    expect(dialog.closest("div.fixed").className).toContain("md:hidden");
  });

  it("backdrop click closes the drawer", () => {
    rendered = renderDrawer({ open: true });
    const backdrop = rendered.container.querySelector('[data-testid="mobile-drawer-backdrop"]');
    expect(backdrop).not.toBeNull();
    act(() => {
      backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(rendered.onClose).toHaveBeenCalledTimes(1);
  });

  it("close button closes the drawer", () => {
    rendered = renderDrawer({ open: true });
    const closeButton = rendered.container.querySelector('button[aria-label="Close Design panels"]');
    expect(closeButton).not.toBeNull();
    act(() => {
      closeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(rendered.onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape closes the drawer", () => {
    rendered = renderDrawer({ open: true });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(rendered.onClose).toHaveBeenCalledTimes(1);
  });

  it("does not listen for Escape while closed", () => {
    rendered = renderDrawer({ open: false });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(rendered.onClose).not.toHaveBeenCalled();
  });
});
