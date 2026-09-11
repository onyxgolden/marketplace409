/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getUser, signInWithPassword, signUp, onAuthStateChange, authStateCallback, signOutSafely, refresh,
} = vi.hoisted(() => {
  const state = { current: null };
  return {
    getUser: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    onAuthStateChange: vi.fn((callback) => {
      state.current = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    authStateCallback: state,
    signOutSafely: vi.fn(),
    refresh: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser, signInWithPassword, signUp, onAuthStateChange },
  }),
}));
// Mocked here so this file tests "did the panel call the shared helper and handle its result" in
// isolation -- the helper's own cache-clearing/redirect/failure behavior is tested once, directly,
// in src/lib/auth/signOutSafely.test.js.
vi.mock("@/lib/auth/signOutSafely.js", () => ({ signOutSafely }));

import WorkspaceAccountPanel from "./WorkspaceAccountPanel.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function enter(input, value) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function findButton(container, text) {
  return [...container.querySelectorAll("button")].find((button) => button.textContent === text);
}

describe("WorkspaceAccountPanel", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    getUser.mockReset().mockResolvedValue({ data: { user: null } });
    signInWithPassword.mockReset().mockResolvedValue({ error: null });
    signUp.mockReset().mockResolvedValue({ error: null });
    signOutSafely.mockReset().mockResolvedValue({ success: true, error: null });
    refresh.mockReset();
    authStateCallback.current = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("does not expose stale or wrong controls while the initial account check is still in flight -- no Sign In/Create Account AND no Signed-in/Sign-Out shown yet", async () => {
    let resolveGetUser;
    getUser.mockReturnValue(new Promise((resolve) => { resolveGetUser = resolve; }));

    await act(async () => root.render(React.createElement(WorkspaceAccountPanel)));

    expect(container.querySelector('[data-workspace-account-panel="loading"]')).not.toBeNull();
    expect(findButton(container, "Sign In")).toBeUndefined();
    expect(findButton(container, "Sign Out")).toBeUndefined();
    expect(container.querySelector("input")).toBeNull();

    await act(async () => resolveGetUser({ data: { user: null } }));
    expect(container.querySelector('[data-workspace-account-panel="loading"]')).toBeNull();
  });

  it("skips the loading flash entirely when the server already resolved the current user (initialUser)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: "owner@example.com" } } });
    await act(async () => root.render(React.createElement(WorkspaceAccountPanel, { initialUser: { id: "u1", email: "owner@example.com" } })));

    expect(container.querySelector('[data-workspace-account-panel="loading"]')).toBeNull();
    expect(container.textContent).toContain("owner@example.com");
  });

  describe("signed out", () => {
    beforeEach(async () => {
      await act(async () => root.render(React.createElement(WorkspaceAccountPanel)));
      await act(async () => {}); // flush the getUser() microtask
    });

    it("presents clear, separate Sign In and Create Account actions, with no navigation away from this page", () => {
      expect(container.querySelector('[data-workspace-account-panel="signed-out"]')).not.toBeNull();
      expect(findButton(container, "Sign In")).not.toBeUndefined();
      expect(findButton(container, "Create Account")).not.toBeUndefined();
    });

    it("signs in with the entered credentials and does not itself navigate -- the caller's onAuthStateChange subscription (below) owns what happens next", async () => {
      enter(container.querySelector('input[type="email"]'), "person@example.com");
      enter(container.querySelector('input[type="password"]'), "correct horse battery staple");

      await act(async () => findButton(container, "Sign In").click());

      expect(signInWithPassword).toHaveBeenCalledWith({ email: "person@example.com", password: "correct horse battery staple" });
    });

    it("shows the corrected, non-enumerating existing-email message on sign-up, identical to /auth's own message", async () => {
      enter(container.querySelector('input[type="email"]'), "already-registered@example.com");
      enter(container.querySelector('input[type="password"]'), "whatever123");

      await act(async () => findButton(container, "Create Account").click());

      expect(container.textContent).toContain("Thanks! If this is a new email, check your inbox to confirm your account.");
      expect(container.textContent).toContain("you can sign in above instead");
    });

    it("refreshes the workspace list in place (router.refresh()) once a session actually lands, with no manual navigation required", async () => {
      expect(authStateCallback.current).not.toBeNull();

      await act(async () => authStateCallback.current("SIGNED_IN", { user: { id: "u1", email: "person@example.com" } }));

      expect(refresh).toHaveBeenCalled();
      expect(container.querySelector('[data-workspace-account-panel="signed-in"]')).not.toBeNull();
      expect(container.textContent).toContain("person@example.com");
    });

    it("does not leave Sign In / Create Account disabled after a failed authentication attempt", async () => {
      signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
      enter(container.querySelector('input[type="email"]'), "person@example.com");
      enter(container.querySelector('input[type="password"]'), "wrong");

      await act(async () => findButton(container, "Sign In").click());

      expect(container.textContent).toContain("Invalid login credentials");
      expect(findButton(container, "Sign In").disabled).toBe(false);
      expect(findButton(container, "Create Account").disabled).toBe(false);
    });

    it("disables every auth control for the duration of one in-flight action (mutual exclusion)", async () => {
      let resolveSignIn;
      signInWithPassword.mockReturnValue(new Promise((resolve) => { resolveSignIn = resolve; }));
      const signInButton = findButton(container, "Sign In");
      const createAccountButton = findButton(container, "Create Account");

      act(() => { signInButton.click(); });
      expect(signInButton.disabled).toBe(true);
      expect(createAccountButton.disabled).toBe(true);

      await act(async () => resolveSignIn({ error: null }));
    });
  });

  describe("signed in", () => {
    beforeEach(async () => {
      getUser.mockResolvedValue({ data: { user: { id: "u1", email: "owner@example.com" } } });
      await act(async () => root.render(React.createElement(WorkspaceAccountPanel)));
      await act(async () => {});
    });

    it("shows which account is currently active and a Sign Out control, with no sign-in form visible", () => {
      expect(container.textContent).toContain("owner@example.com");
      expect(findButton(container, "Sign Out")).not.toBeUndefined();
      expect(container.querySelector("input")).toBeNull();
    });

    it("calls the shared signOutSafely() helper, the same one used elsewhere in the app", async () => {
      await act(async () => findButton(container, "Sign Out").click());
      expect(signOutSafely).toHaveBeenCalledWith(expect.objectContaining({ redirectTo: "/" }));
    });

    it("re-enables Sign Out and surfaces the error if it fails, instead of leaving it stuck disabled or claiming success", async () => {
      let resolveSignOut;
      signOutSafely.mockReturnValue(new Promise((resolve) => { resolveSignOut = resolve; }));
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      const signOutButton = findButton(container, "Sign Out");

      act(() => { signOutButton.click(); });
      expect(signOutButton.disabled).toBe(true);

      await act(async () => resolveSignOut({ success: false, error: { message: "network error" } }));

      expect(findButton(container, "Sign Out").disabled).toBe(false);
      expect(alertSpy).toHaveBeenCalledWith("network error");
      alertSpy.mockRestore();
    });

    it("clears to the signed-out state (no protected-account controls left) once a sign-out is observed, with no further navigation needed on this page", async () => {
      expect(authStateCallback.current).not.toBeNull();

      await act(async () => authStateCallback.current("SIGNED_OUT", null));

      expect(refresh).toHaveBeenCalled();
      expect(container.querySelector('[data-workspace-account-panel="signed-in"]')).toBeNull();
      expect(container.textContent).not.toContain("owner@example.com");
      expect(findButton(container, "Sign In")).not.toBeUndefined();
    });
  });
});
