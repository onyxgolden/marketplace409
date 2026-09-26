// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/forge/charts",
}));

// WorkspaceShell's right rail pulls account/theme state -- stub it so this
// test only asserts the chrome contract, not the rail's internals.
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

import ChartsWorkspaceLayout from "./layout.jsx";

describe("ChartsWorkspaceLayout", () => {
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

  it("wraps the charts page in the standard workspace shell instead of rendering it bare", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <ChartsWorkspaceLayout>
          <div data-charts-page>charts</div>
        </ChartsWorkspaceLayout>
      );
    });
    mounted = { container, root };

    // The shell chrome is present (workspace nav / back-home path) and the
    // page content renders inside it -- no more chromeless dead end.
    expect(container.querySelector("[data-workspace-shell-stub]")).not.toBeNull();
    expect(container.querySelector("[data-charts-page]")).not.toBeNull();
    expect(container.querySelector('nav[aria-label="workspace stub"]')).not.toBeNull();
  });
});
