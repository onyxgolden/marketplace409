import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  loadProgrammerAuthorization: vi.fn(),
  redirect: vi.fn((href) => { throw new Error(`NEXT_REDIRECT:${href}`); }),
  useRouter: vi.fn(() => ({ refresh: vi.fn() })),
  favoriteWorkspaceId: null,
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect, useRouter: mocks.useRouter }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => Promise.resolve({ count: 3 }),
    }),
  },
}));

// HubPage's own logic (stats, Dev visibility, the favorite-redirect) is what this file
// tests -- WorkspaceAccountPanel's own sign-in/sign-up/sign-out/loading behavior has its own
// dedicated test file. Stubbing it here keeps this suite from needing a real Supabase browser
// client or router just to render the page around it, and still proves HubPage passes it the
// right `initialUser`.
vi.mock("@/components/WorkspaceAccountPanel", () => ({
  default: ({ initialUser }) => React.createElement(
    "div",
    { "data-workspace-account-panel-stub": true },
    initialUser ? `signed-in:${initialUser.email ?? initialUser.id}` : "signed-out",
  ),
}));

function countBuilder(count) {
  const builder = {
    select: () => builder,
    eq: () => Promise.resolve({ count }),
  };
  return builder;
}

function preferenceBuilder() {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: mocks.favoriteWorkspaceId ? { favorite_workspace_id: mocks.favoriteWorkspaceId } : null, error: null }),
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: (table) => {
      if (table === "user_workspace_preferences") return preferenceBuilder();
      return countBuilder(table === "rental_leases" ? 4 : 7);
    },
  }),
}));

vi.mock("@/lib/supabase/loadProgrammerAuthorization", () => ({
  loadProgrammerAuthorization: mocks.loadProgrammerAuthorization,
}));

import HubPage from "./page.jsx";

describe("HubPage (Choose a workspace)", () => {
  beforeEach(() => {
    mocks.favoriteWorkspaceId = null;
    mocks.redirect.mockClear();
    mocks.loadProgrammerAuthorization.mockReset();
    // Default: not a developer.
    mocks.loadProgrammerAuthorization.mockResolvedValue({ ok: true, authorized: false, user: null });
  });

  it("shows no Health tile to anyone -- the health shortcut was removed from the hub", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
    const markup = renderToStaticMarkup(await HubPage());

    expect(markup).toContain("Marketplace");
    expect(markup).not.toContain("Health");
    expect(markup).not.toContain("/forge/health");
  });

  it("redirects a fresh visit straight to the saved favorite workspace", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
    mocks.favoriteWorkspaceId = "forge";

    await expect(HubPage()).rejects.toThrow("NEXT_REDIRECT:/forge");
    expect(mocks.redirect).toHaveBeenCalledWith("/forge");
  });

  it("shows the picker instead of redirecting when the All apps link's chooseWorkspace param is present, even with a saved favorite", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
    mocks.favoriteWorkspaceId = "forge";

    const markup = renderToStaticMarkup(
      await HubPage({ searchParams: Promise.resolve({ chooseWorkspace: "1" }) }),
    );
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(markup).toContain("Choose a workspace");
  });

  it("falls back to the picker when the saved favorite is a removed workspace id", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
    mocks.favoriteWorkspaceId = "health";

    const markup = renderToStaticMarkup(await HubPage());
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(markup).toContain("Choose a workspace");
  });

  it("shows the picker, not a redirect, for an anonymous visitor even if a stale favorite cookie somehow existed", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.favoriteWorkspaceId = "forge";

    const markup = renderToStaticMarkup(await HubPage());
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(markup).toContain("Choose a workspace");
  });

  describe("Dev tile visibility (developer/admin authorization)", () => {
    it("does not show the Dev tile to an anonymous visitor, and never even checks programmer authorization for one", async () => {
      mocks.getUser.mockResolvedValue({ data: { user: null } });
      const markup = renderToStaticMarkup(await HubPage());

      expect(markup).not.toContain("Programmer tools");
      expect(mocks.loadProgrammerAuthorization).not.toHaveBeenCalled();
    });

    it("does not show the Dev tile to an ordinary authenticated user", async () => {
      mocks.getUser.mockResolvedValue({ data: { user: { id: "ordinary-1", email: "ordinary@example.com" } } });
        mocks.loadProgrammerAuthorization.mockResolvedValue({ ok: true, authorized: false, user: { id: "ordinary-1" } });

      const markup = renderToStaticMarkup(await HubPage());
      expect(markup).not.toContain("Programmer tools");
    });

    it("shows the Dev tile, linking to /forge/developer, to an authorized developer", async () => {
      mocks.getUser.mockResolvedValue({ data: { user: { id: "dev-1", email: "dev@example.com" } } });
        mocks.loadProgrammerAuthorization.mockResolvedValue({ ok: true, authorized: true, user: { id: "dev-1" } });

      const markup = renderToStaticMarkup(await HubPage());
      expect(markup).toContain("Programmer tools");
      expect(markup).toContain('href="/forge/developer"');
    });

    it("treats a failed/unavailable authorization check the same as unauthorized -- fails closed, never open", async () => {
      mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
        mocks.loadProgrammerAuthorization.mockResolvedValue({ ok: false, authorized: false, user: null, message: "unavailable" });

      const markup = renderToStaticMarkup(await HubPage());
      expect(markup).not.toContain("Programmer tools");
    });

    it("does not blindly redirect to /forge/developer from a saved favorite if the actor is no longer an authorized developer", async () => {
      mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
        mocks.loadProgrammerAuthorization.mockResolvedValue({ ok: true, authorized: false, user: { id: "u1" } });
      mocks.favoriteWorkspaceId = "dev";

      const markup = renderToStaticMarkup(await HubPage());
      expect(mocks.redirect).not.toHaveBeenCalled();
      expect(markup).toContain("Choose a workspace");
    });

    it("does redirect to /forge/developer from a saved favorite when the actor IS an authorized developer", async () => {
      mocks.getUser.mockResolvedValue({ data: { user: { id: "dev-1" } } });
        mocks.loadProgrammerAuthorization.mockResolvedValue({ ok: true, authorized: true, user: { id: "dev-1" } });
      mocks.favoriteWorkspaceId = "dev";

      await expect(HubPage()).rejects.toThrow("NEXT_REDIRECT:/forge/developer");
    });
  });

  describe("account panel wiring", () => {
    it("passes no user to the account panel when signed out", async () => {
      mocks.getUser.mockResolvedValue({ data: { user: null } });
      const markup = renderToStaticMarkup(await HubPage());
      expect(markup).toContain("signed-out");
    });

    it("passes the real, current user to the account panel when signed in", async () => {
      mocks.getUser.mockResolvedValue({ data: { user: { id: "u1", email: "person@example.com" } } });
        const markup = renderToStaticMarkup(await HubPage());
      expect(markup).toContain("signed-in:person@example.com");
    });
  });
});
