// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import WorkPackageNotFound from "./not-found.jsx";

// D8(b): a nonexistent/unauthorized package id used to silently redirect
// to /forge/work with no explanation. This renders instead (via notFound()
// in page.jsx), inside the Planner's own layout, so a plain-words message
// and a way back are always present.
describe("WorkPackageNotFound", () => {
  let mounted;
  afterEach(() => {
    if (mounted) {
      act(() => { mounted.root.unmount(); });
      mounted.container.remove();
      mounted = null;
    }
  });

  it("explains the package could not be found and links back to the planner", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(<WorkPackageNotFound />); });
    mounted = { container, root };

    expect(container.textContent).toContain("Package not found");
    const link = container.querySelector("a");
    expect(link.getAttribute("href")).toBe("/forge/work");
    expect(link.textContent).toContain("Back to Work Packages");
  });
});
