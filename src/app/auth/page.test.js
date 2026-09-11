/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resetPasswordForEmail, signInWithPassword, signUp, signOut, onAuthStateChange, authStateCallback } = vi.hoisted(() => {
  const state = { current: null };
  return {
    resetPasswordForEmail: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    onAuthStateChange: vi.fn((callback) => {
      state.current = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    authStateCallback: state,
  };
});

vi.mock("@/components/Header", () => ({ default: () => React.createElement("header", null, "409 Marketplace") }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      resetPasswordForEmail,
      signInWithPassword,
      signUp,
      signOut,
      onAuthStateChange,
    },
  }),
}));

import AuthPage from "./page";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function enter(input, value) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AuthPage password controls", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
    signInWithPassword.mockReset().mockResolvedValue({ data: { session: {}, user: { id: "user-1" } }, error: null });
    signUp.mockReset().mockResolvedValue({ data: { user: { id: "user-1", identities: [{ id: "identity-1" }] } }, error: null });
    signOut.mockReset().mockResolvedValue({ error: null });
    window.history.pushState({}, "", "/auth");
    act(() => root.render(React.createElement(AuthPage)));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("lets the user show and hide the entered password", () => {
    const password = container.querySelector('input[placeholder="Password"]');
    const toggle = container.querySelector('button[aria-label="Show password"]');
    expect(password.type).toBe("password");

    act(() => toggle.click());
    expect(password.type).toBe("text");
    expect(container.querySelector('button[aria-label="Hide password"]')).not.toBeNull();
  });

  it("emails a reset link to the entered address", async () => {
    const email = container.querySelector('input[placeholder="Email"]');
    const forgot = [...container.querySelectorAll("button")].find((button) => button.textContent === "Forgot password?");
    act(() => {
      enter(email, "gabby@example.com");
    });
    await act(async () => forgot.click());

    expect(resetPasswordForEmail).toHaveBeenCalledWith("gabby@example.com", {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    expect(container.textContent).toContain("Check your email for a secure password-reset link.");
  });

  it("signs in without showing a success alert, leaving the redirect to onAuthStateChange", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const signIn = [...container.querySelectorAll("button")].find((button) => button.textContent === "Sign In");

    await act(async () => signIn.click());

    expect(signInWithPassword).toHaveBeenCalledOnce();
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("redirects once onAuthStateChange reports a session -- covering sign-in, sign-up, and a confirmation-link auto-recovered session alike", () => {
    const originalLocation = window.location;
    // jsdom's window.location.href setter can't be spied on directly (its property descriptor isn't
    // configurable); swap in a plain writable stand-in for the duration of this one assertion instead.
    delete window.location;
    window.location = { ...originalLocation, href: "" };

    act(() => authStateCallback.current("SIGNED_IN", { user: { id: "user-1" } }));

    expect(window.location.href).toBe("/forge/financial");
    window.location = originalLocation;
  });

  it("shows a distinct 'account already exists' message when signUp silently no-ops against an existing confirmed email, instead of the generic success message", async () => {
    // Supabase's own anti-enumeration behavior: no error, but an empty identities array -- this is
    // the real shape it returns for an existing, already-confirmed email.
    signUp.mockResolvedValue({ data: { user: { id: "user-1", identities: [] } }, error: null });
    const password = container.querySelector('input[placeholder="Password"]');
    act(() => enter(password, "correct horse battery staple"));
    const create = [...container.querySelectorAll("button")].find((button) => button.textContent === "Create Account");

    await act(async () => create.click());

    expect(container.textContent).toContain("An account with this email already exists");
    expect(container.textContent).not.toContain("Account created. Check your email");
  });

  it("still shows the normal success message for a genuine new signup (non-empty identities) -- regression guard for the existing-email fix", async () => {
    signUp.mockResolvedValue({ data: { user: { id: "user-1", identities: [{ id: "identity-1" }] } }, error: null });
    const password = container.querySelector('input[placeholder="Password"]');
    act(() => enter(password, "correct horse battery staple"));
    const create = [...container.querySelectorAll("button")].find((button) => button.textContent === "Create Account");

    await act(async () => create.click());

    expect(container.textContent).toContain("Account created. Check your email");
    expect(container.textContent).not.toContain("already exists");
  });

  it("disables Sign In for the duration of its own in-flight request, and re-enables it afterward", async () => {
    let resolveSignIn;
    signInWithPassword.mockReturnValue(new Promise((resolve) => { resolveSignIn = resolve; }));
    const signInButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Sign In");

    let clickPromise;
    act(() => { clickPromise = signInButton.click(); });
    expect(signInButton.disabled).toBe(true);

    await act(async () => {
      resolveSignIn({ data: { session: {}, user: { id: "user-1" } }, error: null });
      await clickPromise;
    });
    expect(signInButton.disabled).toBe(false);
  });

  it("disables Create Account for the duration of its own in-flight request, and re-enables it afterward", async () => {
    let resolveSignUp;
    signUp.mockReturnValue(new Promise((resolve) => { resolveSignUp = resolve; }));
    const password = container.querySelector('input[placeholder="Password"]');
    act(() => enter(password, "correct horse battery staple"));
    const createButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Create Account");

    act(() => { createButton.click(); });
    expect(createButton.disabled).toBe(true);

    await act(async () => {
      resolveSignUp({ data: { user: { id: "user-1", identities: [{ id: "identity-1" }] } }, error: null });
    });
    expect(createButton.disabled).toBe(false);
  });

  it("disables Sign Out for the duration of its own in-flight request, and re-enables it if it errors", async () => {
    let resolveSignOut;
    signOut.mockReturnValue(new Promise((resolve) => { resolveSignOut = resolve; }));
    const signOutButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Sign Out");
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    act(() => { signOutButton.click(); });
    expect(signOutButton.disabled).toBe(true);

    // Errors, rather than succeeding and navigating away -- the button must re-enable rather than
    // stay stuck disabled forever on a failed sign-out.
    await act(async () => {
      resolveSignOut({ error: { message: "network error" } });
    });
    expect(signOutButton.disabled).toBe(false);
    alertSpy.mockRestore();
  });

  it("does not fire a second Sign In request while the first is still in flight (double-submit protection)", async () => {
    let resolveSignIn;
    signInWithPassword.mockReturnValue(new Promise((resolve) => { resolveSignIn = resolve; }));
    const signInButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Sign In");

    act(() => { signInButton.click(); });
    act(() => { signInButton.click(); }); // second click while disabled -- browsers don't fire onClick on a disabled button, but assert the guard explicitly

    expect(signInWithPassword).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSignIn({ data: { session: {}, user: { id: "user-1" } }, error: null });
    });
  });
});

