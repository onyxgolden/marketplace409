// @vitest-environment jsdom
//
// ProjectsList responsive form (Phone Slice 5 follow-up, §B): below `sm`
// the subtitle wraps naturally and the input/New design form stacks with
// min-w-0 + w-full, so nothing clips past the right edge at 360px. At
// sm+ the existing horizontal row/desktop layout is preserved.
//
// jsdom has no layout engine, so this test asserts the responsive
// structure and the preserved semantics (label, Enter submit, creation
// API call, list rendering); the Playwright geometry check measures the
// real rects in Chromium (subtitle fully visible, button inside the
// viewport, no page overflow) at 360/390/412/430/768/1919.
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import ProjectsList from "./ProjectsList";

const PROJECTS = [
  { id: "design_1", name: "Kitchen remodel", updatedAt: "2026-11-16T12:00:00Z" },
  { id: "design_2", name: "Garage apartment", updatedAt: "2026-11-15T09:30:00Z" },
];

function mockFetch() {
  const calls = [];
  global.fetch = vi.fn(async (url, opts) => {
    calls.push({ url, opts });
    if (!opts || opts.method === undefined || opts.method === "GET") {
      return { ok: true, json: async () => ({ projects: PROJECTS }) };
    }
    return { ok: true, json: async () => ({ id: "design_new" }) };
  });
  return calls;
}

describe("ProjectsList phone form", () => {
  let container;
  let root;

  const renderList = async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<ProjectsList />);
    });
    // let the list fetch resolve
    await act(async () => {});
  };

  afterEach(() => {
    if (root) root.unmount();
    if (container) container.remove();
    vi.restoreAllMocks();
  });

  it("wraps the subtitle and stacks the form below sm", async () => {
    mockFetch();
    await renderList();
    const subtitle = [...container.querySelectorAll("p")].find((p) =>
      (p.textContent || "").includes("Floor plans for remodels"),
    );
    expect(subtitle).toBeTruthy();
    expect(subtitle.textContent).toBe("Floor plans for remodels and new layouts — 2D plans with a 3D view.");
    expect(subtitle.className).toContain("break-words");
    expect(subtitle.className).toContain("whitespace-normal");
    expect(subtitle.className).toContain("min-w-0");
    const rootDiv = container.firstElementChild;
    expect(rootDiv.className).toContain("w-full");
    expect(rootDiv.className).toContain("min-w-0");
    const input = container.querySelector('input[aria-label="New design name"]');
    expect(input).toBeTruthy();
    expect(input.className).toContain("min-w-0");
    expect(input.className).toContain("w-full");
    expect(input.className).toContain("sm:flex-1");
    const form = input.closest("div");
    expect(form.className).toContain("flex-col");
    expect(form.className).toContain("sm:flex-row");
    expect(form.className).toContain("min-w-0");
    const button = [...container.querySelectorAll("button")].find((b) =>
      (b.textContent || "").trim().startsWith("New design"),
    );
    expect(button).toBeTruthy();
    expect(button.textContent.trim()).toBe("New design");
    expect(button.disabled).toBe(false);
    expect(button.className).toContain("w-full");
    expect(button.className).toContain("sm:w-auto");
    expect(button.className).toContain("justify-center");
  });

  it("renders the project list from the API", async () => {
    mockFetch();
    await renderList();
    expect(container.textContent).toContain("Kitchen remodel");
    expect(container.textContent).toContain("Garage apartment");
  });

  it("submits the Enter path with the typed name", async () => {
    const calls = mockFetch();
    await renderList();
    const input = container.querySelector('input[aria-label="New design name"]');
    // Set the value the way React observes it (native setter + input
    // event), let the state update flush, then press Enter in a
    // separate act — a keydown in the same batch still sees the old
    // (empty) state.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "Test sunroom");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    const post = calls.find((c) => c.opts && c.opts.method === "POST");
    expect(post).toBeTruthy();
    expect(JSON.parse(post.opts.body).name).toBe("Test sunroom");
  });
});
