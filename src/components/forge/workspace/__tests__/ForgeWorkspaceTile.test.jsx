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
  it("preserves the compact tile when no expanded surface is supplied", () => {
    const markup = renderToStaticMarkup(
      <ForgeWorkspaceTile
        eyebrow="Financial Application"
        title="Financial Position"
        detail="Current financial condition."
        href="/forge/financial"
        status="Healthy"
        span="wide"
      >
        <div>Compact financial surface</div>
      </ForgeWorkspaceTile>,
    );

    expect(markup).toContain("data-workspace-tile");
    expect(markup).toContain(
      'data-workspace-tile-expanded="false"',
    );
    expect(markup).toContain("xl:col-span-2");
    expect(markup).toContain("Compact financial surface");
    expect(markup).not.toContain("Expand");
    expect(markup).toContain("Open workspace");
  });

  it("offers expansion when an expanded surface is supplied", () => {
    const markup = renderToStaticMarkup(
      <ForgeWorkspaceTile
        title="Financial Position"
        expandedChildren={
          <div>Expanded financial surface</div>
        }
      >
        <div>Compact financial surface</div>
      </ForgeWorkspaceTile>,
    );

    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Expand");
    expect(markup).toContain("Compact financial surface");
    expect(markup).not.toContain(
      "Expanded financial surface",
    );
  });

  it("renders the expanded surface and full grid span when initially expanded", () => {
    const markup = renderToStaticMarkup(
      <ForgeWorkspaceTile
        title="Financial Position"
        expandedChildren={
          <div>Expanded financial surface</div>
        }
        initialExpanded
      >
        <div>Compact financial surface</div>
      </ForgeWorkspaceTile>,
    );

    expect(markup).toContain(
      'data-workspace-tile-expanded="true"',
    );
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("md:col-span-2");
    expect(markup).toContain("Collapse");
    expect(markup).toContain(
      "Expanded financial surface",
    );
    expect(markup).not.toContain(
      "Compact financial surface",
    );
  });

  it("ignores initial expansion when no expanded surface exists", () => {
    const markup = renderToStaticMarkup(
      <ForgeWorkspaceTile
        title="Financial Position"
        initialExpanded
      >
        <div>Compact financial surface</div>
      </ForgeWorkspaceTile>,
    );

    expect(markup).toContain(
      'data-workspace-tile-expanded="false"',
    );
    expect(markup).not.toContain("Collapse");
    expect(markup).toContain("Compact financial surface");
  });
});
