/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  gatewayMfaEnroll,
  gatewayMfaChallenge,
  gatewayMfaVerify,
  gatewayMfaIssueRecoveryCodes,
  gatewayMfaListFactors,
  getBrowserAccessToken,
} = vi.hoisted(() => ({
  gatewayMfaEnroll: vi.fn(),
  gatewayMfaChallenge: vi.fn(),
  gatewayMfaVerify: vi.fn(),
  gatewayMfaIssueRecoveryCodes: vi.fn(),
  gatewayMfaListFactors: vi.fn(),
  getBrowserAccessToken: vi.fn(),
}));

vi.mock("@/components/Header", () => ({ default: () => React.createElement("header", null, "409 Marketplace") }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
      setSession: vi.fn(async () => ({ data: {}, error: null })),
      getUser: vi.fn(async () => ({ data: { user: null } })),
    },
  }),
}));
vi.mock("@/lib/auth/authGateway.js", () => ({
  gatewayMfaEnroll,
  gatewayMfaChallenge,
  gatewayMfaVerify,
  gatewayMfaIssueRecoveryCodes,
  gatewayMfaListFactors,
  getBrowserAccessToken,
  gatewayErrorMessage: (result) => result?.error ?? result?.transportError ?? "Service unavailable.",
  newOperationId: () => "00000000-0000-4000-a000-000000000001",
}));

import MfaPage from "./page";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function enter(input, value) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function captureRedirect() {
  const originalLocation = window.location;
  delete window.location;
  window.location = { ...originalLocation, href: "" };
  return () => { window.location = originalLocation; };
}

function renderPage(url) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  window.history.pushState({}, "", url);
  act(() => root.render(React.createElement(MfaPage)));
  return { container, root };
}

describe("MfaPage enroll mode", () => {
  let container;
  let root;

  const ENROLL_OK = {
    status: "ok",
    factor_id: "factor-1",
    qr_code: "data:image/svg+xml;utf8,<svg></svg>",
    manual_key: "JBSWY3DPEHPK3PXP",
  };

  beforeEach(() => {
    getBrowserAccessToken.mockReset().mockResolvedValue("test-access-token");
    gatewayMfaEnroll.mockReset().mockResolvedValue(ENROLL_OK);
    gatewayMfaChallenge.mockReset().mockResolvedValue({ status: "ok", challenge_id: "challenge-1" });
    gatewayMfaVerify.mockReset().mockResolvedValue({
      status: "ok",
      session: { access_token: "aal2-token", refresh_token: "refresh-2" },
    });
    ({ container, root } = renderPage("/auth/mfa?mode=enroll"));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows the provider QR, manual key with copy, and a labeled code field", async () => {
    await act(async () => {});

    expect(gatewayMfaEnroll).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "test-access-token" })
    );
    const qr = container.querySelector('img[alt="TOTP enrollment QR code"]');
    expect(qr).not.toBeNull();
    // The QR is the provider's data URI rendered client-side — no third-party service.
    expect(qr.src.startsWith("data:")).toBe(true);
    expect(container.querySelector('[aria-label="Manual setup key"]').textContent).toBe("JBSWY3DPEHPK3PXP");
    expect(container.querySelector('button')).not.toBeNull();
    const label = container.querySelector('label[for="mfa-code"]');
    expect(label.textContent).toMatch(/6-digit code/);
    // Accessibility: the code field is focused when it appears.
    expect(document.activeElement?.id).toBe("mfa-code");
  });

  it("runs challenge then verify with the enrolled factor, establishes the AAL2 session, and continues", async () => {
    const codes = Array.from({ length: 10 }, (_, i) => `code-${i}-xxxx`);
    gatewayMfaIssueRecoveryCodes.mockResolvedValue({ status: "ok", recovery_codes: codes });
    await act(async () => {});
    const restore = captureRedirect();
    const code = container.querySelector("#mfa-code");
    act(() => enter(code, "123456"));
    const form = container.querySelector("form");

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(gatewayMfaChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "test-access-token", factorId: "factor-1" })
    );
    expect(gatewayMfaVerify).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "test-access-token",
        factorId: "factor-1",
        challengeId: "challenge-1",
        code: "123456",
      })
    );
    // After verify, the page issues the one-time recovery codes via the
    // separate endpoint and shows them behind the acknowledgement gate.
    expect(gatewayMfaIssueRecoveryCodes).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "aal2-token", factorId: "factor-1" })
    );
    const list = container.querySelector('[aria-label="Recovery codes"]');
    expect(list).not.toBeNull();
    const cont = [...container.querySelectorAll("button")].find((b) => b.textContent === "Continue");
    expect(cont.disabled).toBe(true); // acknowledgement gate
    restore();
  });

  it("shows the one-time recovery codes behind the acknowledgement gate when the route returns them", async () => {
    const codes = Array.from({ length: 10 }, (_, i) => `code-${i}-xxxx`);
    gatewayMfaIssueRecoveryCodes.mockResolvedValue({ status: "ok", recovery_codes: codes });
    await act(async () => {});
    const restore = captureRedirect();
    const code = container.querySelector("#mfa-code");
    act(() => enter(code, "123456"));

    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const list = container.querySelector('[aria-label="Recovery codes"]');
    expect(list).not.toBeNull();
    expect(list.querySelectorAll("li")).toHaveLength(10);
    const cont = [...container.querySelectorAll("button")].find((b) => b.textContent === "Continue");
    expect(cont.disabled).toBe(true);
    const checkbox = container.querySelector('input[type="checkbox"]');
    act(() => checkbox.click());
    expect(cont.disabled).toBe(false);

    await act(async () => cont.click());

    // Codes never outlive the page session: cleared from state on continue.
    expect(container.querySelector('[aria-label="Recovery codes"]')).toBeNull();
    expect(window.location.href).toBe("/forge/financial");
    restore();
  });

  it("shows a generic message (not wrong-vs-expired) when verification fails, and clears the code", async () => {
    gatewayMfaVerify.mockResolvedValue({ error: "Verification failed. Please try again." });
    await act(async () => {});
    const code = container.querySelector("#mfa-code");
    act(() => enter(code, "000000"));

    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const status = container.querySelector('[role="status"]');
    expect(status.textContent).toBe("Verification failed. Please try again.");
    expect(status.textContent).not.toMatch(/wrong|expired/i);
    expect(container.querySelector("#mfa-code").value).toBe("");
  });

  it("offers retry when enrollment fails to start", async () => {
    gatewayMfaEnroll.mockResolvedValue({ error: "Verification failed. Please try again." });
    act(() => root.unmount());
    container.remove();
    ({ container, root } = renderPage("/auth/mfa?mode=enroll"));
    await act(async () => {});
    gatewayMfaEnroll.mockClear();

    expect(container.textContent).toMatch(/didn't start/i);
    const retry = [...container.querySelectorAll("button")].find((b) => b.textContent === "Try again");
    gatewayMfaEnroll.mockResolvedValue(ENROLL_OK);
    await act(async () => retry.click());

    expect(gatewayMfaEnroll).toHaveBeenCalledTimes(1);
    expect(container.querySelector("#mfa-code")).not.toBeNull();
  });

  it("shows the no-session state (ROUTE GAP 1) when the sign-in withheld the session", async () => {
    getBrowserAccessToken.mockResolvedValue(null);
    act(() => root.unmount());
    container.remove();
    ({ container, root } = renderPage("/auth/mfa?mode=enroll"));
    await act(async () => {});
    gatewayMfaEnroll.mockClear();

    expect(gatewayMfaEnroll).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/couldn't establish your verification session/i);
    const back = container.querySelector('a[href^="/auth?next="]');
    expect(back).not.toBeNull();
  });

  it("requires a non-empty code before calling the gateway", async () => {
    await act(async () => {});
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(gatewayMfaChallenge).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]').textContent).toMatch(/Enter the 6-digit code/);
  });
});

