/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { signOut, back } = vi.hoisted(() => ({
  signOut: vi.fn(),
  back: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/forge",
  useRouter: () => ({ back }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut } }),
}));

import ForgeNavigationBar from "./ForgeNavigationBar";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ForgeNavigationBar sign-out control", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    signOut.mockReset().mockResolvedValue({ error: null });
    act(() => root.render(React.createElement(ForgeNavigationBar)));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function findSignOutButton() {
    return [...container.querySelectorAll("button")].find((button) => button.textContent.includes("Sign Out"));
  }

  it("renders a Sign Out control that calls supabase auth.signOut()", async () => {
    const originalLocation = window.location;
    delete window.location;
    window.location = { ...originalLocation, href: "" };

    const signOutButton = findSignOutButton();
    expect(signOutButton).not.toBeUndefined();

    await act(async () => signOutButton.click());

    expect(signOut).toHaveBeenCalledOnce();
    expect(window.location.href).toBe("/");
    window.location = originalLocation;
  });

  it("disables the Sign Out button for the duration of its own in-flight request", async () => {
    let resolveSignOut;
    signOut.mockReturnValue(new Promise((resolve) => { resolveSignOut = resolve; }));
    const signOutButton = findSignOutButton();

    act(() => { signOutButton.click(); });
    expect(signOutButton.disabled).toBe(true);

    await act(async () => {
      resolveSignOut({ error: null });
    });
  });

  it("re-enables the Sign Out button and surfaces the error if signOut fails, instead of leaving it stuck disabled", async () => {
    let resolveSignOut;
    signOut.mockReturnValue(new Promise((resolve) => { resolveSignOut = resolve; }));
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const signOutButton = findSignOutButton();

    act(() => { signOutButton.click(); });
    expect(signOutButton.disabled).toBe(true);

    await act(async () => {
      resolveSignOut({ error: { message: "network error" } });
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
