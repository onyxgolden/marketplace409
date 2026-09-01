import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.stubGlobal("fetch", vi.fn());
import WorkspaceMembersPanel from "./WorkspaceMembersPanel";

describe("WorkspaceMembersPanel", () => {
  it("presents the workspace membership surface and its initial loading state", () => {
    const markup = renderToStaticMarkup(<WorkspaceMembersPanel />);
    expect(markup).toContain("Workspace members");
    expect(markup).toContain("Co-owners get full Rental Manager and Financial FORGE access");
    expect(markup).toContain("Loading membership status");
  });

  it("does not render invite or suspend controls before the viewer's role is known", () => {
    // Before the /api/workspace/members fetch resolves, viewerRole is still null -- neither the
    // primary-owner invite form nor the co-owner notice should render, avoiding a flash of controls
    // the viewer may not actually be authorized to use.
    const markup = renderToStaticMarkup(<WorkspaceMembersPanel />);
    expect(markup).not.toContain("Invite as co-owner");
    expect(markup).not.toContain("Only the primary owner can invite");
  });

  it("does not render the accept-invitation banner before members have loaded", () => {
    // ownPendingInvite is derived from `members`, which is still empty pre-fetch -- no banner should
    // flash before the viewer's own pending invitation (if any) is actually known.
    const markup = renderToStaticMarkup(<WorkspaceMembersPanel />);
    expect(markup).not.toContain("Accept invitation");
    expect(markup).not.toContain("pending invitation");
  });
});
