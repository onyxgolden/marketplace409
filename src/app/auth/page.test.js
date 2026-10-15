/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resetPasswordForEmail, signInWithPassword, signUp, onAuthStateChange, authStateCallback, signOutSafely, setSession } = vi.hoisted(() => {
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
    // Establishes the browser session from a gateway-issued session object.
    setSession: vi.fn(),
  };
});

// Layer-2 activation flag for page.jsx + useCredentialAuth.js, both of which import
// isMfaLayer2Activated from this module. Defaults to false so every pre-existing test
// below exercises the exact pre-Layer-2 behavior; the "Layer 2 enabled" describe block
// flips it to true.
const { layer2Enabled } = vi.hoisted(() => ({ layer2Enabled: { current: false } }));

vi.mock("@/lib/auth/securityPolicy.js", () => ({
  MFA_STATES: {
    FIRST_FACTOR: "FIRST_FACTOR",
    ENROLL_REQUIRED: "ENROLL_REQUIRED",
    CHALLENGE_REQUIRED: "CHALLENGE_REQUIRED",
    AUTHORIZED: "AUTHORIZED",
    RECOVERY_PENDING: "RECOVERY_PENDING",
  },
  isMfaLayer2Activated: () => layer2Enabled.current,
}));

vi.mock("@/components/Header", () => ({ default: () => React.createElement("header", null, "409 Marketplace") }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      resetPasswordForEmail,
      signInWithPassword,
      signUp,
      onAuthStateChange,
      setSession,
    },
  }),
}));
// Mocked here so the page's status-endpoint routing can be tested in
// isolation: the endpoint's own contract is tested in
// src/app/api/auth/mfa/route.test.js. All other gateway helpers stay real
// (the "Layer 2 enabled" block below stubs fetch to test real route
// contracts through them).
const { gatewayMfaStatus } = vi.hoisted(() => ({
  gatewayMfaStatus: vi.fn(async () => ({ status: "ok", authorized: true, state: "AUTHORIZED", cohort: "unknown" })),
}));
vi.mock("@/lib/auth/authGateway.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    gatewayMfaStatus: (...args) => gatewayMfaStatus(...args),
  };
});
// Mocked here so this file can test "did page.jsx call the shared helper correctly and handle its
// result" in isolation -- the helper's own cache-clearing/redirect/failure behavior is tested once,
// directly, in signOutSafely.test.js, rather than re-verified at every call site.
vi.mock("@/lib/auth/signOutSafely.js", () => ({
  signOutSafely,
  // Pass-through stand-in: the real mapper is tested directly in signOutSafely.test.js.
  friendlySignOutError: (error) => error?.message ?? "Sign-out didn't complete. Please try again.",
}));

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

  it("submits Sign In when Enter is pressed in the form (native form submit, no button click)", async () => {
    const email = container.querySelector('input[placeholder="Email"]');
    const password = container.querySelector('input[placeholder="Password"]');
    act(() => {
      enter(email, "person@example.com");
      enter(password, "correct horse battery staple");
    });

    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "correct horse battery staple",
    });
  });

  // The onAuthStateChange callback is async in page.jsx (it awaits the Layer-2 eligibility
  // check when activated), so this test awaits act() -- a floating act() promise leaves React's
  // act scope open and breaks rendering in later tests.
  it("redirects once onAuthStateChange reports a session -- covering sign-in, sign-up, and a confirmation-link auto-recovered session alike", async () => {
    const originalLocation = window.location;
    // jsdom's window.location.href setter can't be spied on directly (its property descriptor isn't
    // configurable); swap in a plain writable stand-in for the duration of this one assertion instead.
    delete window.location;
    window.location = { ...originalLocation, href: "" };

    await act(async () => {
      await authStateCallback.current("SIGNED_IN", { user: { id: "user-1" } });
    });

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
    // No blocking alert() -- the failure renders inline in the page's own message surface.
    expect(alertSpy).not.toHaveBeenCalled();
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status.textContent).toContain("network error");
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

describe("AuthPage Layer 2 enabled: gateway integration (real route contracts)", () => {
  let container;
  let root;
  let originalFetch;

  // Mocks the gateway routes' ACTUAL response shapes
  // (src/app/api/auth/*/route.js): { status:'ok', ... } | { error }.
  function stubGateway(handler) {
    globalThis.fetch = vi.fn(async (url, options) => handler(String(url), options));
  }

  function jsonResponse(payload) {
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => payload };
  }

  // Swaps in a writable location stand-in (jsdom's href setter isn't
  // configurable); returns a restore function.
  function captureRedirect() {
    const originalLocation = window.location;
    delete window.location;
    window.location = { ...originalLocation, href: "" };
    return () => { window.location = originalLocation; };
  }

  beforeEach(() => {
    layer2Enabled.current = true;
    originalFetch = globalThis.fetch;
    stubGateway(() => jsonResponse({ status: "ok", session: { access_token: "atk", refresh_token: "rtk" } }));
    resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
    signInWithPassword.mockReset().mockResolvedValue({ data: { session: {}, user: { id: "user-1" } }, error: null });
    signUp.mockReset().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    signOutSafely.mockReset().mockResolvedValue({ success: true, error: null });
    setSession.mockReset().mockResolvedValue({ data: {}, error: null });
    window.history.pushState({}, "", "/auth?next=%2Fforge%2Fportal");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(React.createElement(AuthPage)));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
    layer2Enabled.current = false;
  });

  it("establishes the browser session from the gateway-issued session via setSession", async () => {
    const email = container.querySelector('input[placeholder="Email"]');
    const password = container.querySelector('input[placeholder="Password"]');
    act(() => {
      enter(email, "owner@example.com");
      enter(password, "correct horse battery staple");
    });
    const signIn = findButton(container, "Sign In");

    await act(async () => signIn.click());

    // The direct provider call is NOT used on the gateway path.
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/auth/sign-in",
      expect.objectContaining({ method: "POST" })
    );
    const [, options] = globalThis.fetch.mock.calls.find(([url]) => url === "/api/auth/sign-in");
    const body = JSON.parse(options.body);
    expect(body.email).toBe("owner@example.com");
    expect(body.password).toBe("correct horse battery staple");
    // operationId must be UUID-shaped — the gateway 400s otherwise.
    expect(body.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    // The gateway-issued session is established in the browser client...
    expect(setSession).toHaveBeenCalledWith({ access_token: "atk", refresh_token: "rtk" });
    // ...and no error message is shown (onAuthStateChange will redirect).
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("redirects to the MFA ceremony on the route's authoritative mfa_required hint", async () => {
    stubGateway((url) => {
      if (url === "/api/auth/sign-in") {
        return { ok: false, status: 403, headers: { get: () => null }, json: async () => ({ status: "mfa_required", next: "challenge" }) };
      }
      return jsonResponse({ status: "ok" });
    });
    const restore = captureRedirect();
    const password = container.querySelector('input[placeholder="Password"]');
    act(() => enter(password, "correct horse battery staple"));
    const signIn = findButton(container, "Sign In");

    await act(async () => signIn.click());

    expect(window.location.href).toBe("/auth/mfa?mode=challenge&next=%2Fforge%2Fportal");
    // No session is established and no error is shown for this outcome.
    expect(setSession).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')).toBeNull();
    restore();
  });

  it("shows the gateway's generic message verbatim on sign-in failure", async () => {
    stubGateway((url) => {
      if (url === "/api/auth/sign-in") {
        return { ok: false, status: 401, headers: { get: () => null }, json: async () => ({ error: "Sign-in failed. Check your email and password and try again." }) };
      }
      return jsonResponse({ status: "ok" });
    });
    const password = container.querySelector('input[placeholder="Password"]');
    act(() => enter(password, "wrong"));
    const signIn = findButton(container, "Sign In");

    await act(async () => signIn.click());

    const status = container.querySelector('[role="status"]');
    expect(status.textContent).toBe("Sign-in failed. Check your email and password and try again.");
    expect(setSession).not.toHaveBeenCalled();
  });

  it("routes sign-up through the gateway and keeps SIGNUP_SUBMITTED_MESSAGE verbatim", async () => {
    const password = container.querySelector('input[placeholder="Password"]');
    act(() => enter(password, "correct horse battery staple"));
    const create = findButton(container, "Create Account");

    await act(async () => create.click());

    expect(signUp).not.toHaveBeenCalled();
    const call = globalThis.fetch.mock.calls.find(([url]) => url === "/api/auth/sign-up");
    expect(call).toBeDefined();
    const body = JSON.parse(call[1].body);
    expect(body.operationId).toMatch(/^[0-9a-f-]{36}$/i);
    const status = container.querySelector('[role="status"]');
    expect(status.textContent).toContain("check your inbox");
  });

  it("routes password reset through the gateway (server-side redirectTo)", async () => {
    const email = container.querySelector('input[placeholder="Email"]');
    act(() => enter(email, "owner@example.com"));
    const forgot = findButton(container, "Forgot password?");

    await act(async () => forgot.click());

    expect(resetPasswordForEmail).not.toHaveBeenCalled();
    const call = globalThis.fetch.mock.calls.find(([url]) => url === "/api/auth/reset");
    expect(call).toBeDefined();
    const body = JSON.parse(call[1].body);
    // The route uses a server-side redirectTo; the client sends only identity fields.
    expect(Object.keys(body).sort()).toEqual(["email", "operationId"]);
    expect(body.email).toBe("owner@example.com");
    expect(container.textContent).toContain("Check your email for a secure password-reset link.");
  });

  it("routes an AAL1 required-cohort session to the MFA ceremony via the status endpoint", async () => {
    gatewayMfaStatus.mockResolvedValueOnce({
      status: "ok", authorized: false, state: "CHALLENGE_REQUIRED", cohort: "required",
    });
    const restore = captureRedirect();

    await act(async () => {
      await authStateCallback.current("SIGNED_IN", {
        user: { id: "user-1" },
        access_token: "atk-aal1",
      });
    });

    expect(gatewayMfaStatus).toHaveBeenCalled();
    expect(window.location.href).toBe("/auth/mfa?mode=challenge&next=%2Fforge%2Fportal");
    restore();
  });

  it("keeps the onAuthStateChange redirect to next when the status endpoint authorizes", async () => {
    const restore = captureRedirect();

    await act(async () => {
      await authStateCallback.current("SIGNED_IN", {
        user: { id: "user-1" },
        access_token: "atk-aal2",
      });
    });

    expect(window.location.href).toBe("/forge/portal");
    restore();
  });
});
