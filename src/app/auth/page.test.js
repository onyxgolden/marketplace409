/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resetPasswordForEmail, signInWithPassword, signUp, onAuthStateChange, authStateCallback, signOutSafely } = vi.hoisted(() => {
  const state = { current: null };
  return {
    resetPasswordForEmail: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    onAuthStateChange: vi.fn((callback) => {
      state.current = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    authStateCallback: state,
    signOutSafely: vi.fn(),
  };
});

vi.mock("@/components/Header", () => ({ default: () => React.createElement("header", null, "409 Marketplace") }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      resetPasswordForEmail,
      signInWithPassword,
      signUp,
      onAuthStateChange,
    },
  }),
}));
// Mocked here so this file can test "did page.jsx call the shared helper correctly and handle its
// result" in isolation -- the helper's own cache-clearing/redirect/failure behavior is tested once,
// directly, in signOutSafely.test.js, rather than re-verified at every call site.
vi.mock("@/lib/auth/signOutSafely.js", () => ({ signOutSafely }));

import AuthPage from "./page";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function enter(input, value) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function findButton(container, text) {
  return [...container.querySelectorAll("button")].find((button) => button.textContent === text);
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
    signUp.mockReset().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    signOutSafely.mockReset().mockResolvedValue({ success: true, error: null });
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
    const forgot = findButton(container, "Forgot password?");
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
    const signIn = findButton(container, "Sign In");

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

  describe("account-enumeration safety", () => {
    // The core security property ChatGPT's review flagged: signUp() must produce the SAME visible
    // message regardless of whether the email is new, already confirmed, or already registered but
    // unconfirmed -- Supabase itself already avoids returning an `error` in the existing-account
    // cases specifically so the caller can't distinguish them; showing a different UI message per
    // case (as an earlier version of this fix did, by checking `data.user.identities.length`) would
    // reintroduce exactly the oracle Supabase's own design avoids. These three scenarios must all
    // produce byte-identical visible text.
    const SCENARIOS = {
      "a genuinely new account awaiting confirmation": { data: { user: { id: "user-1", identities: [{ id: "identity-1" }] } }, error: null },
      "an existing, already-confirmed account (Supabase's real no-op shape: no error, empty identities)": { data: { user: { id: "user-1", identities: [] } }, error: null },
      "an existing, unconfirmed account (Supabase may omit identities entirely in some client versions)": { data: { user: { id: "user-1" } }, error: null },
    };

    let firstMessage;

    for (const [label, response] of Object.entries(SCENARIOS)) {
      it(`shows the same actionable message for: ${label}`, async () => {
        signUp.mockResolvedValueOnce(response);
        const password = container.querySelector('input[placeholder="Password"]');
        act(() => enter(password, "correct horse battery staple"));
        const create = findButton(container, "Create Account");

        await act(async () => create.click());

        const status = container.querySelector('[role="status"]');
        expect(status).not.toBeNull();
        expect(status.textContent.length).toBeGreaterThan(0);

        if (firstMessage === undefined) {
          firstMessage = status.textContent;
        } else {
          expect(status.textContent).toBe(firstMessage);
        }

        // Must tell the legitimate owner what to do next without confirming which case occurred.
        expect(status.textContent.toLowerCase()).toMatch(/check your inbox|sign in|forgot password/);
        expect(status.textContent).not.toMatch(/already exists|already registered|already have an account with this specific/i);
      });
    }
  });

  it("disables Sign In for the duration of its own in-flight request, and re-enables it afterward", async () => {
    let resolveSignIn;
    signInWithPassword.mockReturnValue(new Promise((resolve) => { resolveSignIn = resolve; }));
    const signInButton = findButton(container, "Sign In");

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
    const createButton = findButton(container, "Create Account");

    act(() => { createButton.click(); });
    expect(createButton.disabled).toBe(true);

    await act(async () => {
      resolveSignUp({ data: { user: { id: "user-1", identities: [{ id: "identity-1" }] } }, error: null });
    });
    expect(createButton.disabled).toBe(false);
  });

  it("calls the shared signOutSafely() helper and does not claim success if it fails, restoring the enabled state", async () => {
    let resolveSignOut;
    signOutSafely.mockReturnValue(new Promise((resolve) => { resolveSignOut = resolve; }));
    const signOutButton = findButton(container, "Sign Out");
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    act(() => { signOutButton.click(); });
    expect(signOutButton.disabled).toBe(true);

    // A failure result, rather than success -- the button must re-enable and the failure must be
    // shown, never silently treated as a successful sign-out.
    await act(async () => {
      resolveSignOut({ success: false, error: { message: "network error" } });
    });
    expect(signOutButton.disabled).toBe(false);
    expect(alertSpy).toHaveBeenCalledWith("network error");
    alertSpy.mockRestore();
  });

  it("does not fire a second Sign In request while the first is still in flight (double-submit protection)", async () => {
    let resolveSignIn;
    signInWithPassword.mockReturnValue(new Promise((resolve) => { resolveSignIn = resolve; }));
    const signInButton = findButton(container, "Sign In");

    act(() => { signInButton.click(); });
    act(() => { signInButton.click(); }); // second click while disabled -- browsers don't fire onClick on a disabled button, but assert the guard explicitly

    expect(signInWithPassword).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSignIn({ data: { session: {}, user: { id: "user-1" } }, error: null });
    });
  });

  describe("cross-action mutual exclusion (adversarial)", () => {
    it("Create Account cannot start while Sign In is pending", async () => {
      let resolveSignIn;
      signInWithPassword.mockReturnValue(new Promise((resolve) => { resolveSignIn = resolve; }));
      const password = container.querySelector('input[placeholder="Password"]');
      act(() => enter(password, "correct horse battery staple"));
      const signInButton = findButton(container, "Sign In");
      const createButton = findButton(container, "Create Account");

      act(() => { signInButton.click(); });
      expect(createButton.disabled).toBe(true);
      act(() => { createButton.click(); }); // blocked by the component's own guard even if a test bypasses `disabled`

      expect(signUp).not.toHaveBeenCalled();

      await act(async () => {
        resolveSignIn({ data: { session: {}, user: { id: "user-1" } }, error: null });
      });
    });

    it("Sign In cannot start while Create Account is pending", async () => {
      let resolveSignUp;
      signUp.mockReturnValue(new Promise((resolve) => { resolveSignUp = resolve; }));
      const password = container.querySelector('input[placeholder="Password"]');
      act(() => enter(password, "correct horse battery staple"));
      const signInButton = findButton(container, "Sign In");
      const createButton = findButton(container, "Create Account");

      act(() => { createButton.click(); });
      expect(signInButton.disabled).toBe(true);
      act(() => { signInButton.click(); });

      expect(signInWithPassword).not.toHaveBeenCalled();

      await act(async () => {
        resolveSignUp({ data: { user: { id: "user-1" } }, error: null });
      });
    });

    it("no other auth action can start while Sign Out is pending", async () => {
      let resolveSignOut;
      signOutSafely.mockReturnValue(new Promise((resolve) => { resolveSignOut = resolve; }));
      const signOutButton = findButton(container, "Sign Out");
      const createButton = findButton(container, "Create Account");
      const forgotButton = findButton(container, "Forgot password?");

      act(() => { signOutButton.click(); });
      expect(createButton.disabled).toBe(true);
      expect(forgotButton.disabled).toBe(true);

      act(() => { createButton.click(); });
      act(() => { forgotButton.click(); });

      expect(signUp).not.toHaveBeenCalled();
      expect(resetPasswordForEmail).not.toHaveBeenCalled();

      await act(async () => {
        resolveSignOut({ success: true, error: null });
      });
    });

    it("all controls recover after a failing action, and a different action can then proceed normally", async () => {
      signInWithPassword.mockResolvedValueOnce({ data: {}, error: { message: "invalid credentials" } });
      const password = container.querySelector('input[placeholder="Password"]');
      act(() => enter(password, "wrong password"));
      const signInButton = findButton(container, "Sign In");
      const createButton = findButton(container, "Create Account");

      await act(async () => signInButton.click());

      expect(signInButton.disabled).toBe(false);
      expect(createButton.disabled).toBe(false);

      // A completely different action now proceeds normally -- the failed Sign In didn't leave the
      // shared authAction slot stuck occupied.
      await act(async () => createButton.click());
      expect(signUp).toHaveBeenCalledOnce();
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
    signOutSafely.mockReset().mockResolvedValue({ success: true, error: null });
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
    const create = findButton(container, "Create Account");

    await act(async () => create.click());

    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: "borrower@example.com",
      options: { emailRedirectTo: `${window.location.origin}/auth?next=%2Fforge%2Fprivate-financing%2Fportal&email=borrower%40example.com` },
    }));
  });
});
