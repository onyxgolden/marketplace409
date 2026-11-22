// @vitest-environment jsdom

// DesignerScreen view-switch buttons during a 3D switch (PR #850 fix round 1,
// verdict P2, read firsthand).
//
// Integrated contract: while the 3D pane is un-hiding and has not yet
// rendered a frame, only the ACTIVE view's button is disabled — a repeat
// click on the load trigger is ignored. The 2D button stays enabled as an
// explicit escape: the user is never trapped in the loading view, so the
// "switch straight back to 2D while loading clears the overlay" behaviour
// is reachable in the assembled screen, not just in DesignerCanvasArea
// isolation. Clicking that 2D escape clears the overlay and re-enables
// every button.
//
// Renders the real DesignerScreen (same harness as the sidebar-width race
// test: fetch stubbed to an empty project). The 3D viewport itself is
// stubbed — it needs a real WebGL context, unavailable in jsdom — and the
// stub never calls onFirstFrameRendered, so the switching state stays up
// until the test takes the 2D escape.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import DesignerScreen from "./DesignerScreen";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./DesignerViewport3D", () => ({
  default: function StubViewport3D() {
    return <div data-testid="viewport-3d-stub">3D stub</div>;
  },
}));

// next/dynamic normally defers + shows a loading state before resolving;
// mocked here to resolve synchronously so this test is about the screen's
// own logic, not Next's lazy-loading timing.
vi.mock("next/dynamic", () => ({
  default: (loader) => {
    let Resolved = null;
    loader().then((mod) => {
      Resolved = mod.default || mod;
    });
    return function DynamicPassthrough(props) {
      if (!Resolved) return null;
      return <Resolved {...props} />;
    };
  },
}));

// PlanCanvas uses a ResizeObserver for its wrapper size; jsdom has none.
if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const PROJECT_ID = "view-switch-escape-test";

function viewButton(container, label) {
  const button = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent.startsWith(label)
  );
  if (!button) throw new Error(`no view button starting with ${label}`);
  return button;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("DesignerScreen view-switch buttons while loading 3D", () => {
  let container;
  let root;

  beforeEach(() => {
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    // The screen loads the project over fetch on mount; a null design opens
    // an empty project (ensureHomeProject leniency).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ project: { name: "Test", design: null } }),
      }))
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderScreen() {
    await act(async () => {
      root.render(<DesignerScreen projectId={PROJECT_ID} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
  }

  async function click(button) {
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
  }

  it("all three view buttons are enabled before any switch", async () => {
    await renderScreen();
    expect(viewButton(container, "2D Plan").disabled).toBe(false);
    expect(viewButton(container, "Split").disabled).toBe(false);
    expect(viewButton(container, "3D View").disabled).toBe(false);
  });

  it("clicking 3D disables only the 3D button; 2D and Split stay enabled", async () => {
    await renderScreen();
    await click(viewButton(container, "3D View"));

    // The overlay is up: the switch is in flight.
    expect(container.querySelector('[data-testid="viewport-3d-loading-overlay"]')).not.toBeNull();
    // Repeat trigger ignored…
    expect(viewButton(container, "3D View").disabled).toBe(true);
    // …but the user is not trapped: 2D escape and Split stay clickable.
    expect(viewButton(container, "2D Plan").disabled).toBe(false);
    expect(viewButton(container, "Split").disabled).toBe(false);
  });

  it("clicking the disabled 3D button again changes nothing", async () => {
    await renderScreen();
    await click(viewButton(container, "3D View"));
    expect(viewButton(container, "3D View").disabled).toBe(true);
    await click(viewButton(container, "3D View"));
    // Still switching, still on 3D, overlay still up — no second switch fired.
    expect(container.querySelector('[data-testid="viewport-3d-loading-overlay"]')).not.toBeNull();
    expect(viewButton(container, "3D View").disabled).toBe(true);
    expect(viewButton(container, "2D Plan").disabled).toBe(false);
  });

  it("the 2D escape while loading clears the overlay and re-enables every button", async () => {
    await renderScreen();
    await click(viewButton(container, "3D View"));
    expect(container.querySelector('[data-testid="viewport-3d-loading-overlay"]')).not.toBeNull();

    await click(viewButton(container, "2D Plan"));

    expect(container.querySelector('[data-testid="viewport-3d-loading-overlay"]')).toBeNull();
    expect(viewButton(container, "2D Plan").disabled).toBe(false);
    expect(viewButton(container, "Split").disabled).toBe(false);
    expect(viewButton(container, "3D View").disabled).toBe(false);
  });
});
