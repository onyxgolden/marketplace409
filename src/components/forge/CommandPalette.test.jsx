// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import CommandPaletteHost, { CommandPaletteTrigger } from "./CommandPalette.jsx";
import { registerCommandPaletteAction, unregisterCommandPaletteAction } from "@/lib/commandPalette/registry";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mounted = null;

// Note: the open palette renders into a document.body portal (same as the
// Designer's dialogs), so dialog parts are queried on `document`, not on the
// React container. The trigger button itself renders in place.
function mountHost(extra = null) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <>
        <CommandPaletteHost />
        {extra}
      </>,
    );
  });
  mounted = { container, root };
  return container;
}

function dialog() {
  return document.querySelector('[role="dialog"]');
}

function pressKey(target, key, init = {}) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });
}

function openWithShortcut() {
  pressKey(window, "k", { ctrlKey: true });
}

function getInput() {
  return document.querySelector('[data-testid="command-palette-input"]');
}

function getOptions() {
  return [...document.querySelectorAll('[role="option"]')];
}

function typeQuery(value) {
  const input = getInput();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  push.mockClear();
});

afterEach(() => {
  if (mounted) {
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
    mounted = null;
  }
  document.body.style.overflow = "";
});

describe("CommandPaletteHost", () => {
  it("renders nothing until opened", () => {
    mountHost();
    expect(dialog()).toBeNull();
  });

  it("opens on Ctrl+K and focuses the search field", () => {
    mountHost();
    openWithShortcut();
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(getInput());
  });

  it("opens on Cmd+K (Mac) and toggles closed on a second press", () => {
    mountHost();
    pressKey(window, "k", { metaKey: true });
    expect(dialog()).not.toBeNull();
    pressKey(window, "k", { metaKey: true });
    expect(dialog()).toBeNull();
  });

  it("does not steal Ctrl/Cmd+K from text inputs and textareas", () => {
    const container = mountHost();
    const probe = document.createElement("input");
    probe.type = "text";
    container.appendChild(probe);
    probe.focus();
    pressKey(probe, "k", { ctrlKey: true });
    expect(dialog()).toBeNull();

    const area = document.createElement("textarea");
    container.appendChild(area);
    area.focus();
    pressKey(area, "k", { metaKey: true });
    expect(dialog()).toBeNull();
  });

  it("Cmd+K still toggles the palette closed from its own search input", () => {
    mountHost();
    openWithShortcut();
    expect(dialog()).not.toBeNull();
    const input = getInput();
    expect(input.tagName).toBe("INPUT");
    // The palette owns the keyboard while open: the editable-target guard
    // must not block the toggle-close from the palette's own search field.
    pressKey(input, "k", { metaKey: true });
    expect(dialog()).toBeNull();
  });

  it("groups actions and navigation with headers", () => {
    mountHost();
    openWithShortcut();
    const text = dialog().textContent;
    expect(text).toContain("Actions");
    expect(text).toContain("Go to");
  });

  it("fuzzy filtering narrows the list to the matching action", () => {
    mountHost();
    openWithShortcut();
    typeQuery("rent roll");
    const options = getOptions();
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("Run rent roll report");
  });

  it("shows an empty state when nothing matches", () => {
    mountHost();
    openWithShortcut();
    typeQuery("zzz-no-such-command");
    expect(getOptions()).toHaveLength(0);
    expect(dialog().textContent).toContain("No commands match");
  });

  it("arrow keys move the highlight and Enter activates the right route", () => {
    mountHost();
    openWithShortcut();
    // Blank query: first option is "Record rent payment"; arrow down once
    // highlights "Add expense", whose href is /forge/rental?section=reports.
    pressKey(getInput(), "ArrowDown");
    const options = getOptions();
    expect(options[1].getAttribute("data-active")).toBe("true");
    expect(options[0].getAttribute("data-active")).toBe("false");
    pressKey(getInput(), "Enter");
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/forge/rental?section=reports");
    // Activating closes the palette.
    expect(dialog()).toBeNull();
  });

  it("arrow up wraps from the first row to the last", () => {
    mountHost();
    openWithShortcut();
    pressKey(getInput(), "ArrowUp");
    const options = getOptions();
    expect(options[options.length - 1].getAttribute("data-active")).toBe("true");
  });

  it("Escape closes the palette", () => {
    mountHost();
    openWithShortcut();
    expect(dialog()).not.toBeNull();
    pressKey(getInput(), "Escape");
    expect(dialog()).toBeNull();
  });

  it("clicking the backdrop closes the palette", () => {
    mountHost();
    openWithShortcut();
    const backdrop = document.querySelector('[data-testid="command-palette-backdrop"]');
    act(() => {
      backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dialog()).toBeNull();
  });

  it("clicking an option activates it (mouse fallback)", () => {
    mountHost();
    openWithShortcut();
    typeQuery("cash forecast");
    const options = getOptions();
    expect(options).toHaveLength(1);
    act(() => {
      options[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(push).toHaveBeenCalledWith("/forge/financial");
  });

  it("the visible trigger button opens the palette for touch/mouse users", () => {
    const container = mountHost(<CommandPaletteTrigger />);
    const trigger = container.querySelector('button[aria-label^="Open command palette"]');
    expect(trigger).not.toBeNull();
    act(() => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dialog()).not.toBeNull();
  });

  it("runs a registered run() handler instead of navigating", () => {
    const ran = vi.fn();
    registerCommandPaletteAction({ id: "test-zebra-action", title: "Zebra custom action", group: "Actions", run: ran });
    try {
      mountHost();
      openWithShortcut();
      typeQuery("zebra");
      const options = getOptions();
      expect(options).toHaveLength(1);
      pressKey(getInput(), "Enter");
      expect(ran).toHaveBeenCalledTimes(1);
      expect(push).not.toHaveBeenCalled();
    } finally {
      unregisterCommandPaletteAction("test-zebra-action");
    }
  });

  it("exposes the seeded core actions with real routes", () => {
    mountHost();
    openWithShortcut();
    const byTestId = (id) => document.querySelector(`[data-testid="command-palette-option-${id}"]`);
    expect(byTestId("record-rent-payment")).not.toBeNull();
    expect(byTestId("add-expense")).not.toBeNull();
    expect(byTestId("run-rent-roll")).not.toBeNull();
    expect(byTestId("open-tenant-ledger")).not.toBeNull();
    expect(byTestId("add-property")).not.toBeNull();
    expect(byTestId("open-cash-forecast")).not.toBeNull();
  });
});
