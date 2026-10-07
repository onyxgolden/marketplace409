import {
  describe,
  expect,
  it,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import ForgeWorkspaceTile from "../ForgeWorkspaceTile.jsx";

describe("ForgeWorkspaceTile", () => {
  it("renders a simple name card linking to the application", () => {
    const markup = renderToStaticMarkup(
      <ForgeWorkspaceTile
        title="Financial Position"
        href="/forge/financial"
      />,
    );

    expect(markup).toContain("data-workspace-tile");
    expect(markup).toContain("Financial Position");
    expect(markup).toContain('href="/forge/financial"');
  });

  it("renders a static name card when there is no destination", () => {
    const markup = renderToStaticMarkup(
      <ForgeWorkspaceTile title="FORGE OS" />,
    );

    expect(markup).toContain("data-workspace-tile");
    expect(markup).toContain("FORGE OS");
    expect(markup).not.toContain("href=");
  });

  it("renders only the name -- no preview surface, detail, or expand affordance", () => {
    const markup = renderToStaticMarkup(
      <ForgeWorkspaceTile
        eyebrow="Financial Application"
        title="Financial Position"
        detail="Current financial condition."
        href="/forge/financial"
        status="Healthy"
        actionLabel="Open workspace"
        expandedChildren={<div>Expanded financial surface</div>}
        initialExpanded
      >
        <div>Compact financial surface</div>
      </ForgeWorkspaceTile>,
    );

    expect(markup).toContain("Financial Position");
    expect(markup).not.toContain("Compact financial surface");
    expect(markup).not.toContain("Expanded financial surface");
    expect(markup).not.toContain("Current financial condition.");
    expect(markup).not.toContain("Expand");
    expect(markup).not.toContain("Collapse");
    expect(markup).not.toContain("Open workspace");
  });
});