describe("MfaPage challenge mode", () => {
  let container;
  let root;

  beforeEach(() => {
    getBrowserAccessToken.mockReset().mockResolvedValue("test-access-token");
    gatewayMfaChallenge.mockReset().mockResolvedValue({ status: "ok", challenge_id: "challenge-9" });
    gatewayMfaListFactors.mockReset().mockResolvedValue({ status: "ok", factors: [] });
    gatewayMfaVerify.mockReset().mockResolvedValue({
      status: "ok",
      session: { access_token: "aal2-token", refresh_token: "refresh-9" },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("discovers the factor via list_factors when no factor id is bridged", async () => {
    getBrowserAccessToken.mockResolvedValue("atk-1");
    gatewayMfaListFactors.mockResolvedValue({
      status: "ok",
      factors: [{ id: "factor-discovered-1", friendly_name: "App", factor_type: "totp" }],
    });
    ({ container, root } = renderPage("/auth/mfa?mode=challenge"));
    await act(async () => {});

    expect(gatewayMfaListFactors).toHaveBeenCalled();
    const code = container.querySelector("#mfa-code");
    expect(code).not.toBeNull();
  });

  it("explains when no verified factor exists for challenge", async () => {
    getBrowserAccessToken.mockResolvedValue("atk-1");
    gatewayMfaListFactors.mockResolvedValue({ status: "ok", factors: [] });
    ({ container, root } = renderPage("/auth/mfa?mode=challenge"));
    await act(async () => {});

    expect(container.textContent).toMatch(/couldn't identify which authenticator/i);
    expect(container.querySelector("#mfa-code")).toBeNull();
  });

  it("verifies via the temporary factor_id bridge and redirects to next", async () => {
    ({ container, root } = renderPage("/auth/mfa?mode=challenge&factor_id=factor-9&next=%2Fforge%2Fportal"));
    await act(async () => {});
    const restore = captureRedirect();
    const code = container.querySelector("#mfa-code");
    expect(code).not.toBeNull();
    act(() => enter(code, "654321"));

    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(gatewayMfaChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ factorId: "factor-9" })
    );
    expect(gatewayMfaVerify).toHaveBeenCalledWith(
      expect.objectContaining({ factorId: "factor-9", challengeId: "challenge-9", code: "654321" })
    );
    expect(window.location.href).toBe("/forge/portal");
    restore();
  });

  it("links to recovery when the authenticator is lost, and to cancel", async () => {
    ({ container, root } = renderPage("/auth/mfa?mode=challenge&factor_id=factor-9"));
    await act(async () => {});

    expect(container.querySelector('a[href="/auth/recovery"]')).not.toBeNull();
    expect(container.querySelector('a[href="/auth"]')).not.toBeNull();
  });
});
