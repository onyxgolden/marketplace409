/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { updateUser, listFactors, deleteFactor } = vi.hoisted(() => ({
  updateUser: vi.fn(),
  // Factor-management spies: the page must NEVER touch these. Password reset
  // never clears MFA (Layer 2 invariant) — factor lifecycle lives exclusively
  // in /auth/mfa and /auth/recovery, server-side.
  listFactors: vi.fn(),
  deleteFactor: vi.fn(),
}));

vi.mock("@/components/Header", () => ({ default: () => React.createElement("header", null, "409 Marketplace") }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { updateUser, listFactors, deleteFactor } }) }));

import ResetPasswordPage from "./page";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function enter(input, value) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ResetPasswordPage", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    updateUser.mockReset().mockResolvedValue({ error: null });
    listFactors.mockReset();
    deleteFactor.mockReset();
    act(() => root.render(React.createElement(ResetPasswordPage)));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("validates matching passwords and updates the signed-in recovery user", async () => {
    const password = container.querySelector('input[aria-label="New password"]');
    const confirmation = container.querySelector('input[aria-label="Confirm new password"]');
    act(() => {
      enter(password, "new-password-123");
      enter(confirmation, "new-password-123");
    });
    const submit = [...container.querySelectorAll("button")].find((button) => button.textContent === "Update password");
    await act(async () => submit.click());

    expect(updateUser).toHaveBeenCalledWith({ password: "new-password-123" });
    expect(container.textContent).toContain("Password updated. You can now sign in with your new password.");
  });

  it("shows both new-password fields when requested", () => {
    act(() => container.querySelector('button[aria-label="Show passwords"]').click());
    expect(container.querySelector('input[aria-label="New password"]').type).toBe("text");
    expect(container.querySelector('input[aria-label="Confirm new password"]').type).toBe("text");
  });

  it("submits via Enter (native form submit) without clicking the button", async () => {
    const password = container.querySelector('input[aria-label="New password"]');
    const confirmation = container.querySelector('input[aria-label="Confirm new password"]');
    act(() => {
      enter(password, "new-password-123");
      enter(confirmation, "new-password-123");
    });

    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(updateUser).toHaveBeenCalledWith({ password: "new-password-123" });
    expect(container.textContent).toContain("Password updated. You can now sign in with your new password.");
  });
});

describe("ResetPasswordPage MFA invariance (Layer 2)", () => {
  let mfaContainer;
  let mfaRoot;

  beforeEach(() => {
    mfaContainer = document.createElement("div");
    document.body.appendChild(mfaContainer);
    mfaRoot = createRoot(mfaContainer);
    updateUser.mockReset().mockResolvedValue({ error: null });
    listFactors.mockReset();
    deleteFactor.mockReset();
    act(() => mfaRoot.render(React.createElement(ResetPasswordPage)));
  });

  afterEach(() => {
    act(() => mfaRoot.unmount());
    mfaContainer.remove();
  });

  // A password reset must NEVER clear MFA: no factor listing, no factor
  // deletion, and no "disable MFA" affordance anywhere on the page. The
  // route enforces this server-side; the page must not offer what the
  // route forbids.
  it("updates only the password and never touches factor management", async () => {
    const password = mfaContainer.querySelector('input[aria-label="New password"]');
    const confirmation = mfaContainer.querySelector('input[aria-label="Confirm new password"]');
    act(() => {
      enter(password, "new-password-123");
      enter(confirmation, "new-password-123");
    });
    const submit = [...mfaContainer.querySelectorAll("button")].find((button) => button.textContent === "Update password");

    await act(async () => submit.click());

    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith({ password: "new-password-123" });
    expect(listFactors).not.toHaveBeenCalled();
    expect(deleteFactor).not.toHaveBeenCalled();
  });

  it("offers no disable-MFA / remove-authenticator UI", () => {
    expect(mfaContainer.textContent).not.toMatch(/disable.*(mfa|two-factor|authenticator)/i);
    expect(mfaContainer.textContent).not.toMatch(/turn off.*(mfa|two-factor|authenticator)/i);
    expect(mfaContainer.textContent).not.toMatch(/remove.*authenticator/i);
  });
});
