/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { updateUser } = vi.hoisted(() => ({ updateUser: vi.fn() }));

vi.mock("@/components/Header", () => ({ default: () => React.createElement("header", null, "409 Marketplace") }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { updateUser } }) }));

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
});
