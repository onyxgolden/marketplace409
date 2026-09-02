import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  isOwnerOrActiveCoOwner: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => Promise.resolve({ count: 3 }),
    }),
  },
}));

function queryBuilder(count) {
  const builder = {
    select: () => builder,
    eq: () => Promise.resolve({ count }),
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: (table) => queryBuilder(table === "rental_leases" ? 4 : 7),
  }),
}));

vi.mock("@/lib/supabase/isOwnerOrActiveCoOwner", () => ({
  isOwnerOrActiveCoOwner: mocks.isOwnerOrActiveCoOwner,
}));

import HubPage from "./page.jsx";

describe("HubPage (Choose a workspace)", () => {
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
});
