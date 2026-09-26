// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import DashboardCardStack from "../DashboardCardStack.jsx";

const CARD_IDS = ["alpha", "beta", "gamma"];
const STORAGE_KEY = "test-dashboard-card-stack";

function testCards() {
  return CARD_IDS.map((id) => ({
    id,
    title: `Card ${id}`,
    element: <div data-card-content={id}>{`content-${id}`}</div>,
  }));
}

function renderStack() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <DashboardCardStack
        storageKey={STORAGE_KEY}
        cardIds={CARD_IDS}
        cards={testCards()}
        className="test-stack"
      />,
    );
  });
  return { container, root };
}

function renderStackWithKey(storageKey) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <DashboardCardStack
        storageKey={storageKey}
        cardIds={CARD_IDS}
        cards={testCards()}
        className="test-stack"
      />,
    );
  });
  return { container, root };
}

function renderedOrder(container) {
  return [...container.querySelectorAll("[data-dashboard-card]")].map((node) =>
    node.getAttribute("data-dashboard-card"),
  );
}

function clickByLabel(container, label) {
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.getAttribute("aria-label") === label,
  );
  if (!button) throw new Error(`button not found: ${label}`);
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function clickByText(container, text) {
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent.trim() === text,
  );
  if (!button) throw new Error(`button not found: ${text}`);
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function storedLayout() {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY));
}

let mounted = null;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  if (mounted) {
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
    mounted = null;
  }
  window.localStorage.clear();
});

describe("DashboardCardStack", () => {
  it("renders cards in the default registry order", () => {
    mounted = renderStack();
    expect(renderedOrder(mounted.container)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("reorder changes the render order and persists it", () => {
    mounted = renderStack();
    clickByText(mounted.container, "Customize cards");
    // Move "beta" above "alpha".
    clickByLabel(mounted.container, "Move Card beta up");

    expect(renderedOrder(mounted.container)).toEqual(["beta", "alpha", "gamma"]);
    expect(storedLayout().order).toEqual(["beta", "alpha", "gamma"]);

    // A fresh mount restores the persisted order.
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
    mounted = renderStack();
    expect(renderedOrder(mounted.container)).toEqual(["beta", "alpha", "gamma"]);
  });

  it("hide removes a card and persists the hidden set", () => {
    mounted = renderStack();
    clickByText(mounted.container, "Customize cards");
    clickByLabel(mounted.container, "Hide Card beta");

    expect(renderedOrder(mounted.container)).toEqual(["alpha", "gamma"]);
    expect(storedLayout().hidden).toEqual(["beta"]);

    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
    mounted = renderStack();
    expect(renderedOrder(mounted.container)).toEqual(["alpha", "gamma"]);
    // The hidden card is recoverable from the customize bar, and returns
    // to its original slot (hidden cards keep their place in the order).
    clickByText(mounted.container, "Customize cards");
    clickByLabel(mounted.container, "Show Card beta");
    expect(renderedOrder(mounted.container)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("reset restores the default order and unhides every card", () => {
    mounted = renderStack();
    clickByText(mounted.container, "Customize cards");
    clickByLabel(mounted.container, "Move Card gamma up");
    clickByLabel(mounted.container, "Hide Card alpha");
    expect(renderedOrder(mounted.container)).toEqual(["gamma", "beta"]);

    clickByText(mounted.container, "Reset to defaults");
    expect(renderedOrder(mounted.container)).toEqual(["alpha", "beta", "gamma"]);
    expect(storedLayout()).toEqual({ order: ["alpha", "beta", "gamma"], hidden: [] });
  });

  it("shows an empty state with recovery when every card is hidden", () => {
    mounted = renderStack();
    clickByText(mounted.container, "Customize cards");
    clickByLabel(mounted.container, "Hide Card alpha");
    clickByLabel(mounted.container, "Hide Card beta");
    clickByLabel(mounted.container, "Hide Card gamma");

    expect(renderedOrder(mounted.container)).toEqual([]);
    expect(
      mounted.container.querySelector("[data-dashboard-cards-empty]"),
    ).not.toBeNull();

    clickByText(mounted.container, "Show all cards");
    expect(renderedOrder(mounted.container)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("recovers gracefully from a corrupt stored payload", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not-json");
    mounted = renderStack();
    expect(renderedOrder(mounted.container)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("does not persist mutations made while on the shared pre-identity key", () => {
    const sharedKey = "forge.financial.dashboard.layout.v1.shared";
    mounted = renderStackWithKey(sharedKey);
    clickByText(mounted.container, "Customize cards");
    clickByLabel(mounted.container, "Hide Card beta");

    // The UI still responds in memory ...
    expect(renderedOrder(mounted.container)).toEqual(["alpha", "gamma"]);
    // ... but nothing is written to the shared fallback key, so one session
    // can't mutate the layout another session falls back to.
    expect(window.localStorage.getItem(sharedKey)).toBeNull();
  });
});
