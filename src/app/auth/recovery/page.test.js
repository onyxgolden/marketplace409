/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  gatewayRecoveryInitiate,
  gatewayRecoveryComplete,
  getBrowserAccessToken,
} = vi.hoisted(() => ({
  gatewayRecoveryInitiate: vi.fn(),
  gatewayRecoveryComplete: vi.fn(),
  getBrowserAccessToken: vi.fn(),
}));

vi.mock("@/components/Header", () => ({ default: () => React.createElement("header", null, "409 Marketplace") }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1", email: "owner@example.com" } } })),
    },
  }),
}));
vi.mock("@/lib/auth/authGateway.js", () => ({
  gatewayRecoveryInitiate,
  gatewayRecoveryComplete,
  getBrowserAccessToken,
  gatewayErrorMessage: (result) => result?.error ?? result?.transportError ?? "Service unavailable.",
  newOperationId: () => "00000000-0000-4000-a000-000000000002",
}));

import RecoveryPage from "./page";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function enter(input, value) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("RecoveryPage", () => {
  let container;
  let root;

  beforeEach(() => {
    getBrowserAccessToken.mockReset().mockResolvedValue("first-factor-token");
    gatewayRecoveryInitiate.mockReset().mockResolvedValue({ status: "recovery_initiated" });
    gatewayRecoveryComplete.mockReset().mockResolvedValue({
      status: "recovery_pending",
      generation_id: "gen-1",
      message: "Enroll and verify a new authenticator before privileged access resumes.",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.history.pushState({}, "", "/auth/recovery");
    act(() => root.render(React.createElement(RecoveryPage)));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("asks the user to sign in first when there is no first-factor session", async () => {
    getBrowserAccessToken.mockResolvedValue(null);
    act(() => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(React.createElement(RecoveryPage)));
    await act(async () => {});

    expect(container.textContent).toMatch(/Recovery starts from a fresh sign-in/i);
    const link = container.querySelector('a[href="/auth?next=%2Fauth%2Frecovery"]');
    expect(link).not.toBeNull();
    expect(gatewayRecoveryInitiate).not.toHaveBeenCalled();
  });

  it("step 1 confirms the signed-in session, then initiates recovery with the access token", async () => {
    await act(async () => {});

    expect(container.textContent).toMatch(/Step 1 of 2/);
    expect(container.textContent).toMatch(/owner@example.com/);
    const cont = [...container.querySelectorAll("button")].find((b) => b.textContent === "Continue");

    await act(async () => cont.click());

    expect(gatewayRecoveryInitiate).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "first-factor-token" })
    );
    // Step 2 appears: the recovery-code form with a label and focus.
    expect(container.textContent).toMatch(/Step 2 of 2/);
    expect(container.querySelector('label[for="recovery-code"]')).not.toBeNull();
    expect(document.activeElement?.id).toBe("recovery-code");
  });

  it("step 2 completes with one code, clears it, and shows RECOVERY_PENDING with re-enroll instructions", async () => {
    await act(async () => {});
    await act(async () => {
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Continue").click();
    });

    const codeInput = container.querySelector("#recovery-code");
    act(() => enter(codeInput, "ABCD-EFGH-IJKL"));

    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(gatewayRecoveryComplete).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "first-factor-token", recoveryCode: "ABCD-EFGH-IJKL" })
    );
    // The code must not outlive the completing request.
    expect(container.querySelector("#recovery-code")).toBeNull();
    // RECOVERY_PENDING: explicit that this grants NO workspace access until re-enrollment + AAL2.
    expect(container.textContent).toMatch(/does not sign you in/i);
    expect(container.textContent).toMatch(/does not restore access to your workspace/i);
    const enroll = container.querySelector('a[href="/auth/mfa?mode=enroll"]');
    expect(enroll).not.toBeNull();
    expect(enroll.textContent).toMatch(/Set up a new authenticator/);
  });

  it("shows the gateway's generic message when initiation fails", async () => {
    gatewayRecoveryInitiate.mockResolvedValue({ error: "Recovery failed. Check your details and try again." });
    await act(async () => {});

    await act(async () => {
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Continue").click();
    });

    const status = container.querySelector('[role="status"]');
    expect(status.textContent).toBe("Recovery failed. Check your details and try again.");
    // Still on step 1 — no code form shown.
    expect(container.querySelector("#recovery-code")).toBeNull();
  });

  it("shows a generic message (no code oracle) when the code is wrong, and clears it", async () => {
    gatewayRecoveryComplete.mockResolvedValue({ error: "Recovery failed. Check your details and try again." });
    await act(async () => {});
    await act(async () => {
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Continue").click();
    });

    const codeInput = container.querySelector("#recovery-code");
    act(() => enter(codeInput, "WRONG-CODE"));

    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const status = container.querySelector('[role="status"]');
    expect(status.textContent).toBe("Recovery failed. Check your details and try again.");
    expect(status.textContent).not.toMatch(/wrong user|consumed|generation/i);
    // The wrong code is cleared from the field.
    expect(container.querySelector("#recovery-code").value).toBe("");
    // Still on step 2, not pending.
    expect(container.textContent).not.toMatch(/does not sign you in/i);
  });

  it("requires a non-empty code before calling the gateway", async () => {
    await act(async () => {});
    await act(async () => {
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Continue").click();
    });

    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(gatewayRecoveryComplete).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]').textContent).toMatch(/Enter one of your recovery codes/);
  });
});
