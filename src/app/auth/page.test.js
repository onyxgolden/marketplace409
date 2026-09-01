/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resetPasswordForEmail, signInWithPassword } = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  signInWithPassword: vi.fn(),
}));

vi.mock("@/components/Header", () => ({ default: () => React.createElement("header", null, "409 Marketplace") }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      resetPasswordForEmail,
      signInWithPassword,
      signOut: vi.fn(),
      signUp: vi.fn(),
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

  it("redirects immediately after sign-in without showing a success alert", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const signIn = [...container.querySelectorAll("button")].find((button) => button.textContent === "Sign In");

    await act(async () => signIn.click());

    expect(signInWithPassword).toHaveBeenCalledOnce();
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
