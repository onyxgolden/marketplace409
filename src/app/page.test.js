import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  isOwnerOrActiveCoOwner: vi.fn(),
  redirect: vi.fn((href) => { throw new Error(`NEXT_REDIRECT:${href}`); }),
  favoriteWorkspaceId: null,
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => Promise.resolve({ count: 3 }),
    }),
  },
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

vi.mock("@/lib/supabase/isOwnerOrActiveCoOwner", () => ({
  isOwnerOrActiveCoOwner: mocks.isOwnerOrActiveCoOwner,
}));

import HubPage from "./page.jsx";

describe("HubPage (Choose a workspace)", () => {
  beforeEach(() => {
    mocks.favoriteWorkspaceId = null;
    mocks.redirect.mockClear();
  });

  it("shows no Health tile to an anonymous visitor", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const markup = renderToStaticMarkup(await HubPage());

    expect(markup).toContain("Marketplace");
    expect(markup).not.toContain("Health");
    expect(mocks.isOwnerOrActiveCoOwner).not.toHaveBeenCalled();
  });

  it("shows no Health tile to a signed-in staff member (manager, bookkeeper, read_only)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "staff-1" } } });
    mocks.isOwnerOrActiveCoOwner.mockResolvedValue(false);
    const markup = renderToStaticMarkup(await HubPage());

    expect(markup).not.toContain("Health");
  });

  it("shows the private Health shortcut, linking to /forge/health, to the primary owner", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
    mocks.isOwnerOrActiveCoOwner.mockResolvedValue(true);
    const markup = renderToStaticMarkup(await HubPage());

    expect(markup).toContain("Health");
    expect(markup).toContain('href="/forge/health"');
  });

  it("shows the private Health shortcut to an active co-owner too", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "coowner-1" } } });
    mocks.isOwnerOrActiveCoOwner.mockResolvedValue(true);
    const markup = renderToStaticMarkup(await HubPage());

    expect(markup).toContain("Health");
  });

  it("redirects a fresh visit straight to the saved favorite workspace", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
    mocks.isOwnerOrActiveCoOwner.mockResolvedValue(false);
    mocks.favoriteWorkspaceId = "forge";

    await expect(HubPage()).rejects.toThrow("NEXT_REDIRECT:/forge");
    expect(mocks.redirect).toHaveBeenCalledWith("/forge");
  });

  it("redirects to the health shortcut when it's the favorite and the actor is still owner/co-owner", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
    mocks.isOwnerOrActiveCoOwner.mockResolvedValue(true);
    mocks.favoriteWorkspaceId = "health";

    await expect(HubPage()).rejects.toThrow("NEXT_REDIRECT:/forge/health");
  });

  it("falls back to the picker when the favorite is Health but the actor is no longer owner/co-owner", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "staff-1" } } });
    mocks.isOwnerOrActiveCoOwner.mockResolvedValue(false);
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
});
