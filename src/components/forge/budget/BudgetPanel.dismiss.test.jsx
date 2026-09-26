// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import BudgetPanel from "./BudgetPanel.jsx";

const DISMISS_KEY = "forge:budget:bootstrap-dismissed";

function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

function stubBudgetAPIs() {
  fetchMock.mockImplementation((url) => {
    const target = String(url);
    if (target.startsWith("/api/budgeting/plan")) return Promise.resolve(jsonResponse({ lines: [], summary: {} }));
    if (target.startsWith("/api/budgeting/suggestions")) return Promise.resolve(jsonResponse({ categories: [] }));
    if (target.startsWith("/api/financial/recurring")) return Promise.resolve(jsonResponse({ patterns: [] }));
    if (target.startsWith("/api/budgeting/bootstrap"))
      return Promise.resolve(jsonResponse({ success: true, scope: "personal", eventsAnalyzed: 0, bills: [], income: [] }));
    return Promise.resolve(jsonResponse({ error: "unexpected" }, false));
  });
}

let container;
let root;

async function renderPanel() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<BudgetPanel />);
    // Let the stale-while-revalidate fetches settle.
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  stubBudgetAPIs();
  window.localStorage.clear();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  window.localStorage.clear();
});

describe("BudgetPanel bootstrap dismissal", () => {
  it("shows the bootstrap confirm panel on first run", async () => {
    await renderPanel();
    expect(container.textContent).toContain("No transaction history to learn from yet.");
  });

  it("hydrates a persisted dismissal after mount and suppresses the bootstrap panel", async () => {
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify({ personal: true }));
    await renderPanel();
    expect(container.textContent).not.toContain("No transaction history to learn from yet.");
    expect(container.textContent).toContain("No budget categories yet.");
  });

  it("renders without crashing when storage reads fail (SSR-like environments)", async () => {
    const getItem = window.localStorage.getItem.bind(window.localStorage);
    window.localStorage.getItem = () => {
      throw new Error("storage unavailable");
    };
    let thrown = null;
    try {
      await renderPanel();
    } catch (error) {
      thrown = error;
    } finally {
      window.localStorage.getItem = getItem;
    }
    expect(thrown).toBeNull();
  });
});
