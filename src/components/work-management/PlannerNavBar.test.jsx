// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/forge/work";
let mockSearch = "";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import PlannerNavBar from "./PlannerNavBar.jsx";

function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PlannerNavBar />);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  mockPathname = "/forge/work";
  mockSearch = "";
});

describe("PlannerNavBar", () => {
  it("links to every main planner view from every planner view", () => {
    const { container } = render();
    const links = [...container.querySelectorAll("a")];
    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/forge/work");
    expect(hrefs).toContain("/forge/work/documents");
    expect(hrefs).toContain("/forge/work/admin");
    expect(hrefs).toContain("/forge/work/new");
  });

  it("marks the current view as the active link", () => {
    mockPathname = "/forge/work/admin";
    const { container } = render();
    const adminLink = [...container.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/forge/work/admin");
    expect(adminLink.getAttribute("aria-current")).toBe("page");
    const docsLink = [...container.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/forge/work/documents");
    expect(docsLink.getAttribute("aria-current")).toBeNull();
  });

  it("marks a package-detail view as under Work Packages, not the landing page itself", () => {
    mockPathname = "/forge/work/WP-0011";
    const { container } = render();
    const listLink = [...container.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/forge/work");
    // A package detail page is its own view, not the landing list -- it
    // should not falsely claim to already be on the list.
    expect(listLink.getAttribute("aria-current")).toBeNull();
  });

  it("carries the current ?workspace= selection onto every link so switching chrome never drops it", () => {
    mockSearch = "workspace=owner_42";
    const { container } = render();
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/forge/work?workspace=owner_42");
    expect(hrefs).toContain("/forge/work/documents?workspace=owner_42");
    expect(hrefs).toContain("/forge/work/admin?workspace=owner_42");
    expect(hrefs).toContain("/forge/work/new?workspace=owner_42");
  });

  it("omits the workspace query entirely when none is selected", () => {
    const { container } = render();
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    for (const href of hrefs) expect(href).not.toContain("workspace=");
  });
});
