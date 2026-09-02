import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

vi.mock(
  "@/components/forge/workspace/ForgeWorkspaceTile",
  () => ({
    default: ({
      href,
      actionLabel,
      title,
      status,
    }) => (
      <section
        data-workspace-tile
        data-href={href}
        data-action-label={actionLabel}
        data-status={status}
      >
        {title}
      </section>
    ),
  }),
);

import {
  HealthWorkspaceModule,
} from "../HealthWorkspaceModule.jsx";

describe("HealthWorkspaceModule", () => {
  it("composes a launch-only Health tile linking to /forge/health", () => {
    const markup = renderToStaticMarkup(HealthWorkspaceModule.renderTile({}));

    expect(markup).toContain("data-workspace-tile");
    expect(markup).toContain('data-href="/forge/health"');
    expect(markup).toContain('data-action-label="Open health workspace"');
    expect(markup).toContain('data-status="Private"');
  });

  it("is visible only to the owner or an active co-owner, never staff or an unresolved context", () => {
    expect(HealthWorkspaceModule.isVisible({ isOwnerOrCoOwner: true })).toBe(true);
    expect(HealthWorkspaceModule.isVisible({ isOwnerOrCoOwner: false })).toBe(false);
    expect(HealthWorkspaceModule.isVisible({})).toBe(false);
  });

  it("never receives or renders any actual health data -- the tile is a bare link", () => {
    expect(HealthWorkspaceModule.renderTile.length).toBe(0);
  });
});
