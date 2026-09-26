// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, signOut, signOutSafely } = vi.hoisted(() => {
  const state = { user: { email: "jason@example.com" } };
  return {
    getUser: vi.fn(() => Promise.resolve({ data: { user: state.user } })),
    signOut: vi.fn(() => Promise.resolve({})),
    signOutSafely: vi.fn(() => Promise.resolve({ success: true, error: null })),
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
// Mocked so this file tests "did the rail call the shared helper and handle its result" in
// isolation -- the helper's own cache-clearing/redirect/failure behavior is tested once,
// directly, in src/lib/auth/signOutSafely.test.js.
vi.mock("@/lib/auth/signOutSafely.js", () => ({
  signOutSafely,
  friendlySignOutError: (error) => error?.message ?? "Sign-out didn't complete. Please try again.",
}));

import WorkspaceShell, { WorkspaceRightRail } from "./workspace-shell.jsx";

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
  signOutSafely.mockClear();
  signOutSafely.mockResolvedValue({ success: true, error: null });
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

  it("sign-out requires the explicit menu action and reuses the shared signOutSafely() helper", async () => {
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
    // The rail reuses the shared signOutSafely() helper (cache-clear-then-redirect ordering),
    // not a raw client sign-out -- this is also what guarantees the Financial Overview cache dies.
    expect(signOutSafely).toHaveBeenCalledOnce();
    expect(signOutSafely).toHaveBeenCalledWith(expect.objectContaining({ redirectTo: "/" }));
    expect(signOut).not.toHaveBeenCalled();
    expect(signOutItem.disabled).toBe(true);
  });

  it("a failed sign-out keeps the menu open with an inline friendly error -- never navigates or claims success", async () => {
    signOutSafely.mockResolvedValueOnce({ success: false, error: { message: "network error" } });
    const container = mountRail();
    await act(async () => {});
    const avatar = container.querySelector('button[aria-label^="Account menu"]');
    act(() => {
      avatar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const signOutItem = container.querySelector('[role="menuitem"]');
    await act(async () => {
      signOutItem.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // The shared helper owns the redirect on success; on failure the menu stays open and the
    // friendly error renders where the user acted -- never an alert() on top of their view.
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    const alert = container.querySelector('[role="menu"] [role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain("network error");
    expect(signOutItem.disabled).toBe(false);
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

describe("WorkspaceShell mobile drawer", () => {
  function mountShell() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<WorkspaceShell><main>workspace content</main></WorkspaceShell>);
    });
    mounted = { container, root };
    return container;
  }

  function openDrawer(container) {
    const openButton = container.querySelector('button[aria-label="Open workspace navigation"]');
    expect(openButton).not.toBeNull();
    act(() => {
      openButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    return container.querySelector('aside[aria-label="Workspace navigation"]');
  }

  it("focuses the close control when the drawer opens, so keyboard users land inside it", async () => {
    const container = mountShell();
    await act(async () => {});
    const drawer = openDrawer(container);
    expect(drawer).not.toBeNull();
    expect(document.activeElement).toBe(drawer.querySelector('button[aria-label="Close workspace navigation"]'));
  });

  it("Escape closes the drawer", async () => {
    const container = mountShell();
    await act(async () => {});
    expect(openDrawer(container)).not.toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector('aside[aria-label="Workspace navigation"]')).toBeNull();
  });

  it("tapping the backdrop closes the drawer but clicks inside it do not", async () => {
    const container = mountShell();
    await act(async () => {});
    const drawer = openDrawer(container);
    expect(drawer).not.toBeNull();

    // Click inside the drawer: stays open.
    act(() => {
      drawer.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('aside[aria-label="Workspace navigation"]')).not.toBeNull();

    // Click the backdrop (the drawer's parent): closes.
    act(() => {
      drawer.parentElement.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('aside[aria-label="Workspace navigation"]')).toBeNull();
  });
});
