// @vitest-environment jsdom

// MobileDrawer: the phone-layout slide-over that hosts a docked panel below md.
// Contract:
// - renders nothing when closed
// - open: dialog role + aria-modal + label, children present, md:hidden wrapper
// - backdrop click, close button, and Escape all call onClose

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach } from "vitest";
import { MobileDrawer, toggleExclusiveDrawer, dropFileForPanel } from "./DesignerScreen";

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
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(rendered.onClose).toHaveBeenCalledTimes(1);
  });

  it("does not listen for Escape while closed", () => {
    rendered = renderDrawer({ open: false });
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(rendered.onClose).not.toHaveBeenCalled();
  });
});

describe("MobileDrawer focus management", () => {
  let container;
  let root;

  const renderFocusableDrawer = (open) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onClose = vi.fn();
    act(() => {
      root.render(
        <MobileDrawer open={open} onClose={onClose} label="Design panels">
          <button type="button">First action</button>
          <button type="button">Last action</button>
        </MobileDrawer>
      );
    });
    return { onClose };
  };

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("moves focus inside the dialog on open", () => {
    renderFocusableDrawer(true);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("wraps Tab from the last focusable element back to the first", () => {
    renderFocusableDrawer(true);
    const buttons = container.querySelectorAll('[role="dialog"] button');
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    act(() => {
      last.focus();
    });
    expect(document.activeElement).toBe(last);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement).toBe(first);
  });

  it("wraps Shift+Tab from the first focusable element to the last", () => {
    renderFocusableDrawer(true);
    const buttons = container.querySelectorAll('[role="dialog"] button');
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    act(() => {
      first.focus();
    });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })
      );
    });
    expect(document.activeElement).toBe(last);
  });

  it("restores focus to the trigger on close", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onClose = vi.fn();
    act(() => {
      root.render(
        <MobileDrawer open={true} onClose={onClose} label="Design panels">
          <p>body</p>
        </MobileDrawer>
      );
    });
    expect(document.activeElement).not.toBe(trigger);
    act(() => {
      root.render(
        <MobileDrawer open={false} onClose={onClose} label="Design panels">
          <p>body</p>
        </MobileDrawer>
      );
    });
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("renders the tools drawer anchored left", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <MobileDrawer open={true} onClose={vi.fn()} label="All tools" side="left">
          <p>body</p>
        </MobileDrawer>
      );
    });
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog.className).toContain("left-0");
    expect(dialog.className).not.toContain("right-0");
  });
});

describe("toggleExclusiveDrawer", () => {
  it("opens a drawer when none is open", () => {
    expect(toggleExclusiveDrawer(null, "panel")).toBe("panel");
    expect(toggleExclusiveDrawer(null, "tools")).toBe("tools");
  });

  it("toggling the open drawer closes it", () => {
    expect(toggleExclusiveDrawer("panel", "panel")).toBeNull();
    expect(toggleExclusiveDrawer("tools", "tools")).toBeNull();
  });

  it("opening one drawer closes the other (never two at once)", () => {
    expect(toggleExclusiveDrawer("panel", "tools")).toBe("tools");
    expect(toggleExclusiveDrawer("tools", "panel")).toBe("panel");
  });
});

describe("dropFileForPanel", () => {
  // RightPanel (and the import sections inside it) is mounted TWICE at
  // once whenever the mobile drawer is open: the desktop aside stays
  // mounted (just CSS-hidden), and the drawer mounts its own second copy.
  // A canvas file drop must reach exactly one of the two — ChatGPT review
  // of PR #499 found that passing the same pendingDropFile to both caused
  // the same dropped file to be parsed twice, by two independent staged
  // import states.
  const file = { name: "plan.pdf" };

  it("gives the aside the file and the drawer nothing when the drawer is closed", () => {
    expect(dropFileForPanel(file, null, "aside")).toBe(file);
    expect(dropFileForPanel(file, "tools", "aside")).toBe(file); // the OTHER drawer, not "panel"
    expect(dropFileForPanel(file, null, "drawer")).toBeNull();
    expect(dropFileForPanel(file, "tools", "drawer")).toBeNull();
  });

  it("gives the drawer the file and the aside nothing when the design-panels drawer is open", () => {
    expect(dropFileForPanel(file, "panel", "drawer")).toBe(file);
    expect(dropFileForPanel(file, "panel", "aside")).toBeNull();
  });

  it("never gives both panels a non-null file for the same inputs, for every drawer state", () => {
    for (const mobileDrawer of [null, "panel", "tools"]) {
      const aside = dropFileForPanel(file, mobileDrawer, "aside");
      const drawer = dropFileForPanel(file, mobileDrawer, "drawer");
      expect(aside === null || drawer === null).toBe(true);
      // And since pendingDropFile is actually set here, exactly one (not
      // neither) must receive it — the drop still has to go somewhere.
      expect(aside === file || drawer === file).toBe(true);
    }
  });

  it("passes through null/undefined pendingDropFile unchanged (nothing to route)", () => {
    expect(dropFileForPanel(null, "panel", "aside")).toBeNull();
    expect(dropFileForPanel(null, "panel", "drawer")).toBeNull();
    expect(dropFileForPanel(undefined, null, "aside")).toBeUndefined();
  });
});
