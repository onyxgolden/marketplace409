// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, signOut } = vi.hoisted(() => {
  const state = { user: { email: "jason@example.com" } };
  return {
    getUser: vi.fn(() => Promise.resolve({ data: { user: state.user } })),
    signOut: vi.fn(() => Promise.resolve({})),
    __state: state,
  };
});

vi.mock("next/navigation", () => ({ usePathname: () => "/forge" }));
vi.mock("@/components/theme/ThemeProvider", () => ({
  useTheme: () => ({ resolvedTheme: "dark", setThemePreference: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser, signOut } }),
}));

import { WorkspaceRightRail } from "./workspace-shell.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mounted = null;
function mountRail() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<WorkspaceRightRail />);
  });
  mounted = { container, root };
  return container;
}

beforeEach(async () => {
  getUser.mockClear();
  signOut.mockClear();
});

afterEach(() => {
  if (mounted) {
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
    mounted = null;
  }
});

describe("WorkspaceRightRail account menu", () => {
  it("clicking the avatar while signed in opens an account menu and does NOT sign out", async () => {
    const container = mountRail();
    await act(async () => {});
    const avatar = container.querySelector('button[aria-label^="Account menu"]');
    expect(avatar).not.toBeNull();
    act(() => {
      avatar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("sign-out requires the explicit menu action", async () => {
    const container = mountRail();
    await act(async () => {});
    const avatar = container.querySelector('button[aria-label^="Account menu"]');
    act(() => {
      avatar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const signOutItem = container.querySelector('[role="menuitem"]');
    expect(signOutItem).not.toBeNull();
    expect(signOutItem.textContent).toContain("Sign out");
    await act(async () => {
      signOutItem.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("Escape closes the account menu without signing out", async () => {
    const container = mountRail();
    await act(async () => {});
    const avatar = container.querySelector('button[aria-label^="Account menu"]');
    act(() => {
      avatar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("clicking outside the menu closes it without signing out", async () => {
    const container = mountRail();
    await act(async () => {});
    const avatar = container.querySelector('button[aria-label^="Account menu"]');
    act(() => {
      avatar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    act(() => {
      document.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("menu shows the signed-in account email", async () => {
    const container = mountRail();
    await act(async () => {});
    const avatar = container.querySelector('button[aria-label^="Account menu"]');
    act(() => {
      avatar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const menu = container.querySelector('[role="menu"]');
    expect(menu.textContent).toContain("jason@example.com");
  });
});
