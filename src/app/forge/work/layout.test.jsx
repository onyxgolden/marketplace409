// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/forge/work",
  useSearchParams: () => new URLSearchParams(),
}));

// WorkspaceShell's right rail pulls account/theme state -- stub it so this
// test only asserts the chrome contract, not the rail's internals. Same
// pattern as src/app/forge/charts/layout.test.jsx, which fixed the
// identical "page rendered bare, no rail, no back/home link" class of bug
// for Charts.
vi.mock("@/components/workspace-shell", () => ({
  default: function WorkspaceShellStub({ children }) {
    return (
      <div data-workspace-shell-stub>
        <nav aria-label="workspace stub">stub chrome</nav>
        {children}
      </div>
    );
  },
}));

import WorkPackagePlannerLayout from "./layout.jsx";

describe("WorkPackagePlannerLayout", () => {
  let mounted;
  afterEach(() => {
    if (mounted) {
      act(() => {
        mounted.root.unmount();
      });
      mounted.container.remove();
      mounted = null;
    }
  });

  it("wraps every planner page in the standard workspace shell plus the planner's own nav bar", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <WorkPackagePlannerLayout>
          <div data-planner-page>planner content</div>
        </WorkPackagePlannerLayout>,
      );
    });
    mounted = { container, root };

    // Cross-workspace chrome restored (the PROMOTED_PREFIXES gap this fix closes).
    expect(container.querySelector("[data-workspace-shell-stub]")).not.toBeNull();
    expect(container.querySelector('nav[aria-label="workspace stub"]')).not.toBeNull();
    // Planner's own persistent nav (Work Packages / Document library / Admin / New package).
    expect(container.querySelector('nav[aria-label="Work Package Planner"]')).not.toBeNull();
    expect(container.textContent).toContain("Work Packages");
    expect(container.textContent).toContain("Document library");
    expect(container.textContent).toContain("Admin");
    expect(container.textContent).toContain("New package");
    // The page's own content still renders inside.
    expect(container.querySelector("[data-planner-page]")).not.toBeNull();
  });
});