describe("AuthPage invited-borrower mode", () => {
  let container;
  let root;

  beforeEach(() => {
    resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
    signInWithPassword.mockReset().mockResolvedValue({ data: {}, error: null });
    signUp.mockReset().mockResolvedValue({ data: {}, error: null });
    window.history.pushState({}, "", "/auth?next=%2Fforge%2Fprivate-financing%2Fportal&email=borrower%40example.com");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(React.createElement(AuthPage)));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("locks the email field to the invited address and shows the invitation banner", () => {
    const email = container.querySelector('input[placeholder="Email"]');
    expect(email.value).toBe("borrower@example.com");
    expect(email.disabled).toBe(true);
    expect(container.textContent).toContain("You've been invited to view a private financing account as");
  });

  // A locked email field can be narrower than the invited address at small mobile widths (e.g. 360px);
  // `truncate` swaps a silent hard clip for a visible ellipsis, and `title` gives an accessible full-text
  // fallback since a disabled input can't be scrolled or focused to reveal the rest. The banner above
  // still carries the full address, so this only affects the redundant, secondary display of it.
  it("truncates the locked email field with an ellipsis and exposes the full address via title, for narrow viewports", () => {
    const email = container.querySelector('input[placeholder="Email"]');
    expect(email.className).toContain("truncate");
    expect(email.title).toBe("borrower@example.com");
  });

  it("threads next and the invited email through emailRedirectTo on sign-up, so a confirmation-link click returns to the portal", async () => {
    const password = container.querySelector('input[placeholder="Password"]');
    act(() => enter(password, "correct horse battery staple"));
    const create = [...container.querySelectorAll("button")].find((button) => button.textContent === "Create Account");

    await act(async () => create.click());

    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: "borrower@example.com",
      options: { emailRedirectTo: `${window.location.origin}/auth?next=%2Fforge%2Fprivate-financing%2Fportal&email=borrower%40example.com` },
    }));
  });
});
