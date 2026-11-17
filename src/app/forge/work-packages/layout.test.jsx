// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/forge/work-packages/pkg-1/takeoff",
  useSearchParams: () => new URLSearchParams(),
}));

// Same stubbing approach as src/app/forge/work/layout.test.jsx and the
// charts precedent it mirrors: assert the chrome contract, not the rail's
// internals.
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

// The layout is async (it awaits the server-checked programmer boolean
// for the shell) — stub the check so this test never touches the real
// Supabase server client in jsdom.
vi.mock("@/lib/supabase/loadProgrammerAuthorization", () => ({
  isProgrammerAuthorized: () => Promise.resolve(false),
}));

import WorkPackagesPlannerLayout from "./layout.jsx";

describe("WorkPackagesPlannerLayout", () => {
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

  it("wraps a takeoff page in the standard workspace shell plus the planner's own nav bar", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    // The layout is async — resolve it before rendering, the same way a
    // server render would.
    const element = await WorkPackagesPlannerLayout({ children: <div data-takeoff-page>takeoff content</div> });
    act(() => {
      root.render(element);
    });
    mounted = { container, root };

    // Cross-workspace chrome restored (the PROMOTED_PREFIXES gap this fix closes).
    expect(container.querySelector("[data-workspace-shell-stub]")).not.toBeNull();
    expect(container.querySelector('nav[aria-label="workspace stub"]')).not.toBeNull();
    // Planner's own persistent nav, same component as the /forge/work layout uses,
    // so a takeoff page is no longer a dead end.
    expect(container.querySelector('nav[aria-label="Work Package Planner"]')).not.toBeNull();
    expect(container.textContent).toContain("Work Packages");
    expect(container.textContent).toContain("Document library");
    expect(container.textContent).toContain("Admin");
    expect(container.textContent).toContain("New package");
    // The takeoff page's own content still renders inside.
    expect(container.querySelector("[data-takeoff-page]")).not.toBeNull();
  });
});
