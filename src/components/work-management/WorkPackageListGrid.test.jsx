// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

import WorkPackageListGrid, { BLANK_ROWS } from "./WorkPackageListGrid.jsx";

const PROPERTIES = [
  { slug: "4800-kent-ave", label: "4800 Kent Ave" },
  { slug: "1900-w-decker", label: "1900 W. Decker" },
];

const PKG = {
  id: "wp_1", code: "WP-0001", title: "Decker turnover", package_type: "rental_turn",
  priority: "normal", status: "draft", planned_start: "2026-10-05", planned_finish: "2026-10-20",
  percent_complete: 0, unit: "A", area: "Kitchen", system: "Plumbing",
  property_id: "1900-w-decker", planned_cost_cents: 150000,
  responsible_party: { domain: "contractor", type: "contractor", display_name: "Crew Alpha" },
  updated_at: "2026-10-01T00:00:00Z",
};

function setupFetch(impl) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body });
    const result = await impl({ url, method: options.method || "GET", body: options.body });
    return { ok: result.ok !== false, status: result.status || 200, json: async () => result.body || {} };
  }));
  return calls;
}

async function renderGrid(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<WorkPackageListGrid initialPackages={[PKG]} properties={PROPERTIES} {...props} />);
  });
  await act(async () => {});
  return { container, root };
}

function setInput(container, labelText, value) {
  const input = [...container.querySelectorAll("input, select")]
    .find((el) => el.getAttribute("aria-label") === labelText);
  if (!input) throw new Error(`no input for ${labelText}`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      input.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}

async function pressEnter(input) {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("WorkPackageListGrid", () => {
  it("renders the package row and ten blank add-rows", async () => {
    setupFetch(async () => ({ body: {} }));
    const { container } = await renderGrid();
    expect(container.textContent).toContain("WP-0001");
    expect(container.textContent).toContain("Decker turnover");
    expect(container.textContent).toContain("draft");
    expect(container.textContent).toContain("1900 W. Decker");
    expect(container.querySelectorAll('[aria-label^="Title for new package row"]')).toHaveLength(BLANK_ROWS);
    expect(BLANK_ROWS).toBe(10);
  });

  it("edits a title in place through the existing PATCH", async () => {
    const calls = setupFetch(async ({ url, method, body }) => {
      if (method === "PATCH") {
        const patch = JSON.parse(body);
        return { body: { package: { ...PKG, ...patch } } };
      }
      return { body: {} };
    });
    const { container } = await renderGrid();
    const cell = container.querySelector('[aria-label="Title for WP-0001"]');
    await act(async () => {
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    setInput(container, "Title for WP-0001", "Decker turnover (revised)");
    await pressEnter(container.querySelector('input[aria-label="Title for WP-0001"]'));
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch.url).toBe("/api/work-packages/wp_1");
    expect(JSON.parse(patch.body)).toEqual({ title: "Decker turnover (revised)" });
    await act(async () => {});
    expect(container.textContent).toContain("Decker turnover (revised)");
  });

  it("changes status through the transition route, not a hand-set PATCH", async () => {
    const calls = setupFetch(async ({ url, method, body }) => {
      if (method === "POST" && url.includes("/transition")) {
        return { body: { package: { ...PKG, status: JSON.parse(body).to } } };
      }
      return { body: {} };
    });
    const { container } = await renderGrid();
    const cell = container.querySelector('[aria-label="Status for WP-0001"]');
    await act(async () => {
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    setInput(container, "Status for WP-0001", "planned");
    const transition = calls.find((c) => c.url.includes("/transition"));
    expect(transition.method).toBe("POST");
    expect(JSON.parse(transition.body)).toEqual({ to: "planned" });
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("creates a package by typing in a blank row, with the server assigning its number", async () => {
    const calls = setupFetch(async ({ url, method, body }) => {
      if (method === "POST" && url === "/api/work-packages") {
        const created = JSON.parse(body);
        return { body: { package: { ...PKG, id: "wp_new", code: "WP-0007", title: created.title, status: "draft" } } };
      }
      return { body: {} };
    });
    const { container } = await renderGrid();
    const cell = container.querySelector('[aria-label="Title for new package row 1"]');
    await act(async () => {
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    setInput(container, "Title for new package row 1", "Kent kitchen");
    await pressEnter(container.querySelector('input[aria-label="Title for new package row 1"]'));
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/work-packages");
    expect(JSON.parse(post.body)).toMatchObject({ title: "Kent kitchen" });
    await act(async () => {});
    expect(container.textContent).toContain("WP-0007");
    expect(container.textContent).toContain("Package WP-0007 created.");
  });

  it("keeps a cancelled package's cells read-only", async () => {
    setupFetch(async () => ({ body: {} }));
    const cancelled = { ...PKG, id: "wp_2", code: "WP-0002", title: "Old job", status: "cancelled" };
    const { container } = await renderGrid({ initialPackages: [cancelled] });
    const cell = container.querySelector('[aria-label="Title for WP-0002"]');
    await act(async () => {
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(container.querySelector('input[aria-label="Title for WP-0002"]')).toBe(null);
  });

  it("shows an invalid value's message and reverts the cell", async () => {
    setupFetch(async () => ({ ok: false, status: 400, body: { error: "Title is required." } }));
    const { container } = await renderGrid();
    const cell = container.querySelector('[aria-label="Title for WP-0001"]');
    await act(async () => {
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    // The cell's own validation blocks an empty title before any fetch.
    setInput(container, "Title for WP-0001", "   ");
    await pressEnter(container.querySelector('input[aria-label="Title for WP-0001"]'));
    expect(container.textContent).toContain("Title is required.");
    expect(container.textContent).toContain("Decker turnover");
  });

  it("opens the import dialog from the grid", async () => {
    setupFetch(async () => ({ body: {} }));
    const { container } = await renderGrid();
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Import from file");
    await act(async () => { button.click(); });
    expect(container.textContent).toContain("Import packages from a file");
    expect(container.textContent).toContain("Download the CSV template");
  });
});
