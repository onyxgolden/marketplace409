/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resetPasswordForEmail, signInWithPassword, signUp, onAuthStateChange } = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
}));

vi.mock("@/components/Header", () => ({ default: () => React.createElement("header", null, "409 Marketplace") }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      resetPasswordForEmail,
      signInWithPassword,
      signOut: vi.fn(),
      signUp,
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

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("AuthPage password controls", () => {
  let container;
  let root;

  beforeEach(() => {
    window.history.pushState({}, "", "/auth");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
    signInWithPassword.mockReset().mockResolvedValue({ data: {}, error: null });
    signUp.mockReset().mockResolvedValue({ data: {}, error: null });
    onAuthStateChange.mockReset().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
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
});

describe("AuthPage invited borrower onboarding", () => {
  let container;
  let root;

  function renderAt(url) {
    window.history.pushState({}, "", url);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
    signInWithPassword.mockReset().mockResolvedValue({ data: {}, error: null });
    signUp.mockReset().mockResolvedValue({ data: {}, error: null });
    onAuthStateChange.mockReset().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    act(() => root.render(React.createElement(AuthPage)));
  }

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.history.pushState({}, "", "/auth");
  });

  it("pre-fills and locks the email field to the invited address, blocking a mismatched sign-in", async () => {
    renderAt("/auth?next=%2Fforge%2Fprivate-financing%2Fportal&email=borrower%40example.com");
    await flush();

    const email = container.querySelector('input[placeholder="Email"]');
    expect(email.value).toBe("borrower@example.com");
    expect(email.disabled).toBe(true);
    expect(container.textContent).toContain("borrower@example.com");
  });

  it("carries the return route and invited email through email confirmation on sign-up", async () => {
    renderAt("/auth?next=%2Fforge%2Fprivate-financing%2Fportal&email=borrower%40example.com");
    await flush();

    const password = container.querySelector('input[placeholder="Password"]');
    const create = [...container.querySelectorAll("button")].find((b) => b.textContent === "Create Account");
    act(() => enter(password, "correct horse battery staple"));
    await act(async () => create.click());

    expect(signUp).toHaveBeenCalledWith({
      email: "borrower@example.com",
      password: "correct horse battery staple",
      options: {
        emailRedirectTo: `${window.location.origin}/auth?next=%2Fforge%2Fprivate-financing%2Fportal&email=borrower%40example.com`,
      },
    });
  });

  it("explains that password reset only works for an existing account when invited", async () => {
    renderAt("/auth?next=%2Fforge%2Fprivate-financing%2Fportal&email=borrower%40example.com");
    await flush();

    expect(container.textContent).toContain("Password reset only works if you already have a 409 Marketplace account with this email.");
  });

  it("returns the borrower to the invitation route once a session appears after sign-in", async () => {
    renderAt("/auth?next=%2Fforge%2Fprivate-financing%2Fportal&email=borrower%40example.com");
    await flush();

    const password = container.querySelector('input[placeholder="Password"]');
    const signInButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Sign In");
    act(() => enter(password, "correct horse battery staple"));
    await act(async () => signInButton.click());

    expect(signInWithPassword).toHaveBeenCalledWith({ email: "borrower@example.com", password: "correct horse battery staple" });

    // jsdom refuses real navigation ("Not implemented"), so swap in a plain object standing in for
    // window.location just for this assertion -- it captures the href assignment the component makes
    // without jsdom trying (and failing) to actually load a new document.
    const realLocation = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, href: realLocation.href } });
    try {
      const onChange = onAuthStateChange.mock.calls[0][0];
      await act(async () => onChange("SIGNED_IN", { user: { id: "user_1", email: "borrower@example.com" } }));
      expect(window.location.href).toContain("/forge/private-financing/portal");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: realLocation });
    }
  });
});
