/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { back, signOutSafely } = vi.hoisted(() => ({
  back: vi.fn(),
  signOutSafely: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/forge",
  useRouter: () => ({ back }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));
// Mocked here so this file can test "did the bar call the shared helper and handle its result"
// in isolation -- the helper's own cache-clearing/redirect/failure behavior is tested once,
// directly, in src/lib/auth/signOutSafely.test.js.
vi.mock("@/lib/auth/signOutSafely.js", () => ({ signOutSafely }));

import ForgeNavigationBar from "./ForgeNavigationBar";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ForgeNavigationBar sign-out control", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    signOutSafely.mockReset().mockResolvedValue({ success: true, error: null });
    act(() => root.render(React.createElement(ForgeNavigationBar)));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function findSignOutButton() {
    return [...container.querySelectorAll("button")].find((button) => button.textContent.includes("Sign Out"));
  }

  it("renders a Sign Out control that calls the shared signOutSafely() helper", async () => {
    const signOutButton = findSignOutButton();
    expect(signOutButton).not.toBeUndefined();

    await act(async () => signOutButton.click());

    expect(signOutSafely).toHaveBeenCalledOnce();
    expect(signOutSafely).toHaveBeenCalledWith(expect.objectContaining({ redirectTo: "/" }));
  });

  it("disables the Sign Out button for the duration of its own in-flight request", async () => {
    let resolveSignOut;
    signOutSafely.mockReturnValue(new Promise((resolve) => { resolveSignOut = resolve; }));
    const signOutButton = findSignOutButton();

    act(() => { signOutButton.click(); });
    expect(signOutButton.disabled).toBe(true);

    await act(async () => {
      resolveSignOut({ success: true, error: null });
    });
  });

  it("re-enables the Sign Out button and surfaces the error if the helper reports failure, instead of leaving it stuck disabled or claiming success", async () => {
    let resolveSignOut;
    signOutSafely.mockReturnValue(new Promise((resolve) => { resolveSignOut = resolve; }));
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const signOutButton = findSignOutButton();

    act(() => { signOutButton.click(); });
    expect(signOutButton.disabled).toBe(true);

    await act(async () => {
      resolveSignOut({ success: false, error: { message: "network error" } });
    });

    expect(signOutButton.disabled).toBe(false);
    expect(alertSpy).toHaveBeenCalledWith("network error");
    alertSpy.mockRestore();
  });

  it("keeps the existing nav links and Back control alongside the new Sign Out control", () => {
    expect(container.textContent).toContain("Executive KPI");
    expect(container.textContent).toContain("Back");
    expect(container.textContent).toContain("Sign Out");
  });
});
