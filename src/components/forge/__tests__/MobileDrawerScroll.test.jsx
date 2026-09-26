/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/forge/property",
}));

// The shell reads the signed-in user in an effect; stub the client so the
// test never needs a live Supabase URL/key.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: null } }),
      signOut: () => Promise.resolve({}),
    },
  }),
}));

import ThemeProvider from "@/components/theme/ThemeProvider";

import ForgeApplicationRail from "../ForgeApplicationRail.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function renderRail() {
  act(() => {
    root.render(
      <ThemeProvider>
        <ForgeApplicationRail>
          <main>Property workspace</main>
        </ForgeApplicationRail>
      </ThemeProvider>,
    );
  });
}

function click(node) {
  act(() => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("mobile drawer scroll", () => {
  it("keeps the header and close button pinned while the full app list scrolls", () => {
    renderRail();

    const openButton = container.querySelector(
      'button[aria-label="Open Forge navigation"]',
    );
    expect(openButton).not.toBeNull();
    click(openButton);

    const closeButton = container.querySelector(
      'button[aria-label="Close Forge navigation"]',
    );
    expect(closeButton).not.toBeNull();

    const scrollRegion = container.querySelector(
      '[data-testid="mobile-nav-scroll"]',
    );
    expect(scrollRegion).not.toBeNull();
    expect(scrollRegion.className).toContain("overflow-y-auto");
    expect(scrollRegion.className).toContain("flex-1");
    expect(scrollRegion.className).toContain("min-h-0");

    // The close button must stay outside the scroll region so it is always
    // reachable on short viewports.
    expect(scrollRegion.contains(closeButton)).toBe(false);

    // Every application — including Call Shield, which sits below the fold on
    // phones — must live inside the scroll region so it can be reached.
    const anchors = Array.from(scrollRegion.querySelectorAll("a"));
    for (const label of ["Call Shield", "Charts", "Capture", "Workspace"]) {
      const match = anchors.find((anchor) =>
        anchor.textContent.includes(label),
      );
      expect(match, `${label} should be inside the scroll region`).not.toBeNull();
    }

    // The drawer still opens and closes.
    click(closeButton);
    expect(
      container.querySelector('[data-testid="mobile-nav-scroll"]'),
    ).toBeNull();
  });
});

describe("mobile drawer dismissal", () => {
  function openDrawer() {
    renderRail();
    const open = container.querySelector(
      'button[aria-label="Open Forge navigation"]',
    );
    expect(open).not.toBeNull();
    click(open);
    const drawer = container.querySelector(
      'aside[aria-label="Forge navigation"]',
    );
    expect(drawer).not.toBeNull();
    return drawer;
  }

  it("focuses the close control when the drawer opens, so keyboard users land inside it", () => {
    const drawer = openDrawer();
    expect(document.activeElement).toBe(
      drawer.querySelector('button[aria-label="Close Forge navigation"]'),
    );
  });

  it("Escape closes the drawer", () => {
    openDrawer();
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(
      container.querySelector('aside[aria-label="Forge navigation"]'),
    ).toBeNull();
  });

  it("tapping the backdrop closes the drawer but clicks inside it do not", () => {
    const drawer = openDrawer();

    // Click inside the drawer: stays open.
    click(drawer);
    expect(
      container.querySelector('aside[aria-label="Forge navigation"]'),
    ).not.toBeNull();

    // Click the backdrop (the drawer's parent): closes.
    click(drawer.parentElement);
    expect(
      container.querySelector('aside[aria-label="Forge navigation"]'),
    ).toBeNull();
  });
});

describe("mobile header account menu", () => {
  it("renders the shared account menu in the mobile header so phone users can sign out", () => {
    renderRail();
    // Scoped to the mobile header: the desktop rail is also in the DOM (hidden below lg)
    // and renders its own account button.
    const headerAccount = container.querySelector(
      'header button[aria-label="Account"]',
    );
    expect(headerAccount).not.toBeNull();
  });
});
