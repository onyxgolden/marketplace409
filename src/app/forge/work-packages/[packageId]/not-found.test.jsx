// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import WorkPackagesSegmentNotFound from "./not-found.jsx";

// D8(a): /forge/work-packages/<id> (no suffix -- only .../takeoff is a real
// route) used to fall through to the generic, planner-unaware site-wide
// 404 with no link back. This scoped not-found renders instead (via the
// bare page.jsx calling notFound()), inside this subtree's own layout.
describe("WorkPackagesSegmentNotFound", () => {
  let mounted;
  afterEach(() => {
    if (mounted) {
      act(() => { mounted.root.unmount(); });
      mounted.container.remove();
      mounted = null;
    }
  });

  it("explains this isn't a real page and links back to the planner", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(<WorkPackagesSegmentNotFound />); });
    mounted = { container, root };

    expect(container.textContent).toContain("Package not found");
    const link = container.querySelector("a");
    expect(link.getAttribute("href")).toBe("/forge/work");
  });
});
