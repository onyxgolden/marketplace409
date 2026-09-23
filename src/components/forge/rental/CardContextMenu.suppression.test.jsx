// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useCardContextMenu, CardContextMenu, CARD_REGION_ATTRIBUTE } from "./CardContextMenu";

const ITEMS = [
  { label: "View Ledger", onSelect: () => {} },
  { label: "Post Income", onSelect: () => {} },
  { label: "Post Charge", onSelect: () => {} },
  { label: "Print Statement", onSelect: () => {} },
];

function Harness() {
  const { menu, onContextMenu, openAt, close } = useCardContextMenu();
  return (
    <div {...{ [CARD_REGION_ATTRIBUTE]: "" }} data-testid="card"
      onContextMenu={(event) => onContextMenu(event, ITEMS)}>
      <span data-testid="surface">card surface</span>
      <input data-testid="field" defaultValue="editable" />
      <button type="button" data-testid="dots" aria-label="More actions"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          openAt(rect.left, rect.bottom + 6, ITEMS);
        }}>⋮</button>
      <CardContextMenu menu={menu} onClose={close} />
    </div>
  );
}

function rightClick(target, x = 50, y = 60) {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y });
  // React batches the menu-open state update — flush it inside act.
  act(() => target.dispatchEvent(event));
  return event;
}

describe("useCardContextMenu native-menu suppression", () => {
  let container;
  let root;

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
    return container;
  }

  it("preventDefaults the native contextmenu event so the browser menu never appears on the card", () => {
    mount();
    const surface = container.querySelector('[data-testid="surface"]');
    const event = rightClick(surface);
    expect(event.defaultPrevented).toBe(true);
    // The custom menu opens instead, with all four tenant actions.
    const menu = container.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    for (const label of ["View Ledger", "Post Income", "Post Charge", "Print Statement"]) {
      expect(menu.textContent).toContain(label);
    }
  });

  it("keeps the native menu available inside real form fields", () => {
    mount();
    const field = container.querySelector('[data-testid="field"]');
    const event = rightClick(field);
    expect(event.defaultPrevented).toBe(false);
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it("opens the same menu from the ⋮ button for touch users", () => {
    mount();
    const dots = container.querySelector('[data-testid="dots"]');
    act(() => dots.click());
    const menu = container.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(menu.textContent).toContain("View Ledger");
    expect(menu.textContent).toContain("Post Income");
  });

  it("closes the menu on Escape", () => {
    mount();
    rightClick(container.querySelector('[data-testid="surface"]'));
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });
});
