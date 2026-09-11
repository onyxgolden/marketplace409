import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

// Reverifies (does not rebuild) the route-level enforcement the "Choose a workspace" chooser's own
// Health-tile visibility check must never be a substitute for -- hiding the tile is a UX courtesy,
// this is the real gate. No test file existed for this route before.
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  redirect: vi.fn((href) => { throw new Error(`NEXT_REDIRECT:${href}`); }),
  membership: null,
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

function membershipBuilder() {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: mocks.membership, error: null }),
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => membershipBuilder(),
  }),
}));

vi.mock("@/components/forge/health/HealthDashboard", () => ({
  default: ({ initialMembership }) => React.createElement(
    "div",
    { "data-health-dashboard-stub": true },
    initialMembership ? "member" : "no-membership",
  ),
}));

import HealthPage from "./page.jsx";

describe("HealthPage route-level authorization", () => {
  it("redirects a signed-out visitor to /auth -- direct-URL access is denied even with no client-side card ever shown", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    await expect(HealthPage()).rejects.toThrow("NEXT_REDIRECT:/auth");
    expect(mocks.redirect).toHaveBeenCalledWith("/auth");
  });

  it("renders with no membership for an ordinary authenticated user who is not an owner/co-owner of any household -- real data access is still gated by health_workspace_members/RLS, not by this page alone", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "ordinary-1" } } });
    mocks.membership = null;

    const markup = renderToStaticMarkup(await HealthPage());
    expect(markup).toContain("no-membership");
  });

  it("passes the real membership row through for an actual household member", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
    mocks.membership = { workspace_id: "hw-1", role: "owner" };

    const markup = renderToStaticMarkup(await HealthPage());
    expect(markup).toContain("member");
  });
});
